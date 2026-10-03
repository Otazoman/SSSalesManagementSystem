import { Context } from "hono";
import { OtpLogsRepository } from "./otp-logs.repository";
import {
  OtpLogSearchRequestBody,
  OtpLogCsvDownloadQuery,
} from "./otp-logs.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { PaginationParams, parsePaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { parseDateTimeToUnixSeconds } from "../../../platform/http/date-range";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";

const RESOURCE_KEY = "otp_download_logs";

export class OtpLogsService {
  private repo: OtpLogsRepository;

  constructor(env: Env) {
    this.repo = new OtpLogsRepository(env);
  }

  // 検索処理 & 監査ログ出力
  async searchOtpLogs(
    c: Context<{ Bindings: Env }>,
    body: OtpLogSearchRequestBody,
  ) {
    const { startDate, endDate, email, partnerId, subject, documentType, warehouseId } = body;

    const parsedStart = parseDateTimeToUnixSeconds(startDate, false);
    const parsedEnd = parseDateTimeToUnixSeconds(endDate, true);

    const rawLogs = await this.repo.searchLogs(
      {
        parsedStart,
        parsedEnd,
        email,
        partnerId,
        subject,
        documentType,
        warehouseId,
      },
      { sortBy: body.sortBy, sortOrder: body.sortOrder },
    );

    c.executionCtx.waitUntil(
      logAuditEvent(
      c,
      "EXECUTE_OTP_DOWNLOAD_LOG_SEARCH",
      RESOURCE_KEY,
      "SEARCH_OPERATION",
      null,
      {
        filterConditions: { startDate, endDate, email, partnerId, subject, documentType, warehouseId },
        hitCount: rawLogs.length,
      },
    ),
    );

    return rawLogs;
  }

  // 検索処理(ページネーション版)。page/limitがボディに含まれる場合のみ使用する。
  async searchOtpLogsPage(
    c: Context<{ Bindings: Env }>,
    body: OtpLogSearchRequestBody,
  ) {
    const { startDate, endDate, email, partnerId, subject, documentType, warehouseId } = body;

    const parsedStart = parseDateTimeToUnixSeconds(startDate, false);
    const parsedEnd = parseDateTimeToUnixSeconds(endDate, true);

    const searchParams = {
      parsedStart,
      parsedEnd,
      email,
      partnerId,
      subject,
      documentType,
      warehouseId,
    };
    const params: PaginationParams = parsePaginationParams({
      page: body.page !== undefined ? String(body.page) : undefined,
      limit: body.limit !== undefined ? String(body.limit) : undefined,
    });

    const [rawLogs, total] = await Promise.all([
      this.repo.searchLogsPage(searchParams, params, {
        sortBy: body.sortBy,
        sortOrder: body.sortOrder,
      }),
      this.repo.countLogs(searchParams),
    ]);

    c.executionCtx.waitUntil(
      logAuditEvent(
      c,
      "EXECUTE_OTP_DOWNLOAD_LOG_SEARCH",
      RESOURCE_KEY,
      "SEARCH_OPERATION",
      null,
      {
        filterConditions: { startDate, endDate, email, partnerId, subject, documentType, warehouseId },
        hitCount: rawLogs.length,
      },
    ),
    );

    return buildListResponse(rawLogs, buildPaginationMeta(params, total));
  }

  // CSVダウンロード(検索条件に一致する全件、ページ制限なし)
  async exportCsv(c: Context<{ Bindings: Env }>, query: OtpLogCsvDownloadQuery) {
    const { startDate, endDate, email, partnerId, subject, documentType, warehouseId } = query;

    const parsedStart = parseDateTimeToUnixSeconds(startDate, false);
    const parsedEnd = parseDateTimeToUnixSeconds(endDate, true);

    const logs = await this.repo.searchLogs({
      parsedStart,
      parsedEnd,
      email,
      partnerId,
      subject,
      documentType,
      warehouseId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(
      c,
      "EXPORT_OTP_DOWNLOAD_LOG_CSV",
      RESOURCE_KEY,
      "CSV_EXPORT",
      null,
      {
        filterConditions: { startDate, endDate, email, partnerId, subject, documentType, warehouseId },
        hitCount: logs.length,
      },
    ),
    );

    const headers = [
      "取引先名",
      "メールアドレス",
      "件名(見積タイトル・帳票種別)",
      "文書ID",
      "OTP発行日時",
      "ダウンロード確認日時",
      "有効期限",
      "試行回数",
    ];

    const rows = logs.map((log) =>
      [
        csvField(log.partnerName || ""),
        csvField(log.email),
        csvField(log.quoteTitle || ""),
        csvField(log.documentId),
        csvField(
          log.createdAt ? new Date(log.createdAt).toLocaleString("ja-JP") : "",
        ),
        csvField(
          log.verifiedAt
            ? new Date(log.verifiedAt).toLocaleString("ja-JP")
            : "未確認",
        ),
        csvField(
          log.expiresAt ? new Date(log.expiresAt).toLocaleString("ja-JP") : "",
        ),
        log.attemptCount,
      ].join(","),
    );

    return withBom(buildCsvContent(headers, rows));
  }
}
