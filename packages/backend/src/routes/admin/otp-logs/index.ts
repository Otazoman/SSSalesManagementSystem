import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { OtpLogsService } from "./otp-logs.service";
import { respondError, validationHook } from "../../../platform/http/error-handler";
import {
  OtpLogSearchSchema,
  OtpLogCsvDownloadQuerySchema,
} from "./otp-logs.schema";
import {
  describeApiRoute,
  describeCsvDownloadRoute,
} from "../../../platform/openapi/describe-route";
import { todayJst } from "../../../platform/date/format-jst-date";

const otpLogsRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  return new OtpLogsService(c.env);
}

// OTPダウンロードログの検索実行
otpLogsRouter.post(
  "/search",
  describeApiRoute({
    summary: "OTPダウンロードログ検索実行",
    tags: ["otp-logs"],
    json: OtpLogSearchSchema,
    responses: {
      200: {
        description:
          "検索条件に一致するOTPダウンロードログ。body.page/body.limit未指定時は配列、指定時のみ{data,pagination}形式で返す。",
      },
    },
  }),
  vValidator("json", OtpLogSearchSchema, validationHook()),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const service = getService(c);
      if (body.page === undefined && body.limit === undefined) {
        const logs = await service.searchOtpLogs(c, body);
        return c.json(logs);
      }
      const result = await service.searchOtpLogsPage(c, body);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "OTPダウンロードログの検索に失敗しました");
    }
  },
);

// OTPダウンロードログのCSVダウンロード(検索条件に一致する全件をページ制限なしで出力)
otpLogsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({
    summary: "OTPダウンロードログCSVダウンロード(検索条件付き)",
    tags: ["otp-logs"],
  }),
  vValidator("query", OtpLogCsvDownloadQuerySchema, validationHook()),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const service = getService(c);
      const csvContent = await service.exportCsv(c, query);
      return c.body(csvContent, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="otp_download_log_${todayJst()}.csv"`,
      });
    } catch (err) {
      return respondError(c, err, "OTPダウンロードログのCSVダウンロードに失敗しました");
    }
  },
);

export { otpLogsRouter };
