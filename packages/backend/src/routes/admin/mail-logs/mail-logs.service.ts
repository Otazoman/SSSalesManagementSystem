import { Context } from "hono";
import { MailLogsRepository } from "./mail-logs.repository";
import { MailSearchRequestBody, CsvDownloadQuery } from "./mail-logs.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { MailLogSearchParams } from "./mail-logs.repository";
import { PaginationParams, parsePaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { parseDateTimeToUnixSeconds } from "../../../platform/http/date-range";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";

const RESOURCE_KEY = "mail_delivery_logs";

export class MailLogsService {
  private repo: MailLogsRepository;

  constructor(env: Env) {
    this.repo = new MailLogsRepository(env);
  }

  // 検索処理 & 監査ログ出力
  async searchMailLogs(
    c: Context<{ Bindings: Env }>,
    body: MailSearchRequestBody,
  ) {
    const { startDate, endDate, documentId, keyword, status } = body;

    const parsedStart = parseDateTimeToUnixSeconds(startDate, false);
    const parsedEnd = parseDateTimeToUnixSeconds(endDate, true);

    const rawLogs = await this.repo.searchLogs(
      {
        parsedStart,
        parsedEnd,
        documentId,
        keyword,
        status,
      },
      { sortBy: body.sortBy, sortOrder: body.sortOrder },
    );

    c.executionCtx.waitUntil(
      logAuditEvent(
      c,
      "EXECUTE_MAIL_DELIVERY_LOG_SEARCH",
      RESOURCE_KEY,
      "SEARCH_OPERATION",
      null,
      {
        filterConditions: { startDate, endDate, documentId, keyword, status },
        hitCount: rawLogs.length,
      },
    ),
    );

    return rawLogs;
  }

  // 検索処理(ページネーション版)。page/limitがボディに含まれる場合のみ使用する。
  async searchMailLogsPage(
    c: Context<{ Bindings: Env }>,
    body: MailSearchRequestBody,
  ) {
    const { startDate, endDate, documentId, keyword, status } = body;

    const parsedStart = parseDateTimeToUnixSeconds(startDate, false);
    const parsedEnd = parseDateTimeToUnixSeconds(endDate, true);

    const searchParams: MailLogSearchParams = {
      parsedStart,
      parsedEnd,
      documentId,
      keyword,
      status,
    };
    const params = parsePaginationParams({
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
      "EXECUTE_MAIL_DELIVERY_LOG_SEARCH",
      RESOURCE_KEY,
      "SEARCH_OPERATION",
      null,
      {
        filterConditions: { startDate, endDate, documentId, keyword, status },
        hitCount: rawLogs.length,
      },
    ),
    );

    return buildListResponse(rawLogs, buildPaginationMeta(params, total));
  }

  // 3. CSVダウンロード(検索条件に一致する全件、ページ制限なし)
  async exportCsv(c: Context<{ Bindings: Env }>, query: CsvDownloadQuery) {
    const { startDate, endDate, documentId, keyword, status } = query;

    const parsedStart = parseDateTimeToUnixSeconds(startDate, false);
    const parsedEnd = parseDateTimeToUnixSeconds(endDate, true);

    const logs = await this.repo.searchLogs({
      parsedStart,
      parsedEnd,
      documentId,
      keyword,
      status,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(
      c,
      "EXPORT_MAIL_DELIVERY_LOG_CSV",
      RESOURCE_KEY,
      "CSV_EXPORT",
      null,
      {
        filterConditions: { startDate, endDate, documentId, keyword, status },
        hitCount: logs.length,
      },
    ),
    );

    const headers = [
      "送信日時",
      "帳票種別",
      "伝票番号(ID)",
      "送信元(From)",
      "宛先(To)",
      "同報(Cc)",
      "メール件名(Subject)",
      "添付R2パス",
      "配信ステータス",
      "エラーメッセージ",
      "実行ユーザーID",
    ];

    const rows = logs.map((log: any) =>
      [
        csvField(
          log.performedAt
            ? new Date(log.performedAt).toLocaleString("ja-JP")
            : "",
        ),
        csvField(
          log.category === "sales_quote" ? "見積書" : log.category,
        ),
        csvField(log.documentId),
        csvField(log.smtpFrom),
        csvField(log.recipientTo),
        csvField(log.recipientCc),
        csvField(log.subject),
        csvField(log.attachedR2Path),
        csvField(log.status),
        csvField(log.errorMessage),
        csvField(log.performedById),
      ].join(","),
    );

    return withBom(buildCsvContent(headers, rows));
  }
}
