import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { MailSettingsService } from "./mail-settings.service";
import { respondError, validationHook } from "../../../platform/http/error-handler";
import { isHttpError } from "../../../platform/http/http-error";
import { parsePaginationParams } from "../../../platform/http/pagination";
import { describeApiRoute, describeListRoute } from "../../../platform/openapi/describe-route";
import {
  updateTemplateSchema,
  sendTestEmailSchema,
  r2ExplorerQuerySchema,
  uploadFileSchema,
} from "./mail-settings.schema";

export const mailSettingsRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  return new MailSettingsService(c.env);
}

// 1. 全ての帳票メール設定を取得 (無ければ初期登録)
// page/limit未指定時は従来通り配列を返す(後方互換)。指定時のみ{data,pagination}形式で返す。
mailSettingsRouter.get(
  "/",
  describeListRoute({
    summary: "帳票メール設定一覧取得(無ければ初期登録)",
    tags: ["mail-settings"],
    itemDescription: "帳票メール設定",
  }),
  async (c) => {
  try {
    const service = getService(c);
    const query = c.req.query();
    if (query.page === undefined && query.limit === undefined) {
      const templates = await service.getOrInitTemplates(c);
      return c.json(templates);
    }
    const params = parsePaginationParams(query);
    const result = await service.getTemplatesPage(c, params);
    return c.json(result);
  } catch (err) {
    return respondError(c, err,
      "D1からのメール設定取得および初期初期化に失敗しました");
  }
});

// 2. 帳票メール設定の保存・更新 (PUT)
mailSettingsRouter.put(
  "/",
  describeApiRoute({
    summary: "帳票メール設定の保存・更新",
    tags: ["mail-settings"],
    json: updateTemplateSchema,
    responses: {
      200: { description: "更新成功" },
      400: { description: "入力内容に不備がある" },
    },
  }),
  vValidator("json", updateTemplateSchema, validationHook()),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const service = getService(c);
      const result = await service.updateTemplate(c, body);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "D1データベースへの永続化に失敗しました");
    }
  },
);

// 3. テストメール送信 (POST)
mailSettingsRouter.post(
  "/test-email",
  describeApiRoute({
    summary: "テストメール送信",
    tags: ["mail-settings"],
    json: sendTestEmailSchema,
    responses: {
      200: { description: "送信成功" },
      400: { description: "入力内容に不備がある" },
      500: { description: "SMTP接続または認証エラー" },
    },
  }),
  vValidator("json", sendTestEmailSchema, validationHook()),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const service = getService(c);
      const result = await service.sendTestEmail(c, body);
      return c.json(result);
    } catch (err: any) {
      if (isHttpError(err)) return respondError(c, err);
      console.error("Template test email send error:", err);
      return c.json(
        {
          success: false,
          // BUG-025: SMTPのエラー文は原因の切り分けに必要なため残し、スタックトレースは返さない(ログにだけ出す)
          message: `テスト送信失敗: ${err.message || "SMTP接続または認証エラー"}`,
        },
        500,
      );
    }
  },
);

// 4. R2 エクスプローラー
mailSettingsRouter.get(
  "/r2-explorer",
  describeApiRoute({
    summary: "R2オブジェクト一覧取得",
    tags: ["mail-settings"],
    query: r2ExplorerQuerySchema,
    responses: {
      200: { description: "指定バケット・プレフィックス配下のオブジェクト一覧" },
      400: { description: "クエリパラメータに不備がある" },
    },
  }),
  vValidator("query", r2ExplorerQuerySchema, validationHook()),
  async (c) => {
    try {
      const { prefix = "", bucket = "system" } = c.req.valid("query");
      const service = getService(c);
      const result = await service.listR2Objects(c, prefix, bucket);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "R2オブジェクトのリスト取得に失敗しました");
    }
  },
);

// 5. アセットファイルのアップロード (POST)
mailSettingsRouter.post(
  "/upload-file",
  describeApiRoute({
    summary: "アセットファイル(フォント・ロゴ・印影)のアップロード",
    tags: ["mail-settings"],
    form: uploadFileSchema,
    responses: {
      200: { description: "アップロード成功" },
      400: { description: "アップロードパラメータに不備がある" },
      500: { description: "R2へのアップロードに失敗" },
    },
  }),
  vValidator("form", uploadFileSchema, validationHook()),
  async (c) => {
    try {
      const { fileType, file, documentTypeId } = c.req.valid("form");
      const service = getService(c);
      const result = await service.uploadSystemAsset(
        c,
        fileType,
        file,
        documentTypeId,
      );
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "ファイルのアップロードに失敗しました");
    }
  },
);

// 6. 帳票Excelテンプレートの削除 (DELETE)
mailSettingsRouter.delete(
  "/report-template/:documentTypeId",
  describeApiRoute({
    summary: "帳票Excelテンプレートの削除(既定のpdf-lib描画へフォールバック)",
    tags: ["mail-settings"],
    responses: {
      200: { description: "削除成功" },
      400: { description: "テンプレートが未登録" },
      404: { description: "指定された帳票マスタが存在しない" },
    },
  }),
  async (c) => {
    try {
      const documentTypeId = c.req.param("documentTypeId");
      const service = getService(c);
      const result = await service.deleteReportTemplate(c, documentTypeId);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "テンプレートの削除に失敗しました");
    }
  },
);
