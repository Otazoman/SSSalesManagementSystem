import { drizzle } from "drizzle-orm/d1";
import { eq, count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { BusinessLocationUpsertInput } from "./business-locations.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

type BusinessLocationSearchParams = { id?: string; name?: string; status?: string };

// ヘッダクリックソート(追加要望D)の許可カラム
const BUSINESS_LOCATIONS_SORT_COLUMNS = {
  id: schema.businessLocations.id,
  name: schema.businessLocations.name,
  status: schema.businessLocations.status,
};

export class BusinessLocationsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(
    db: ReturnType<typeof drizzle<typeof schema>>,
  ): BusinessLocationsRepository {
    const repo = Object.create(
      BusinessLocationsRepository.prototype,
    ) as BusinessLocationsRepository;
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db, "SYSTEM_USER");
  }

  private buildConditions(searchParams: BusinessLocationSearchParams) {
    const conditions = [];
    if (searchParams.id)
      conditions.push(containsText(schema.businessLocations.id, searchParams.id));
    if (searchParams.name)
      conditions.push(
        containsText(schema.businessLocations.name, searchParams.name),
      );
    if (searchParams.status && searchParams.status !== "all")
      conditions.push(eq(schema.businessLocations.status, searchParams.status));
    return conditions;
  }

  // 一覧取得
  async findBusinessLocations(
    searchParams: BusinessLocationSearchParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, BUSINESS_LOCATIONS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.businessLocations)
      .where(combineConditions(this.buildConditions(searchParams)));
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findBusinessLocationsPage(
    searchParams: BusinessLocationSearchParams,
    params: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, BUSINESS_LOCATIONS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.businessLocations)
      .where(combineConditions(this.buildConditions(searchParams)));
    const query = orderBy ? base.orderBy(...orderBy) : base;
    return await query.limit(params.limit).offset(toOffset(params));
  }

  async countBusinessLocations(
    searchParams: BusinessLocationSearchParams,
  ): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.businessLocations)
      .where(combineConditions(this.buildConditions(searchParams)));
    return result[0]?.value || 0;
  }

  // IDで1件取得
  async findById(id: string) {
    const res = await this.db
      .select()
      .from(schema.businessLocations)
      .where(eq(schema.businessLocations.id, id))
      .limit(1);
    return res[0] || null;
  }

  async updateStatus(
    id: string,
    status: string,
    opId: string,
    now: Date,
  ): Promise<void> {
    await this.db
      .update(schema.businessLocations)
      .set({ status, updatedBy: opId, updatedAt: now })
      .where(eq(schema.businessLocations.id, id));
  }

  // 個別登録
  // マスタコード自動採番: 呼び出し元(BusinessLocationsService.registerBusinessLocation)が
  // idを解決済みの前提のため、ここではidをstring必須として受ける
  async createBusinessLocation(
    data: BusinessLocationUpsertInput & { id: string },
    operatorId: string,
  ) {
    const now = new Date();
    await this.db.insert(schema.businessLocations).values({
      id: data.id,
      name: data.name,
      postalCode: data.postalCode || null,
      address: data.address || null,
      phoneNumber: data.phoneNumber || null,
      status: data.status || "temporary",
      memo: data.memo || null,
      createdBy: operatorId,
      createdAt: now,
      updatedBy: operatorId,
      updatedAt: now,
    });
  }

  // 個別更新
  async updateBusinessLocation(
    id: string,
    data: BusinessLocationUpsertInput,
    operatorId: string,
  ) {
    const now = new Date();
    await this.db
      .update(schema.businessLocations)
      .set({
        name: data.name,
        postalCode: data.postalCode || null,
        address: data.address || null,
        phoneNumber: data.phoneNumber || null,
        status: data.status || "temporary",
        memo: data.memo || null,
        updatedBy: operatorId,
        updatedAt: now,
      })
      .where(eq(schema.businessLocations.id, id));
  }

  // 削除
  async deleteBusinessLocation(id: string) {
    await this.db
      .delete(schema.businessLocations)
      .where(eq(schema.businessLocations.id, id));
  }

  // CSV用データ取得(検索条件対応)
  async findAllForCsv(searchParams: BusinessLocationSearchParams) {
    return await this.db
      .select()
      .from(schema.businessLocations)
      .where(combineConditions(this.buildConditions(searchParams)));
  }

  // 一括Upsert(CSV)
  async upsertBusinessLocationFromCsv(row: any, operatorId: string) {
    const now = new Date();
    await this.db
      .insert(schema.businessLocations)
      .values({
        id: row.id,
        name: row.name,
        postalCode: row.postalCode || null,
        address: row.address || null,
        phoneNumber: row.phoneNumber || null,
        status: row.status || "active",
        memo: row.memo || null,
        createdBy: operatorId,
        createdAt: now,
        updatedBy: operatorId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.businessLocations.id,
        set: {
          name: row.name,
          postalCode: row.postalCode || null,
          address: row.address || null,
          phoneNumber: row.phoneNumber || null,
          status: row.status || "active",
          memo: row.memo || null,
          updatedBy: operatorId,
          updatedAt: now,
        },
      });
  }
}
