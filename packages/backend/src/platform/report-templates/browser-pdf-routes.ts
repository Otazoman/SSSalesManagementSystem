import type { Context, Hono } from "hono";
import type { ReportPdfSource } from "report-renderer";
import type { Env } from "../../types/env";
import { getSession } from "../auth/get-session";
import { hasScreenPermission } from "../auth/screen-permission";
import { BadRequestError } from "../http/http-error";
import { respondError } from "../http/error-handler";
import { describeApiRoute } from "../openapi/describe-route";

// PERF-07 B-3・B-4: 帳票 PDF をブラウザで作るための API(帳票ごとに同じ形)。
// - GET  /:id/pdf-source … PDF を作るためのデータ(ReportPdfSource)。ブラウザは report-renderer の renderReportPdf で描く
// - POST /:id/pdf        … ブラウザが作った PDF(multipart の file)を受け取り、検証して保存する。後処理は今の generate-pdf と同じ
// どちらも重い処理(PDF の描画)をしないため、無料プランの CPU 時間の上限に収まる。

/** 受け取る PDF の大きさの上限 */
export const MAX_UPLOADED_PDF_BYTES = 5 * 1024 * 1024;

/** 受け取った PDF を取り出して確かめる(ファイルが1つ・先頭が %PDF-・上限以下)。だめなら BadRequestError */
export async function readUploadedPdf(c: Context): Promise<Uint8Array> {
  const declared = Number(c.req.header("Content-Length") ?? "0");
  if (declared > MAX_UPLOADED_PDF_BYTES + 64 * 1024) {
    throw new BadRequestError("PDF が大きすぎます(5MB まで)");
  }
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    throw new BadRequestError("PDF のファイルがありません");
  }
  if (file.size > MAX_UPLOADED_PDF_BYTES) {
    throw new BadRequestError("PDF が大きすぎます(5MB まで)");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = new TextDecoder().decode(bytes.subarray(0, 5));
  if (header !== "%PDF-") {
    throw new BadRequestError("PDF のファイルではありません");
  }
  return bytes;
}

export interface BrowserPdfRouteConfig<
  E extends { Bindings: Env },
  Built extends { source: ReportPdfSource },
> {
  /** API ドキュメントのタグ */
  tag: string;
  /** 帳票の名前(API ドキュメント用) */
  label: string;
  /** 画面の権限のリソース(screens.ts)。データは read、受け取りは update の権限が要る */
  resource: string;
  /**
   * PDF を作るためのデータと、保存の後処理に使う値を組み立てる。対象が無ければ null。発行できない状態なら HttpError を投げる。
   * withLayout が false の時(受け取りの時)は、Excel テンプレートのレイアウトを読まなくてよい
   */
  build: (c: Context<E>, id: string, withLayout: boolean) => Promise<Built | null>;
  /** 受け取った PDF を保存し、今の generate-pdf と同じ後処理をする。応答の本文を返す */
  store: (
    c: Context<E>,
    id: string,
    pdf: Uint8Array,
    built: Built,
    uploadedBy: { userId: string; size: number },
  ) => Promise<unknown>;
}

export function registerBrowserPdfRoutes<
  E extends { Bindings: Env },
  Built extends { source: ReportPdfSource },
>(router: Hono<E>, config: BrowserPdfRouteConfig<E, Built>): void {
  router.get(
    "/:id/pdf-source",
    describeApiRoute({
      summary: `${config.label}PDF を作るためのデータ(ブラウザで描く)`,
      tags: [config.tag],
      responses: {
        200: { description: "ReportPdfSource(帳票の種類・既定レイアウト用のデータ・Excel テンプレートのレイアウトと差し込む値)" },
        400: { description: "発行できない状態" },
        401: { description: "未ログイン" },
        403: { description: "参照の権限が無い" },
        404: { description: "対象データがない" },
      },
    }),
    async (c) => {
      try {
        // Hono の型(ルーターごとの Variables)をまたぐため、ここで1回だけ型を合わせる
        const ctx = c as unknown as Context<E>;
        const env = ctx.env as Env;
        const session = await getSession(c as unknown as Context<{ Bindings: Env }>);
        if (!session) return c.json({ success: false, message: "ログインが必要です" }, 401);
        if (!(await hasScreenPermission(env, session, config.resource, "read"))) {
          return c.json({ success: false, message: "この帳票を参照する権限がありません" }, 403);
        }
        const built = await config.build(ctx, c.req.param("id"), true);
        if (!built) return c.json({ success: false, message: "対象データがありません" }, 404);
        return c.json(built.source);
      } catch (err) {
        return respondError(c, err, `${config.label}PDF のデータの作成に失敗しました`);
      }
    },
  );

  router.post(
    "/:id/pdf",
    describeApiRoute({
      summary: `ブラウザで作った${config.label}PDF を保存する`,
      tags: [config.tag],
      responses: {
        200: { description: "保存した(後処理は generate-pdf と同じ)" },
        400: { description: "PDF でない・大きすぎる・発行できない状態" },
        401: { description: "未ログイン" },
        403: { description: "更新の権限が無い" },
        404: { description: "対象データがない" },
      },
    }),
    async (c) => {
      try {
        // Hono の型(ルーターごとの Variables)をまたぐため、ここで1回だけ型を合わせる
        const ctx = c as unknown as Context<E>;
        const env = ctx.env as Env;
        const session = await getSession(c as unknown as Context<{ Bindings: Env }>);
        if (!session) return c.json({ success: false, message: "ログインが必要です" }, 401);
        if (!(await hasScreenPermission(env, session, config.resource, "update"))) {
          return c.json({ success: false, message: "この帳票を発行する権限がありません" }, 403);
        }
        const pdf = await readUploadedPdf(ctx);
        const id = c.req.param("id");
        const built = await config.build(ctx, id, false);
        if (!built) return c.json({ success: false, message: "対象データがありません" }, 404);
        const result = await config.store(ctx, id, pdf, built, { userId: session.userId, size: pdf.byteLength });
        return c.json(result);
      } catch (err) {
        return respondError(c, err, `${config.label}PDF の保存に失敗しました`);
      }
    },
  );
}
