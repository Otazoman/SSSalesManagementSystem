import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { MailLogsService } from "./mail-logs.service";
import { respondError, validationHook } from "../../../platform/http/error-handler";
// 型とスキーマは mail-logs.schema から import します
import {
  MailSearchSchema,
  MailSearchRequestBody,
  csvDownloadQuerySchema,
} from "./mail-logs.schema";
import {
  describeApiRoute,
  describeCsvDownloadRoute,
} from "../../../platform/openapi/describe-route";
import { todayJst } from "../../../platform/date/format-jst-date";

const mailLogsRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  return new MailLogsService(c.env);
}

// メール配信ログの検索実行
mailLogsRouter.post(
  "/search",
  describeApiRoute({
    summary: "メール送信履歴ログ検索実行",
    tags: ["mail-logs"],
    json: MailSearchSchema,
    responses: {
      200: {
        description:
          "検索条件に一致するメール送信履歴ログ。body.page/body.limit未指定時は配列、指定時のみ{data,pagination}形式で返す。",
      },
    },
  }),
  vValidator("json", MailSearchSchema, validationHook()),
  async (c) => {
    try {
      // vValidator によって検証済みの安全なデータを取得（型も自動で MailSearchRequestBody に推論されます）
      const body = c.req.valid("json");
      const service = getService(c);
      // page/limit未指定時は従来通り配列を返す(後方互換)。指定時のみ{data,pagination}形式で返す。
      if (body.page === undefined && body.limit === undefined) {
        const logs = await service.searchMailLogs(c, body);
        return c.json(logs);
      }
      const result = await service.searchMailLogsPage(c, body);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "メール送信履歴ログの検索に失敗しました");
    }
  },
);

// メール配信ログのCSVダウンロード(検索条件に一致する全件をページ制限なしで出力)
mailLogsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({
    summary: "メール送信履歴ログCSVダウンロード(検索条件付き)",
    tags: ["mail-logs"],
  }),
  vValidator("query", csvDownloadQuerySchema, validationHook()),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const service = getService(c);
      const csvContent = await service.exportCsv(c, query);
      return c.body(csvContent, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="mail_delivery_log_${todayJst()}.csv"`,
      });
    } catch (err) {
      return respondError(c, err, "メール送信履歴ログのCSVダウンロードに失敗しました");
    }
  },
);

export { mailLogsRouter };
