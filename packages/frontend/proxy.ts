import type {
  Fetcher,
  ExecutionContext,
  Request as CFRequest,
  Response as CFResponse,
} from "@cloudflare/workers-types";

// @cloudflare/workers-typesのSecretsStoreSecretはexportされていないambientな型のため、
// (frontendのtsconfigはこのパッケージを"types"に含めておらず、他の型もimport type {}で
// 個別に取り込む方針のため)最小限の形をここに複製する
interface SecretsStoreSecret {
  get(): Promise<string>;
}

export interface Env {
  ASSETS: Fetcher;
  // Backend Workerへの Service Binding(wrangler.jsonc の "services")。以前は BACKEND_URL へ
  // fetch していたが、Frontend/Backend が同じ workers.dev ゾーンにあると、Worker からの fetch は
  // Backend Worker を通らずゾーンのオリジンへ送られて 404 になる(Cloudflareの仕様)ため、
  // Worker同士を直接つなぐ Service Binding に変更した(2026-09-23)。ローカルでは、同じPCで
  // 起動中の Backend(wrangler dev)に自動で接続される
  BACKEND: Fetcher;
  // #14-2: API_KEY・SESSION_SECRETはbackendと値を共有するため、Worker専用のSecret
  // (wrangler secret put)ではなくSecrets Store(1アカウント共有の箱)を使う。
  // .get()は未設定/取得失敗時にthrowする(呼び出し側でtry/catchして扱う)
  API_KEY: SecretsStoreSecret;
  SESSION_SECRET: SecretsStoreSecret;
}

// Secrets Store未設定・取得失敗時はnullを返す(呼び出し元で「設定不備」として扱う)
async function readSecret(secret: SecretsStoreSecret): Promise<string | null> {
  try {
    return await secret.get();
  } catch {
    return null;
  }
}

// ログイン不要でBackendへの転送を許可するAPIパス(完全一致)。
// ログイン処理そのもの・初期セットアップ・パスワードリセットなど、
// セッションcookieがまだ存在しない/不要な流れでのみ使用される。
const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/users/count",
  "/api/users/setup-admin",
  "/api/users/forgot-password",
  "/api/users/reset-password-via-token",
]);

// Item4-c: 見積書OTPダウンロード(社外の取引先がメールのリンクから直接アクセスする、
// ログインセッションを持たない前提のパス)。動的セグメント(:id/:attachmentId)を含むため
// 完全一致のPUBLIC_API_PATHSとは別に前方一致で判定する。
// Item6 Phase6-4: 出荷指示書/入荷指示書のOTPダウンロード(外部倉庫が受信する)も同じ理由で追加。
// Item7: 注文請書OTPダウンロード(取引先向け)も同じ理由で追加。
const PUBLIC_API_PATH_PREFIXES = [
  "/api/quotes/download-request/",
  "/api/quotes/download-verify/",
  "/api/shipment-instructions/download-request/",
  "/api/shipment-instructions/download-verify/",
  "/api/receipt-instructions/download-request/",
  "/api/receipt-instructions/download-verify/",
  "/api/sales-orders/download-request/",
  "/api/sales-orders/download-verify/",
  // Item7残課題7: 納品書OTPダウンロード(取引先向け)も同じ理由で追加。
  "/api/stock-shipments/download-request/",
  "/api/stock-shipments/download-verify/",
  // Item9 Phase5: 発注書OTPダウンロード(仕入先向け)も同じ理由で追加。
  "/api/purchase-orders/download-request/",
  "/api/purchase-orders/download-verify/",
  // 検収書発行フォローアップ: 検収書OTPダウンロード(仕入先向け)も同じ理由で追加。
  "/api/stock-receipts/download-request/",
  "/api/stock-receipts/download-verify/",
  // K-4-1: 売上関連書類OTPダウンロード(取引先向け)も同じ理由で追加。
  "/api/sales-invoices/download-request/",
  "/api/sales-invoices/download-verify/",
  // 追加要望: 請求書OTPダウンロード(取引先向け)も同じ理由で追加。
  "/api/sales-billing/download-request/",
  "/api/sales-billing/download-verify/",
];

function isPublicApiPath(pathname: string): boolean {
  return (
    PUBLIC_API_PATHS.has(pathname) ||
    PUBLIC_API_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

function getCookie(request: CFRequest, name: string): string | undefined {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return undefined;

  const cookies = cookieHeader.split(";").map((c) => c.trim());
  const target = cookies.find((c) => c.startsWith(`${name}=`));
  return target ? target.split("=")[1] : undefined;
}

// --- Backendの platform/auth/session-token.ts と同一アルゴリズム(HMAC-SHA256)の検証専用実装。 ---
// Frontend/Backendは別々のWorkerとしてデプロイされるため、ソースを直接共有できず、
// 検証に必要な最小限のロジックのみをここに複製している(署名鍵SESSION_SECRETは両Workerに
// 同じ値をCloudflare Secretとして設定することで、同じ発行物を検証できる)。
interface SessionPayload {
  userId: string;
  name: string;
  role: string;
  deptName: string;
  companyName: string;
  isAuditEnabled: boolean;
  exp: number;
}

function base64urlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function verifySessionToken(
  token: string | undefined,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signatureB64] = parts;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64urlDecode(signatureB64) as BufferSource,
      new TextEncoder().encode(payloadB64),
    );
    if (!isValid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payloadB64)),
    ) as SessionPayload;

    if (
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export default {
  async fetch(
    request: CFRequest,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<CFResponse> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Secrets Storeからの取得は非同期・失敗しうるため、リクエストごとに1回だけ解決して使い回す
    // (このあと最大2箇所(/api/*・ページルーティング)でSESSION_SECRETを使うため)
    const apiKey = await readSecret(env.API_KEY);
    const sessionSecret = await readSecret(env.SESSION_SECRET);

    // 💡 もし `/api/*` へのアクセスであれば、バックエンドのHonoへ転送する
    if (pathname.startsWith("/api/")) {
      if (!env.BACKEND || !apiKey || !sessionSecret) {
        return new Response(
          "Configuration Error: BACKEND (service binding), API_KEY, or SESSION_SECRET is missing.",
          { status: 500 },
        ) as unknown as CFResponse;
      }

      // 🔒 ログイン不要なパス以外は、有効な署名付きセッションcookieが無ければBackendへ転送しない。
      //    (以前はここでのセッションチェックが漏れており、未ログインでもAPIキーが裏側で付与されて
      //     Backendへ到達できてしまっていた)
      if (request.method !== "OPTIONS" && !isPublicApiPath(pathname)) {
        const token = getCookie(request, "session_token");
        const session = await verifySessionToken(token, sessionSecret);
        if (!session) {
          return new Response(
            JSON.stringify({ error: "Unauthorized: ログインが必要です。" }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ) as unknown as CFResponse;
        }
      }

      // 転送先のURLを構築(Service Binding では URL のホスト部分は使われず、パスとクエリだけが
      // Backend に渡る。そのためホストは固定値でよい)
      const targetUrl = `https://backend${pathname}${url.search}`;

      // request.headers から新しくヘッダーをコピー（TypeScript型エラー対策）
      const newHeaders = new Headers(request.headers as unknown as HeadersInit);

      // 安全にAPIキーを裏側で付与
      newHeaders.set("X-API-KEY", apiKey);

      // リクエストボディの型競合を型アサーションで回避
      const requestBody = request.body as unknown as BodyInit | null;

      // バックエンドへ送信するための新しいリクエストを作成
      const modifiedRequest = new globalThis.Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: requestBody,
        redirect: "manual",
      });

      // Service Binding 経由でHonoサーバーへ通信し、その結果をそのままブラウザに返す
      return (await env.BACKEND.fetch(
        modifiedRequest as unknown as Parameters<Fetcher["fetch"]>[0],
      )) as unknown as CFResponse;
    }

    // --- 以降は元の静的アセットや認証チェックのロジック ---

    const session = await verifySessionToken(
      getCookie(request, "session_token"),
      sessionSecret ?? "",
    );
    const userRole = session?.role || "general_user";

    // 1. 公開ルート
    const isPublicPage =
      pathname === "/login" ||
      pathname === "/setup-init-admin" ||
      pathname === "/forgot-password" ||
      pathname === "/force-password-change" ||
      pathname === "/password-reset" ||
      // Item4-c: 見積書OTPダウンロード公開ページ(quoteId/attachmentIdはクエリパラメータで受け取る)
      pathname === "/quote-download" ||
      // Item6 Phase6-4: 出荷指示書/入荷指示書OTPダウンロード公開ページ(外部倉庫向け)
      pathname === "/shipment-instruction-download" ||
      pathname === "/receipt-instruction-download" ||
      // Item7: 注文請書OTPダウンロード公開ページ(取引先向け)
      pathname === "/order-download" ||
      // Item7残課題7: 納品書OTPダウンロード公開ページ(取引先向け)
      pathname === "/delivery-note-download" ||
      // Item9 Phase5: 発注書OTPダウンロード公開ページ(仕入先向け)
      pathname === "/purchase-order-download" ||
      // 検収書発行フォローアップ: 検収書OTPダウンロード公開ページ(仕入先向け)
      pathname === "/acceptance-inspection-download" ||
      // K-4-1: 売上関連書類OTPダウンロード公開ページ(取引先向け)
      pathname === "/sales-invoice-download" ||
      // 追加要望: 請求書OTPダウンロード公開ページ(取引先向け)
      pathname === "/billing-download";

    // 2. 純粋なシステム共通資産
    const isStaticAsset =
      pathname.startsWith("/_next/") ||
      pathname.startsWith("/images/") ||
      pathname === "/favicon.ico" ||
      pathname.endsWith(".svg") ||
      pathname.endsWith(".png") ||
      pathname.endsWith(".jpg") ||
      pathname.endsWith(".css");

    // 🔒 未ログイン時のセキュリティチェック
    if (!isPublicPage && !isStaticAsset) {
      if (!session) {
        return Response.redirect(
          `${url.origin}/login`,
          302,
        ) as unknown as CFResponse;
      }
    }

    // 3. 管理者権限チェック
    if (pathname.startsWith("/admin")) {
      if (userRole !== "admin") {
        return Response.redirect(
          `${url.origin}/dashboard?error=unauthorized`,
          302,
        ) as unknown as CFResponse;
      }
    }

    // 4. Wranglerの静的アセットフェッチを実行
    const asset = await env.ASSETS.fetch(request);

    // ✨ 修正箇所: Next.jsの裏側通信（_rscパラメータ付きリクエスト）または拡張子のないパスを救済する
    const isNextDataRequest = url.searchParams.has("_rsc");
    const isHtmlRoute = !pathname.includes(".");

    if (asset.status === 404 && (isHtmlRoute || isNextDataRequest)) {
      return env.ASSETS.fetch(
        `${url.origin}/index.html`,
      ) as Promise<CFResponse>;
    }

    return asset as CFResponse;
  },
};
