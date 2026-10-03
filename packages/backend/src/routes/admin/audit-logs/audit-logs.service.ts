import { Context } from "hono";
import { AuditLogsRepository } from "./audit-logs.repository";
import { SCREEN_TRANSLATION } from "../../../constants/screens";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { SearchRequestBody, CsvDownloadQuery } from "./audit-logs.schema";
import { AuditLogSearchParams } from "./audit-logs.repository";
import { PaginationParams, parsePaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { parseDateTimeToUnixSeconds } from "../../../platform/http/date-range";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";

const RESOURCE_KEY = "audit_logs";

function formatLog(log: {
  id: string;
  userId: string;
  action: string;
  tableName: string;
  recordId: string | null;
  oldValues: unknown;
  newValues: unknown;
  performedAt: unknown;
}) {
  let resolvedScreenName =
    SCREEN_TRANSLATION[log.tableName] || `その他業務領域 (${log.tableName})`;

  if (log.action.includes("LOGIN")) {
    resolvedScreenName = "システム認証・アクセスセキュリティ領域";
  }

  return {
    id: log.id,
    userId: log.userId,
    action: log.action,
    tableName: log.tableName,
    screenName: resolvedScreenName,
    recordId: log.recordId,
    oldValues: log.oldValues,
    newValues: log.newValues,
    performedAt: log.performedAt,
  };
}

export class AuditLogsService {
  private repo: AuditLogsRepository;

  constructor(env: Env) {
    this.repo = new AuditLogsRepository(env);
  }

  // 1. リソース選択肢の取得 & アクセスログ出力
  async getResourceOptions(c: Context<{ Bindings: Env }>) {
    c.executionCtx.waitUntil(
      logAuditEvent(c, "ACCESS_AUDIT_LOG_SCREEN", RESOURCE_KEY, "METADATA_LOAD", null, {
      message: "操作ログ検索画面の設定データ(プルダウン)がロードされました",
    }),
    );

    return Object.entries(SCREEN_TRANSLATION).map(([key, label]) => ({
      key,
      label: `${label} (${key})`,
    }));
  }

  // 2. 検索実行 & ログ出力 & データフォーマット
  async searchAuditLogs(
    c: Context<{ Bindings: Env }>,
    body: SearchRequestBody,
  ) {
    const { startDate, endDate, userId, resourceKey, action } = body;

    const parsedStart = parseDateTimeToUnixSeconds(startDate, false);
    const parsedEnd = parseDateTimeToUnixSeconds(endDate, true);

    const rawLogs = await this.repo.searchLogs(
      {
        parsedStart,
        parsedEnd,
        userId,
        action,
        resourceKey,
      },
      { sortBy: body.sortBy, sortOrder: body.sortOrder },
    );

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXECUTE_AUDIT_LOG_SEARCH", RESOURCE_KEY, "SEARCH_OPERATION", null, {
      filterConditions: {
        startDate,
        endDate,
        targetUserId: userId,
        targetResource: resourceKey,
        targetAction: action,
      },
      hitCount: rawLogs.length,
    }),
    );

    return rawLogs.map(formatLog);
  }

  // 2-b. 検索実行(ページネーション版)。page/limitがボディに含まれる場合のみ使用する。
  async searchAuditLogsPage(
    c: Context<{ Bindings: Env }>,
    body: SearchRequestBody,
  ) {
    const { startDate, endDate, userId, resourceKey, action } = body;

    const parsedStart = parseDateTimeToUnixSeconds(startDate, false);
    const parsedEnd = parseDateTimeToUnixSeconds(endDate, true);

    const searchParams: AuditLogSearchParams = {
      parsedStart,
      parsedEnd,
      userId,
      action,
      resourceKey,
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
      logAuditEvent(c, "EXECUTE_AUDIT_LOG_SEARCH", RESOURCE_KEY, "SEARCH_OPERATION", null, {
      filterConditions: {
        startDate,
        endDate,
        targetUserId: userId,
        targetResource: resourceKey,
        targetAction: action,
      },
      hitCount: rawLogs.length,
    }),
    );

    return buildListResponse(rawLogs.map(formatLog), buildPaginationMeta(params, total));
  }

  // 3. CSVダウンロード(検索条件に一致する全件、ページ制限なし)
  async exportCsv(c: Context<{ Bindings: Env }>, query: CsvDownloadQuery) {
    const { startDate, endDate, userId, resourceKey, action } = query;

    const parsedStart = parseDateTimeToUnixSeconds(startDate, false);
    const parsedEnd = parseDateTimeToUnixSeconds(endDate, true);

    const rawLogs = await this.repo.searchLogs({
      parsedStart,
      parsedEnd,
      userId,
      action,
      resourceKey,
    });
    const logs = rawLogs.map(formatLog);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_AUDIT_LOG_CSV", RESOURCE_KEY, "CSV_EXPORT", null, {
      filterConditions: {
        startDate,
        endDate,
        targetUserId: userId,
        targetResource: resourceKey,
        targetAction: action,
      },
      hitCount: logs.length,
    }),
    );

    const headers = [
      "実行日時",
      "実行ユーザーID",
      "画面名",
      "テーブル識別子",
      "操作内容(Action)",
      "対象レコードID",
      "変更前データ(JSON)",
      "変更後データ(JSON)",
    ];

    const rows = logs.map((log) =>
      [
        csvField(
          log.performedAt
            ? (log.performedAt as Date).toLocaleString("ja-JP")
            : "",
        ),
        csvField(log.userId),
        csvField(log.screenName),
        csvField(log.tableName),
        csvField(log.action),
        csvField(log.recordId),
        csvField(log.oldValues as string | null),
        csvField(log.newValues as string | null),
      ].join(","),
    );

    return withBom(buildCsvContent(headers, rows));
  }
}
