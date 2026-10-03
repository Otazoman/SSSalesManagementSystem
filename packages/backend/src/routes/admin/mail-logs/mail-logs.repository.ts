import { drizzle } from "drizzle-orm/d1";
import { and, count, desc, eq, or, gte, lte, SQL } from "drizzle-orm";
import * as logSchema from "../../../db/audit-schema";
import { Env } from "../../../types/env";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

export interface MailLogSearchParams {
  parsedStart: number | null;
  parsedEnd: number | null;
  documentId?: string;
  keyword?: string;
  status?: string;
}

// ヘッダクリックソート(追加要望D)の許可カラム。未指定時は既存動作(実行日時降順)を維持する
const MAIL_LOGS_SORT_COLUMNS = {
  performedAt: logSchema.mailDeliveryLogs.performedAt,
  documentId: logSchema.mailDeliveryLogs.documentId,
  recipientTo: logSchema.mailDeliveryLogs.recipientTo,
  subject: logSchema.mailDeliveryLogs.subject,
  status: logSchema.mailDeliveryLogs.status,
};

export class MailLogsRepository {
  private logDb;

  constructor(env: Env) {
    this.logDb = drizzle(env.DB_LOG, { schema: logSchema });
  }

  private buildConditions(params: MailLogSearchParams): SQL[] {
    const { parsedStart, parsedEnd, documentId, keyword, status } = params;
    const conditions: SQL[] = [];

    if (status && status.trim() !== "" && status.trim() !== "all") {
      conditions.push(eq(logSchema.mailDeliveryLogs.status, status.trim()));
    }

    // UNIXスタンプ (秒) から Date オブジェクトを作成して渡す
    if (parsedStart !== null) {
      conditions.push(
        gte(
          logSchema.mailDeliveryLogs.performedAt,
          new Date(parsedStart * 1000),
        ),
      );
    }

    if (parsedEnd !== null) {
      conditions.push(
        lte(logSchema.mailDeliveryLogs.performedAt, new Date(parsedEnd * 1000)),
      );
    }

    if (documentId && documentId.trim() !== "") {
      conditions.push(
        containsText(logSchema.mailDeliveryLogs.documentId, documentId.trim()),
      );
    }

    if (keyword && keyword.trim() !== "") {
      const cleanKeyword = keyword.trim();
      conditions.push(
        or(
          containsText(logSchema.mailDeliveryLogs.subject, cleanKeyword),
          containsText(logSchema.mailDeliveryLogs.recipientTo, cleanKeyword),
          containsText(logSchema.mailDeliveryLogs.errorMessage, cleanKeyword),
        )!,
      );
    }

    return conditions;
  }

  // 条件に基づいたメール配信ログの検索
  async searchLogs(params: MailLogSearchParams, sort: SortQuery = {}) {
    const orderBy =
      buildOrderBy(sort, MAIL_LOGS_SORT_COLUMNS) ??
      [desc(logSchema.mailDeliveryLogs.performedAt)];
    return await this.logDb
      .select()
      .from(logSchema.mailDeliveryLogs)
      .where(combineConditions(this.buildConditions(params)))
      .orderBy(...orderBy);
  }

  async searchLogsPage(
    params: MailLogSearchParams,
    pagination: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy =
      buildOrderBy(sort, MAIL_LOGS_SORT_COLUMNS) ??
      [desc(logSchema.mailDeliveryLogs.performedAt)];
    return await this.logDb
      .select()
      .from(logSchema.mailDeliveryLogs)
      .where(combineConditions(this.buildConditions(params)))
      .orderBy(...orderBy)
      .limit(pagination.limit)
      .offset(toOffset(pagination));
  }

  async countLogs(params: MailLogSearchParams): Promise<number> {
    const result = await this.logDb
      .select({ value: count() })
      .from(logSchema.mailDeliveryLogs)
      .where(combineConditions(this.buildConditions(params)));
    return result[0]?.value || 0;
  }
}
