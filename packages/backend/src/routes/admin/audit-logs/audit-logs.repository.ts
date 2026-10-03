import { drizzle } from "drizzle-orm/d1";
import { and, count, desc, eq, like, sql, or, SQL } from "drizzle-orm";
import * as logSchema from "../../../db/audit-schema";
import { Env } from "../../../types/env";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

export interface AuditLogSearchParams {
  parsedStart: number | null;
  parsedEnd: number | null;
  userId?: string;
  action?: string;
  resourceKey?: string;
}

// ヘッダクリックソート(追加要望D)の許可カラム。未指定時は既存動作(実行日時降順)を維持する
const AUDIT_LOGS_SORT_COLUMNS = {
  performedAt: logSchema.auditLogs.performedAt,
  userId: logSchema.auditLogs.userId,
  action: logSchema.auditLogs.action,
  tableName: logSchema.auditLogs.tableName,
};

export class AuditLogsRepository {
  private logDb;

  constructor(env: Env) {
    this.logDb = drizzle(env.DB_LOG, { schema: logSchema });
  }

  private buildConditions(params: AuditLogSearchParams): SQL[] {
    const { parsedStart, parsedEnd, userId, action, resourceKey } = params;
    const conditions: SQL[] = [];

    if (parsedStart !== null) {
      conditions.push(
        sql`${logSchema.auditLogs.performedAt} >= ${parsedStart}`,
      );
    }

    if (parsedEnd !== null) {
      conditions.push(sql`${logSchema.auditLogs.performedAt} <= ${parsedEnd}`);
    }

    if (userId && userId.trim() !== "") {
      conditions.push(containsText(logSchema.auditLogs.userId, userId.trim()));
    }

    if (action && action.trim() !== "") {
      conditions.push(
        containsText(logSchema.auditLogs.action, action.trim().toUpperCase()),
      );
    }

    if (resourceKey && resourceKey.trim() !== "") {
      const targetResource = resourceKey.trim().toLowerCase();
      if (targetResource === "auth") {
        conditions.push(
          or(
            eq(logSchema.auditLogs.tableName, "auth"),
            like(logSchema.auditLogs.action, "%LOGIN%"),
          ) as SQL,
        );
      } else {
        conditions.push(eq(logSchema.auditLogs.tableName, targetResource));
      }
    }

    return conditions;
  }

  // 検索条件に基づいた監査ログの取得
  async searchLogs(params: AuditLogSearchParams, sort: SortQuery = {}) {
    const orderBy =
      buildOrderBy(sort, AUDIT_LOGS_SORT_COLUMNS) ??
      [desc(logSchema.auditLogs.performedAt)];
    return await this.logDb
      .select()
      .from(logSchema.auditLogs)
      .where(combineConditions(this.buildConditions(params)))
      .orderBy(...orderBy);
  }

  async searchLogsPage(
    params: AuditLogSearchParams,
    pagination: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy =
      buildOrderBy(sort, AUDIT_LOGS_SORT_COLUMNS) ??
      [desc(logSchema.auditLogs.performedAt)];
    return await this.logDb
      .select()
      .from(logSchema.auditLogs)
      .where(combineConditions(this.buildConditions(params)))
      .orderBy(...orderBy)
      .limit(pagination.limit)
      .offset(toOffset(pagination));
  }

  async countLogs(params: AuditLogSearchParams): Promise<number> {
    const result = await this.logDb
      .select({ value: count() })
      .from(logSchema.auditLogs)
      .where(combineConditions(this.buildConditions(params)));
    return result[0]?.value || 0;
  }
}
