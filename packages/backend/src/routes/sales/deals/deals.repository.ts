import { drizzle } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import * as schema from "../../../db/schema";
import * as dealsSchema from "../../../db/deals-schema";
import type { Env } from "../../../types/env";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { containsText } from "../../../platform/repository/text-search";
import { fetchInChunks } from "../../../platform/repository/chunked-fetch";
import { findPartnerNames, findUserNames } from "../../../platform/repository/common-queries";
import type { OpenTasksQuery, SearchDealsQuery } from "./deals.schema";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import {
  ATTENDEES_PER_STATEMENT,
  DEALS_PER_STATEMENT,
  DELETE_IDS_PER_STATEMENT,
  QUOTES_PER_STATEMENT,
  TASKS_PER_STATEMENT,
} from "./deals-batch-budget";

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 300;

export type DealRow = typeof dealsSchema.deals.$inferSelect;
export type DealAttendeeRow = typeof dealsSchema.dealAttendees.$inferSelect;
export type DealTaskRow = typeof dealsSchema.dealTasks.$inferSelect;
export type DealAttachmentRow = typeof dealsSchema.dealAttachments.$inferSelect;
export type ProspectContactRow = typeof dealsSchema.prospectContacts.$inferSelect;

// CSV一括取込の1商談分。insert=新規、update=既存商談の全項目置き換え(面談者・タスク・見積紐づけを作り直す)。
// dealは常に全項目の行(updateでも作成者・作成日時は既存の値を渡す。競合時に上書きされるのは下記の項目のみ)
export type BulkDealOperation = {
  mode: "insert" | "update";
  deal: typeof dealsSchema.deals.$inferInsert;
  attendees: (typeof dealsSchema.dealAttendees.$inferInsert)[];
  tasks: (typeof dealsSchema.dealTasks.$inferInsert)[];
  quotes: (typeof dealsSchema.dealQuotes.$inferInsert)[];
};

// 追加要望M-1: 商談管理の永続化。商談データは専用DB(DB_DEALS)、取引先・見積・社員・取引先担当者の参照は
// メインDB(DB)。D1はDB跨ぎのJOINができないため、名称の解決はメインDBを別途IN句で引く
export class DealsRepository {
  private db;
  private main;

  constructor(dealsD1: D1Database, mainD1: D1Database) {
    this.db = drizzle(dealsD1, { schema: dealsSchema });
    this.main = drizzle(mainD1, { schema });
  }

  private async inChunks<T>(ids: string[], fetchChunk: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
    return fetchInChunks(ids, fetchChunk);
  }

  getOperatorEmployeeNumber(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.main);
  }

  // ---------- 商談 ----------
  private buildSearchConditions(params: SearchDealsQuery) {
    const t = dealsSchema.deals;
    const conditions = [];
    if (params.partnerId) conditions.push(eq(t.partnerId, params.partnerId));
    if (params.status && params.status !== "all") conditions.push(eq(t.status, params.status));
    if (params.ownerEmployeeNumber) conditions.push(eq(t.ownerEmployeeNumber, params.ownerEmployeeNumber));
    if (params.startDate) conditions.push(gte(t.dealDate, new Date(`${params.startDate}T00:00:00+09:00`)));
    if (params.endDate) {
      const end = new Date(`${params.endDate}T00:00:00+09:00`);
      end.setDate(end.getDate() + 1);
      conditions.push(lt(t.dealDate, end));
    }
    if (params.keyword) {
      const kw = params.keyword;
      conditions.push(or(containsText(t.title, kw), containsText(t.memo, kw), containsText(t.id, kw)));
    }
    if (params.openTasks === "true") {
      conditions.push(
        sql`${t.id} IN (SELECT deal_id FROM deal_tasks WHERE is_done = 0)`,
      );
    }
    return combineConditions(conditions);
  }

  async findMany(params: SearchDealsQuery): Promise<DealRow[]> {
    const t = dealsSchema.deals;
    const limit = Math.min(
      MAX_LIST_LIMIT,
      Math.max(1, Number.parseInt(params.limit ?? String(DEFAULT_LIST_LIMIT), 10) || DEFAULT_LIST_LIMIT),
    );
    return this.db
      .select()
      .from(t)
      .where(this.buildSearchConditions(params))
      .orderBy(desc(t.dealDate), desc(t.id))
      .limit(limit);
  }

  // BUG-032: ページ単位の取得(件数も返す)。並び順は findMany と同じ
  async findPage(params: SearchDealsQuery, pagination: PaginationParams): Promise<{ rows: DealRow[]; total: number }> {
    const t = dealsSchema.deals;
    const where = this.buildSearchConditions(params);
    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(t)
        .where(where)
        .orderBy(desc(t.dealDate), desc(t.id))
        .limit(pagination.limit)
        .offset(toOffset(pagination)),
      this.db.select({ value: sql<number>`count(*)` }).from(t).where(where),
    ]);
    return { rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  findDealsByIds(ids: string[]): Promise<DealRow[]> {
    return this.inChunks(ids, (chunk) =>
      this.db.select().from(dealsSchema.deals).where(inArray(dealsSchema.deals.id, chunk)),
    );
  }

  async findById(id: string): Promise<DealRow | null> {
    const rows = await this.db.select().from(dealsSchema.deals).where(eq(dealsSchema.deals.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async existsId(id: string): Promise<boolean> {
    return (await this.findById(id)) !== null;
  }

  // 面談者・タスク・見積紐づけの置き換えは、商談本体の更新と1つのバッチ(原子的)で行う
  async insertDeal(
    deal: typeof dealsSchema.deals.$inferInsert,
    attendees: (typeof dealsSchema.dealAttendees.$inferInsert)[],
    tasks: (typeof dealsSchema.dealTasks.$inferInsert)[],
    quotes: (typeof dealsSchema.dealQuotes.$inferInsert)[],
  ) {
    await this.db.batch([
      this.db.insert(dealsSchema.deals).values(deal),
      ...(attendees.length > 0 ? [this.db.insert(dealsSchema.dealAttendees).values(attendees)] : []),
      ...(tasks.length > 0 ? [this.db.insert(dealsSchema.dealTasks).values(tasks)] : []),
      ...(quotes.length > 0 ? [this.db.insert(dealsSchema.dealQuotes).values(quotes)] : []),
    ]);
  }

  async updateDeal(
    id: string,
    deal: Partial<typeof dealsSchema.deals.$inferInsert>,
    attendees: (typeof dealsSchema.dealAttendees.$inferInsert)[],
    tasks: (typeof dealsSchema.dealTasks.$inferInsert)[],
    quotes: (typeof dealsSchema.dealQuotes.$inferInsert)[],
  ) {
    await this.db.batch([
      this.db.update(dealsSchema.deals).set(deal).where(eq(dealsSchema.deals.id, id)),
      this.db.delete(dealsSchema.dealAttendees).where(eq(dealsSchema.dealAttendees.dealId, id)),
      this.db.delete(dealsSchema.dealTasks).where(eq(dealsSchema.dealTasks.dealId, id)),
      this.db.delete(dealsSchema.dealQuotes).where(eq(dealsSchema.dealQuotes.dealId, id)),
      ...(attendees.length > 0 ? [this.db.insert(dealsSchema.dealAttendees).values(attendees)] : []),
      ...(tasks.length > 0 ? [this.db.insert(dealsSchema.dealTasks).values(tasks)] : []),
      ...(quotes.length > 0 ? [this.db.insert(dealsSchema.dealQuotes).values(quotes)] : []),
    ]);
  }

  // CSV一括取込: 複数商談の新規登録/全項目置き換えを1回のバッチ(原子的)で行う。
  // 無料プランはbatch内の各文も1クエリと数えるため(deals-batch-budget.ts)、行は複数行INSERTに詰めて
  // 文数を減らす。新規と更新は同じ「INSERT ... ON CONFLICT(id) DO UPDATE」で扱い、作成者・作成日時は更新しない。
  // 既存商談の従属行(面談者・タスク・見積紐づけ)は、IN句のDELETEでまとめて消してから入れ直す
  async bulkSaveDeals(ops: BulkDealOperation[]) {
    if (ops.length === 0) return;
    const statements: BatchItem<"sqlite">[] = [];
    const excluded = (column: string) => sql.raw(`excluded.${column}`);

    for (let i = 0; i < ops.length; i += DEALS_PER_STATEMENT) {
      statements.push(
        this.db
          .insert(dealsSchema.deals)
          .values(ops.slice(i, i + DEALS_PER_STATEMENT).map((op) => op.deal))
          .onConflictDoUpdate({
            target: dealsSchema.deals.id,
            set: {
              partnerId: excluded("partner_id"),
              title: excluded("title"),
              dealDate: excluded("deal_date"),
              startTime: excluded("start_time"),
              endTime: excluded("end_time"),
              location: excluded("location"),
              memo: excluded("memo"),
              status: excluded("status"),
              ownerEmployeeNumber: excluded("owner_employee_number"),
              updatedBy: excluded("updated_by"),
              updatedAt: excluded("updated_at"),
            },
          }),
      );
    }

    const updatedIds = ops.filter((op) => op.mode === "update").map((op) => op.deal.id);
    for (let i = 0; i < updatedIds.length; i += DELETE_IDS_PER_STATEMENT) {
      const ids = updatedIds.slice(i, i + DELETE_IDS_PER_STATEMENT);
      statements.push(this.db.delete(dealsSchema.dealAttendees).where(inArray(dealsSchema.dealAttendees.dealId, ids)));
      statements.push(this.db.delete(dealsSchema.dealTasks).where(inArray(dealsSchema.dealTasks.dealId, ids)));
      statements.push(this.db.delete(dealsSchema.dealQuotes).where(inArray(dealsSchema.dealQuotes.dealId, ids)));
    }

    const attendees = ops.flatMap((op) => op.attendees);
    for (let i = 0; i < attendees.length; i += ATTENDEES_PER_STATEMENT) {
      statements.push(this.db.insert(dealsSchema.dealAttendees).values(attendees.slice(i, i + ATTENDEES_PER_STATEMENT)));
    }
    const tasks = ops.flatMap((op) => op.tasks);
    for (let i = 0; i < tasks.length; i += TASKS_PER_STATEMENT) {
      statements.push(this.db.insert(dealsSchema.dealTasks).values(tasks.slice(i, i + TASKS_PER_STATEMENT)));
    }
    const quotes = ops.flatMap((op) => op.quotes);
    for (let i = 0; i < quotes.length; i += QUOTES_PER_STATEMENT) {
      statements.push(this.db.insert(dealsSchema.dealQuotes).values(quotes.slice(i, i + QUOTES_PER_STATEMENT)));
    }

    await this.db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  // 従属テーブル(面談者・タスク・添付・見積紐づけ)はFKのカスケードで一緒に削除される
  async deleteDeal(id: string) {
    await this.db.delete(dealsSchema.deals).where(eq(dealsSchema.deals.id, id));
  }

  // ---------- 従属データ ----------
  findAttendees(dealIds: string[]): Promise<DealAttendeeRow[]> {
    return this.inChunks(dealIds, (chunk) =>
      this.db
        .select()
        .from(dealsSchema.dealAttendees)
        .where(inArray(dealsSchema.dealAttendees.dealId, chunk))
        .orderBy(dealsSchema.dealAttendees.sortOrder),
    );
  }

  findTasks(dealIds: string[]): Promise<DealTaskRow[]> {
    return this.inChunks(dealIds, (chunk) =>
      this.db
        .select()
        .from(dealsSchema.dealTasks)
        .where(inArray(dealsSchema.dealTasks.dealId, chunk))
        .orderBy(dealsSchema.dealTasks.sortOrder),
    );
  }

  findAttachments(dealIds: string[]): Promise<DealAttachmentRow[]> {
    return this.inChunks(dealIds, (chunk) =>
      this.db
        .select()
        .from(dealsSchema.dealAttachments)
        .where(inArray(dealsSchema.dealAttachments.dealId, chunk))
        .orderBy(dealsSchema.dealAttachments.uploadedAt),
    );
  }

  findQuoteLinks(dealIds: string[]) {
    return this.inChunks(dealIds, (chunk) =>
      this.db.select().from(dealsSchema.dealQuotes).where(inArray(dealsSchema.dealQuotes.dealId, chunk)),
    );
  }

  // 未完了タスク(担当者・取引先で絞り込み可)。期限の早い順(期限なしは最後)
  async findOpenTasks({ assigneeEmployeeNumber, partnerId }: OpenTasksQuery = {}): Promise<DealTaskRow[]> {
    const t = dealsSchema.dealTasks;
    const d = dealsSchema.deals;
    const conditions = [eq(t.isDone, false)];
    if (assigneeEmployeeNumber) conditions.push(eq(t.assigneeEmployeeNumber, assigneeEmployeeNumber));
    if (partnerId) {
      conditions.push(inArray(t.dealId, this.db.select({ id: d.id }).from(d).where(eq(d.partnerId, partnerId))));
    }
    return this.db
      .select()
      .from(t)
      .where(and(...conditions))
      .orderBy(sql`${t.dueDate} IS NULL`, t.dueDate, t.id)
      .limit(MAX_LIST_LIMIT);
  }

  async findTask(dealId: string, taskId: string): Promise<DealTaskRow | null> {
    const t = dealsSchema.dealTasks;
    const rows = await this.db
      .select()
      .from(t)
      .where(and(eq(t.id, taskId), eq(t.dealId, dealId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async setTaskDone(taskId: string, isDone: boolean) {
    await this.db
      .update(dealsSchema.dealTasks)
      .set({ isDone, doneAt: isDone ? new Date() : null })
      .where(eq(dealsSchema.dealTasks.id, taskId));
  }

  async findAttachment(dealId: string, attachmentId: string): Promise<DealAttachmentRow | null> {
    const t = dealsSchema.dealAttachments;
    const rows = await this.db
      .select()
      .from(t)
      .where(and(eq(t.id, attachmentId), eq(t.dealId, dealId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertAttachment(row: typeof dealsSchema.dealAttachments.$inferInsert) {
    await this.db.insert(dealsSchema.dealAttachments).values(row);
  }

  async deleteAttachment(attachmentId: string) {
    await this.db.delete(dealsSchema.dealAttachments).where(eq(dealsSchema.dealAttachments.id, attachmentId));
  }

  // ---------- 見込客担当者 ----------
  async findProspectContacts(partnerId?: string): Promise<ProspectContactRow[]> {
    const t = dealsSchema.prospectContacts;
    return this.db
      .select()
      .from(t)
      .where(partnerId ? eq(t.partnerId, partnerId) : undefined)
      .orderBy(t.name)
      .limit(MAX_LIST_LIMIT);
  }

  // CSV一括取込の氏名照合用: 複数の取引先(見込み客)の担当者をまとめて取得する
  findProspectContactsByPartnerIds(partnerIds: string[]): Promise<ProspectContactRow[]> {
    return this.inChunks(partnerIds, (chunk) =>
      this.db
        .select()
        .from(dealsSchema.prospectContacts)
        .where(inArray(dealsSchema.prospectContacts.partnerId, chunk)),
    );
  }

  findProspectContactsByIds(ids: string[]): Promise<ProspectContactRow[]> {
    return this.inChunks(ids, (chunk) =>
      this.db
        .select()
        .from(dealsSchema.prospectContacts)
        .where(inArray(dealsSchema.prospectContacts.id, chunk)),
    );
  }

  async findProspectContact(id: string): Promise<ProspectContactRow | null> {
    return (await this.findProspectContactsByIds([id]))[0] ?? null;
  }

  async insertProspectContact(row: typeof dealsSchema.prospectContacts.$inferInsert) {
    await this.db.insert(dealsSchema.prospectContacts).values(row);
  }

  async updateProspectContact(id: string, row: Partial<typeof dealsSchema.prospectContacts.$inferInsert>) {
    await this.db.update(dealsSchema.prospectContacts).set(row).where(eq(dealsSchema.prospectContacts.id, id));
  }

  async deleteProspectContact(id: string) {
    await this.db.delete(dealsSchema.prospectContacts).where(eq(dealsSchema.prospectContacts.id, id));
  }

  // ---------- メインDB(取引先・社員・取引先担当者・見積)の参照 ----------
  async findPartnerNames(ids: string[]): Promise<Map<string, string>> {
    return findPartnerNames(this.main, ids);
  }

  async partnerExists(id: string): Promise<boolean> {
    return (await this.findPartnerNames([id])).has(id);
  }

  async findUserNames(employeeNumbers: string[]): Promise<Map<string, string>> {
    return findUserNames(this.main, employeeNumbers);
  }

  // 取引先担当者マスタ(登録済みの相手方担当者)
  findPartnerContactsByIds(ids: string[]) {
    return this.inChunks(ids, (chunk) =>
      this.main
        .select({
          id: schema.partnerContacts.id,
          partnerId: schema.partnerContacts.partnerId,
          name: schema.partnerContacts.name,
          departmentName: schema.partnerContacts.departmentName,
        })
        .from(schema.partnerContacts)
        .where(inArray(schema.partnerContacts.id, chunk)),
    );
  }

  // CSV一括取込の氏名照合用: 複数の取引先の担当者(取引先担当者マスタ)をまとめて取得する
  findPartnerContactsByPartnerIds(partnerIds: string[]) {
    return this.inChunks(partnerIds, (chunk) =>
      this.main
        .select({
          id: schema.partnerContacts.id,
          partnerId: schema.partnerContacts.partnerId,
          name: schema.partnerContacts.name,
          departmentName: schema.partnerContacts.departmentName,
        })
        .from(schema.partnerContacts)
        .where(inArray(schema.partnerContacts.partnerId, chunk)),
    );
  }

  // 商談の面談者として選べる取引先担当者(相手方=CUSTOMER_CONTACT/SUPPLIER_CONTACT)
  findPartnerContactsByPartner(partnerId: string) {
    return this.main
      .select({
        id: schema.partnerContacts.id,
        name: schema.partnerContacts.name,
        departmentName: schema.partnerContacts.departmentName,
        contactType: schema.partnerContacts.contactType,
      })
      .from(schema.partnerContacts)
      .where(eq(schema.partnerContacts.partnerId, partnerId));
  }

  findQuotesByIds(ids: string[]) {
    return this.inChunks(ids, (chunk) =>
      this.main
        .select({
          id: schema.quotes.id,
          partnerId: schema.quotes.partnerId,
          title: schema.quotes.title,
          status: schema.quotes.status,
          quoteDate: schema.quotes.quoteDate,
          totalAmount: schema.quotes.totalAmount,
        })
        .from(schema.quotes)
        .where(inArray(schema.quotes.id, chunk)),
    );
  }

  // 商談に紐づけられる見積の候補(同じ取引先の見積。新しい順)
  findQuotesByPartner(partnerId: string) {
    return this.main
      .select({
        id: schema.quotes.id,
        partnerId: schema.quotes.partnerId,
        title: schema.quotes.title,
        status: schema.quotes.status,
        quoteDate: schema.quotes.quoteDate,
        totalAmount: schema.quotes.totalAmount,
      })
      .from(schema.quotes)
      .where(eq(schema.quotes.partnerId, partnerId))
      .orderBy(desc(schema.quotes.quoteDate), desc(schema.quotes.id))
      .limit(MAX_LIST_LIMIT);
  }
}
