import { drizzle } from "drizzle-orm/d1";
import { eq, and, count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { GetAccountsQuery } from "./accounts.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText, startsWithText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム
const ACCOUNTS_SORT_COLUMNS = {
  code: schema.accounts.code,
  name: schema.accounts.name,
  status: schema.accounts.status,
  externalMappingCode: schema.accounts.externalMappingCode,
  memo: schema.accounts.memo,
};

export type AccountRecord = typeof schema.accounts.$inferSelect;
export type NewAccountRecord = typeof schema.accounts.$inferInsert;

export class AccountsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): AccountsRepository {
    const repo = Object.create(AccountsRepository.prototype) as AccountsRepository;
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildConditions(query: GetAccountsQuery) {
    const conditions = [];
    if (query.code)
      conditions.push(startsWithText(schema.accounts.code, query.code));
    if (query.name)
      conditions.push(containsText(schema.accounts.name, query.name));
    if (query.status && query.status !== "all")
      conditions.push(eq(schema.accounts.status, query.status));
    return conditions;
  }

  async findMany(
    query: GetAccountsQuery,
    sort: SortQuery = {},
  ): Promise<AccountRecord[]> {
    const orderBy = buildOrderBy(sort, ACCOUNTS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.accounts)
      .where(combineConditions(this.buildConditions(query)));
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findManyPage(
    query: GetAccountsQuery,
    params: PaginationParams,
    sort: SortQuery = {},
  ): Promise<AccountRecord[]> {
    const orderBy = buildOrderBy(sort, ACCOUNTS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.accounts)
      .where(combineConditions(this.buildConditions(query)));
    const q = orderBy ? base.orderBy(...orderBy) : base;
    return await q.limit(params.limit).offset(toOffset(params));
  }

  async countMany(query: GetAccountsQuery): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.accounts)
      .where(combineConditions(this.buildConditions(query)));
    return result[0]?.value || 0;
  }

  async findByCode(code: string): Promise<AccountRecord | null> {
    const result = await this.db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.code, code))
      .limit(1);
    return result[0] || null;
  }

  async insert(record: NewAccountRecord): Promise<void> {
    await this.db.insert(schema.accounts).values(record);
  }

  async update(code: string, record: Partial<NewAccountRecord>): Promise<void> {
    await this.db
      .update(schema.accounts)
      .set(record)
      .where(eq(schema.accounts.code, code));
  }

  async delete(code: string): Promise<void> {
    await this.db.delete(schema.accounts).where(eq(schema.accounts.code, code));
  }

  async updateStatus(
    code: string,
    status: string,
    opId: string,
    now: Date,
  ): Promise<void> {
    await this.db
      .update(schema.accounts)
      .set({ status, updatedBy: opId, updatedAt: now })
      .where(eq(schema.accounts.code, code));
  }

  async bulkUpsert(
    records: Array<{
      code: string;
      name: string;
      externalMappingCode: string | null;
      status: string;
      memo: string | null;
      opId: string;
    }>,
  ): Promise<number> {
    let count = 0;
    for (const item of records) {
      await this.db
        .insert(schema.accounts)
        .values({
          code: item.code,
          name: item.name,
          externalMappingCode: item.externalMappingCode,
          status: item.status,
          memo: item.memo,
          createdBy: item.opId,
          createdAt: new Date(),
          updatedBy: item.opId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.accounts.code,
          set: {
            name: item.name,
            externalMappingCode: item.externalMappingCode,
            memo: item.memo,
            updatedBy: item.opId,
            updatedAt: new Date(),
          },
        });
      count++;
    }
    return count;
  }
}
