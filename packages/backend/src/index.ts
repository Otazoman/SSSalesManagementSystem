import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/d1";
import { count } from "drizzle-orm";
import * as schema from "./db/schema";
import { Env } from "./types/env";
import * as routers from "./routes";
import { rejectMalformedJson, respondError } from "./platform/http/error-handler";
import { adminGuard } from "./platform/auth/guard-admin-apis";
import { sessionGuard } from "./platform/auth/guard-revoked-sessions";
import { safeFileResponse } from "./platform/http/apply-safe-file-headers";
import { openAPIRouteHandler } from "hono-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { processNotificationOutbox } from "./scheduled/process-notification-outbox";
import { processReportTemplateCompiles } from "./scheduled/process-report-template-compiles";

const app = new Hono<{ Bindings: Env }>();

// ==========================================
// 0. グローバル500エラーハンドラー(最終防波堤)
// ==========================================
// 各Route内のtry/catchで捕捉されなかった例外は、ここで一律に応答へ変換する(業務エラーはそのステータス、想定外は500)。
// サブルーター側で個別に app.onError() / try-catch を持つ場合はそちらが優先される。
app.onError((err, c) => respondError(c, err));

// ==========================================
// 1. CORS ミドルウェア設定
// ==========================================
app.use("*", async (c, next) => {
  const allowedOrigin = c.env.FRONTEND_URL || "http://localhost:8788";

  const corsMiddleware = cors({
    origin: (origin) => {
      // ローカル開発中の「127.0.0.1」などからのアクセスも許容する仕組み
      if (
        origin &&
        (origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:"))
      ) {
        return origin;
      }
      // それ以外（本番やStaging）は、環境変数に完全一致するものだけを許可
      return allowedOrigin;
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-API-KEY"],
    credentials: true, // クッキー連携に必須
  });

  return corsMiddleware(c, next);
});

// BUG-023: 添付ファイル・帳票などのファイルの応答を、ブラウザで安全に扱われる形にそろえる
// (HTML・SVG などを画面内で開かせない。対象はファイル名付き(Content-Disposition)の応答)
app.use("/api/*", safeFileResponse);

// ==========================================
// 2. セキュリティ & 救済処理ミドルウェア
// ==========================================
app.use("/api/*", async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return await next();
  }

  const db = drizzle(c.env.DB, { schema });
  const userCountResult = await db
    .select({ value: count() })
    .from(schema.users);
  const totalUsers = userCountResult[0]?.value || 0;

  // 初期救済：ユーザー数が完全に0件の時は、判定APIと初期登録APIのみAPIキーなしで通過を許可
  if (totalUsers === 0) {
    if (
      c.req.path === "/api/users/count" ||
      c.req.path === "/api/users/setup-admin"
    ) {
      return await next();
    }
  }

  // Item4-c: 見積書OTPダウンロード(外部の取引先がメールのリンクから直接アクセスする)は、
  // 内部APIキーを持たない前提のため専用ルートのみAPIキーチェックを除外する。
  // 認可はOTP検証自体(4桁コード・10分有効・試行回数制限)が担う。
  // Item6 Phase6-4: 出荷指示書/入荷指示書のOTPダウンロード(外部倉庫が受信する)も同じ理由で
  // 対象外にする必要があるため、対象ルーターを明示列挙する形に拡張(2026-08-24ユーザー確認済み。
  // 無制限ワイルドカードにはせず、セキュリティ境界を正規表現上で明示的に把握できる形を維持する)。
  // Item7残課題7: 納品書OTPダウンロード(得意先が受信する、stock-shipmentsルーター)が
  // この一覧から漏れていた(実害無し、フロントプロキシが全リクエストへ内部APIキーを自動付与する
  // ため。ただしセキュリティ境界の正確な列挙という本来の意図に反するため修正)。
  // Item9 Phase5: 発注書OTPダウンロード(仕入先が受信する、purchase-ordersルーター)も同じ理由で対象外にする
  // 検収書発行フォローアップ: 検収書OTPダウンロード(仕入先向け、stock-receiptsルーター)も同様
  // K-4-1: 売上(sales-invoices)関連書類OTPダウンロードも同様の理由で対象外にする
  const otpDownloadPathPattern =
    /^\/api\/(quotes|sales-orders|shipment-instructions|receipt-instructions|stock-shipments|purchase-orders|stock-receipts|sales-invoices)\/download-(request|verify)\/[^/]+\/[^/]+$/;
  // 追加要望: 請求書(sales-billing)のOTPダウンロードも同様の理由で対象外にする。
  // billing_headersはsales_invoicesと異なり添付ファイルテーブルを持たず、PDFは1件につき
  // 常に1本のためattachmentIdセグメントを持たない(idのみの1階層)
  const billingOtpDownloadPathPattern =
    /^\/api\/sales-billing\/download-(request|verify)\/[^/]+$/;
  if (
    otpDownloadPathPattern.test(c.req.path) ||
    billingOtpDownloadPathPattern.test(c.req.path)
  ) {
    return await next();
  }

  // 通常時の厳格なAPIキーチェック(Secrets Storeから読込。未設定・取得失敗時はnull=必ず不一致になる)
  let expectedApiKey: string | null;
  try {
    expectedApiKey = await c.env.API_KEY.get();
  } catch {
    expectedApiKey = null;
  }
  const clientApiKey = c.req.header("X-API-KEY");

  if (!clientApiKey || clientApiKey !== expectedApiKey) {
    return c.json({ error: "Unauthorized: 無効なAPIキーです" }, 401);
  }

  await next();
});

// BUG-024: セッションのユーザーが今も有効か、取り消し(無効化・パスワード変更・ログアウト)の後に
// 発行されたものかを確かめる。対象外(ログイン前に使うAPI)は platform/auth/guard-revoked-sessions.ts
app.use("/api/*", sessionGuard);

// BUG-020: 管理者だけのAPI(権限の変更・システムの設定・ログやD1/R2の参照など)は、
// セッションのユーザーが現在も管理者かをDBで確かめる。対象の一覧は platform/auth/guard-admin-apis.ts
app.use("/api/*", adminGuard);

// 本文の JSON が壊れているリクエストは、各 API の処理の前に 400 で返す(BUG-041)
app.use("/api/*", rejectMalformedJson);

// ==========================================
// 3. ルールベースによる全ルーターの自動マウント
// ==========================================
Object.entries(routers).forEach(([key, router]) => {
  // キャメルケースをケバブケースに自動変換
  // 例: "companySettings" ➜ "company-settings"
  // 例: "workflowTasks"   ➜ "workflow-tasks"
  const routePath = key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

  app.route(`/api/${routePath}`, router as any);
});

// ==========================================
// 4. APIドキュメント(OpenAPI仕様 & Swagger UI)
// ==========================================
// describeRoute()を付与したルートのみ仕様に反映される(段階的に対応、未対応ルートは仕様上省略される)。
// /api/*配下のため、上記2.の既存ミドルウェア(APIキー等)でそのまま保護される。
// 2026-09-23(ユーザー指示): APIドキュメントは開発環境(ローカル)でだけ公開する。.dev.vars の
// ENABLE_API_DOCS=true の時だけ有効で、Staging・本番(この値を登録しない)では 404 を返す
// (設定し忘れても「公開されない」側に倒れるよう、明示的に "true" の時だけ有効にしている)
const apiDocsOnlyWhenEnabled = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  if (c.env.ENABLE_API_DOCS !== "true") return c.notFound();
  await next();
};
app.use("/api/openapi.json", apiDocsOnlyWhenEnabled);
app.use("/api/docs", apiDocsOnlyWhenEnabled);
app.get(
  "/api/openapi.json",
  openAPIRouteHandler(app, {
    documentation: {
      info: {
        title: "Sales Management System API",
        version: "1.0.0",
        description: "販売管理システムのAPI仕様",
      },
    },
  }),
);
app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));

// ==========================================
// 5. Cron Trigger（Item0: mail/Slack通知outbox処理、1分間隔）
// ==========================================
// Honoインスタンス(app)はfetchハンドラとしてそのままexport default可能。
// scheduledはCloudflare Workersランタイムがdefault exportオブジェクトのプロパティとして
// 参照するだけなので、Honoインスタンスに直接生やしてもHono自体の動作・既存テスト(app.request())には影響しない。
Object.assign(app, {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(processNotificationOutbox(env));
    ctx.waitUntil(processReportTemplateCompiles(env));
  },
});

export default app;
