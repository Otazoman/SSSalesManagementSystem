import { drizzle } from "drizzle-orm/d1";
import { eq, and, count, desc, gte, lte } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { GetReturnsQuery } from "./returns.schema";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム。未指定時は既存動作(作成日時降順)を維持する
const RETURNS_SORT_COLUMNS = {
  id: schema.stockReturns.id,
  status: schema.stockReturns.status,
  direction: schema.stockReturns.direction,
  createdBy: schema.stockReturns.createdBy,
  createdAt: schema.stockReturns.createdAt,
  itemId: schema.stockReturns.itemId,
  locationId: schema.stockReturns.locationId,
  quantity: schema.stockReturns.quantity,
  returnDate: schema.stockReturns.returnDate,
  returnReason: schema.stockReturns.returnReason,
};

export type ReturnRecord = {
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  accountCode: string;
  qualityStatus: string;
  direction: "OUTBOUND" | "INBOUND";
  quantity: number;
  returnReason: string | null;
  returnDate: Date;
  memo: string | null;
};

export class ReturnsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): ReturnsRepository {
    const repo = Object.create(ReturnsRepository.prototype) as ReturnsRepository;
    repo.db = db;
    return repo;
  }

  async createReturn(
    id: string,
    record: ReturnRecord,
    status: "UNAPPROVED" | "APPROVED",
    operatorId: string,
    now: Date,
  ) {
    await this.db.insert(schema.stockReturns).values({
      id,
      itemId: record.itemId,
      warehouseId: record.warehouseId,
      locationId: record.locationId,
      lotNumber: record.lotNumber,
      accountCode: record.accountCode,
      qualityStatus: record.qualityStatus,
      direction: record.direction,
      quantity: record.quantity,
      returnReason: record.returnReason,
      returnDate: record.returnDate,
      status,
      memo: record.memo,
      createdBy: operatorId,
      createdAt: now,
    });
  }

  // 修正して再提出: 同じidのまま内容を書き換える
  async updateReturn(
    id: string,
    record: ReturnRecord,
    status: "UNAPPROVED" | "APPROVED",
  ) {
    await this.db
      .update(schema.stockReturns)
      .set({
        itemId: record.itemId,
        warehouseId: record.warehouseId,
        locationId: record.locationId,
        lotNumber: record.lotNumber,
        accountCode: record.accountCode,
        qualityStatus: record.qualityStatus,
        direction: record.direction,
        quantity: record.quantity,
        returnReason: record.returnReason,
        returnDate: record.returnDate,
        status,
        memo: record.memo,
      })
      .where(eq(schema.stockReturns.id, id));
  }

  async updateStatus(id: string, status: string) {
    await this.db.update(schema.stockReturns).set({ status }).where(eq(schema.stockReturns.id, id));
  }

  async deleteReturn(id: string) {
    await this.db.delete(schema.stockReturns).where(eq(schema.stockReturns.id, id));
  }

  async findById(id: string) {
    const res = await this.db
      .select()
      .from(schema.stockReturns)
      .where(eq(schema.stockReturns.id, id))
      .limit(1);
    return res[0] || null;
  }

  private buildConditions(searchParams: GetReturnsQuery) {
    const conditions = [];
    if (searchParams.status && searchParams.status !== "all")
      conditions.push(eq(schema.stockReturns.status, searchParams.status));
    if (searchParams.direction)
      conditions.push(eq(schema.stockReturns.direction, searchParams.direction));
    if (searchParams.startDate)
      conditions.push(gte(schema.stockReturns.createdAt, new Date(searchParams.startDate)));
    if (searchParams.endDate)
      conditions.push(lte(schema.stockReturns.createdAt, new Date(searchParams.endDate)));
    if (searchParams.createdBy)
      conditions.push(containsText(schema.stockReturns.createdBy, searchParams.createdBy));
    if (searchParams.itemId) conditions.push(eq(schema.stockReturns.itemId, searchParams.itemId));
    if (searchParams.locationId)
      conditions.push(eq(schema.stockReturns.locationId, searchParams.locationId));
    if (searchParams.warehouseId)
      conditions.push(eq(schema.stockReturns.warehouseId, searchParams.warehouseId));
    return conditions;
  }

  // 返品履歴一覧(新しい順)
  async findPage(searchParams: GetReturnsQuery, params: PaginationParams, sort: SortQuery = {}) {
    const conditions = this.buildConditions(searchParams);
    const orderBy =
      buildOrderBy(sort, RETURNS_SORT_COLUMNS) ?? [desc(schema.stockReturns.createdAt)];
    return await this.db
      .select()
      .from(schema.stockReturns)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(...orderBy)
      .limit(params.limit)
      .offset(toOffset(params));
  }

  async countAll(searchParams: GetReturnsQuery): Promise<number> {
    const conditions = this.buildConditions(searchParams);
    const result = await this.db
      .select({ value: count() })
      .from(schema.stockReturns)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return result[0]?.value || 0;
  }

  // CSV出力用: 1行=1返品のフラット形式
  async findAllForCsv(searchParams: GetReturnsQuery) {
    const conditions = this.buildConditions(searchParams);
    return await this.db
      .select()
      .from(schema.stockReturns)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.stockReturns.createdAt));
  }
}
