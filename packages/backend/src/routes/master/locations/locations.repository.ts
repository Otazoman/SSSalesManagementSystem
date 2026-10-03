import { drizzle } from "drizzle-orm/d1";
import { eq, and, count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { GetLocationsQuery } from "./locations.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム
const LOCATIONS_SORT_COLUMNS = {
  id: schema.locations.id,
  warehouseId: schema.locations.warehouseId,
  name: schema.locations.name,
  status: schema.locations.status,
  memo: schema.locations.memo,
};

export type LocationRecord = typeof schema.locations.$inferSelect;
export type NewLocationRecord = typeof schema.locations.$inferInsert;

export class LocationsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  /**
   * 既にDrizzle化済みのdbインスタンスから構築する(workflow-engine/target-adapters等、
   * raw D1Databaseではなくワークフロー共通の既存db(AppDb)しか持たない文脈向け)。
   */
  static fromDb(
    db: ReturnType<typeof drizzle<typeof schema>>,
  ): LocationsRepository {
    const repo: LocationsRepository = Object.create(LocationsRepository.prototype);
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildConditions(query: GetLocationsQuery) {
    const conditions = [];
    if (query.id) conditions.push(containsText(schema.locations.id, query.id));
    if (query.warehouseId)
      conditions.push(eq(schema.locations.warehouseId, query.warehouseId));
    if (query.name)
      conditions.push(containsText(schema.locations.name, query.name));
    if (query.status && query.status !== "all")
      conditions.push(eq(schema.locations.status, query.status));
    return conditions;
  }

  async findMany(
    query: GetLocationsQuery,
    sort: SortQuery = {},
  ): Promise<LocationRecord[]> {
    const orderBy = buildOrderBy(sort, LOCATIONS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.locations)
      .where(combineConditions(this.buildConditions(query)));
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findManyPage(
    query: GetLocationsQuery,
    params: PaginationParams,
    sort: SortQuery = {},
  ): Promise<LocationRecord[]> {
    const orderBy = buildOrderBy(sort, LOCATIONS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.locations)
      .where(combineConditions(this.buildConditions(query)));
    const q = orderBy ? base.orderBy(...orderBy) : base;
    return await q.limit(params.limit).offset(toOffset(params));
  }

  async countMany(query: GetLocationsQuery): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.locations)
      .where(combineConditions(this.buildConditions(query)));
    return result[0]?.value || 0;
  }

  async findById(id: string): Promise<LocationRecord | null> {
    const result = await this.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, id))
      .limit(1);
    return result[0] || null;
  }

  async insert(record: NewLocationRecord): Promise<void> {
    await this.db.insert(schema.locations).values(record);
  }

  async update(id: string, record: Partial<NewLocationRecord>): Promise<void> {
    await this.db
      .update(schema.locations)
      .set(record)
      .where(eq(schema.locations.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(schema.locations).where(eq(schema.locations.id, id));
  }

  async bulkUpsert(
    records: Array<{
      id: string;
      warehouseId: string;
      name: string;
      memo: string | null;
      // warehouses.repository.tsのupsertWarehouseFromCsvと同じ方針。
      // CSVにstatus列が無い/空の場合は呼び出し元(locations.service.ts)が"active"を補う
      status: string;
      opId: string;
      now: Date;
    }>,
  ): Promise<number> {
    let count = 0;
    for (const item of records) {
      await this.db
        .insert(schema.locations)
        .values({
          id: item.id,
          warehouseId: item.warehouseId,
          name: item.name,
          memo: item.memo,
          status: item.status,
          createdBy: item.opId,
          createdAt: item.now,
          updatedBy: item.opId,
          updatedAt: item.now,
        })
        .onConflictDoUpdate({
          target: schema.locations.id,
          set: {
            warehouseId: item.warehouseId,
            name: item.name,
            memo: item.memo,
            status: item.status,
            updatedBy: item.opId,
            updatedAt: item.now,
          },
        });
      count++;
    }
    return count;
  }
}
