import { drizzle } from "drizzle-orm/d1";
import { desc, eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";

// ヘッダクリックソート(追加要望D)の許可カラム。未指定時は既存動作(起票日時降順)を維持する
const JOURNAL_POSTING_EVENTS_SORT_COLUMNS = {
  requestedAt: schema.journalPostingEvents.requestedAt,
  sourceType: schema.journalPostingEvents.sourceType,
  eventType: schema.journalPostingEvents.eventType,
  status: schema.journalPostingEvents.status,
  errorMessage: schema.journalPostingEvents.errorMessage,
};

export class JournalPostingEventsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  // 直近200件のみを対象にする(一覧・監視用途であり、全件を無制限に返す必要は無いため)
  async findRecent(sort: SortQuery = {}) {
    const orderBy =
      buildOrderBy(sort, JOURNAL_POSTING_EVENTS_SORT_COLUMNS) ??
      [desc(schema.journalPostingEvents.requestedAt)];
    return await this.db
      .select()
      .from(schema.journalPostingEvents)
      .orderBy(...orderBy)
      .limit(200);
  }

  async findById(id: string) {
    const res = await this.db
      .select()
      .from(schema.journalPostingEvents)
      .where(eq(schema.journalPostingEvents.id, id))
      .limit(1);
    return res[0] || null;
  }
}
