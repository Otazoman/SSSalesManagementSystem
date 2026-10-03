import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { AuditLogsService } from "./audit-logs.service";
import { respondError, validationHook } from "../../../platform/http/error-handler";
import { searchAuditLogsSchema, csvDownloadQuerySchema } from "./audit-logs.schema";
import {
  describeApiRoute,
  describeCsvDownloadRoute,
} from "../../../platform/openapi/describe-route";
import { todayJst } from "../../../platform/date/format-jst-date";

const auditLogsRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  return new AuditLogsService(c.env);
}

// 1. 共通マスタから検索用の選択肢を自動生成
auditLogsRouter.get(
  "/resources",
  describeApiRoute({
    summary: "操作ログ検索用の選択肢自動生成",
    tags: ["audit-logs"],
    responses: { 200: { description: "リソース選択肢一覧" } },
  }),
  async (c) => {
  const service = getService(c);
  const options = await service.getResourceOptions(c);
  return c.json(options);
});

// 2. 操作ログの検索実行 (POST)
auditLogsRouter.post(
  "/search",
  describeApiRoute({
    summary: "操作ログ検索実行",
    tags: ["audit-logs"],
    json: searchAuditLogsSchema,
    responses: {
      200: {
        description:
          "検索条件に一致する操作ログ。body.page/body.limit未指定時は配列、指定時のみ{data,pagination}形式で返す。",
      },
      400: { description: "検索パラメータのフォーマットが不正" },
    },
  }),
  vValidator("json", searchAuditLogsSchema, validationHook()),
  async (c) => {
    try {
      // Valibotで検証・整形済みの型安全なボディを取得
      const body = c.req.valid("json");
      const service = getService(c);
      // page/limit未指定時は従来通り配列を返す(後方互換)。指定時のみ{data,pagination}形式で返す。
      if (body.page === undefined && body.limit === undefined) {
        const formattedLogs = await service.searchAuditLogs(c, body);
        return c.json(formattedLogs);
      }
      const result = await service.searchAuditLogsPage(c, body);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "監査ログの検索に失敗しました");
    }
  },
);

// 3. CSVダウンロード(検索条件に一致する全件をページ制限なしで出力)
auditLogsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({
    summary: "操作ログCSVダウンロード(検索条件付き)",
    tags: ["audit-logs"],
  }),
  vValidator("query", csvDownloadQuerySchema, validationHook()),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const service = getService(c);
      const csvContent = await service.exportCsv(c, query);
      return c.body(csvContent, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit_log_${todayJst()}.csv"`,
      });
    } catch (err) {
      return respondError(c, err, "操作ログのCSVダウンロードに失敗しました");
    }
  },
);

export { auditLogsRouter };
