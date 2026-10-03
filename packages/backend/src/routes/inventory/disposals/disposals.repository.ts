import { drizzle } from "drizzle-orm/d1";
import { eq, and, count, desc, gte, lte } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { GetDisposalsQuery } from "./disposals.schema";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム。未指定時は既存動作(作成日時降順)を維持する
const DISPOSALS_SORT_COLUMNS = {
  id: schema.stockDisposals.id,
  status: schema.stockDisposals.status,
  createdBy: schema.stockDisposals.createdBy,
  createdAt: schema.stockDisposals.createdAt,
  itemId: schema.stockDisposals.itemId,
  locationId: schema.stockDisposals.locationId,
  qualityStatus: schema.stockDisposals.qualityStatus,
  quantity: schema.stockDisposals.quantity,
  memo: schema.stockDisposals.memo,
};

export type DisposalRecord = {
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  accountCode: string;
  qualityStatus: string;
  quantity: number;
  memo: string | null;
};

export class DisposalsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): DisposalsRepository {
    const repo = Object.create(DisposalsRepository.prototype) as DisposalsRepository;
    repo.db = db;
    return repo;
  }

  async createDisposal(
    id: string,
    record: DisposalRecord,
    status: "UNAPPROVED" | "APPROVED",
    operatorId: string,
    now: Date,
  ) {
    await this.db.insert(schema.stockDisposals).values({
      id,
      itemId: record.itemId,
      warehouseId: record.warehouseId,
      locationId: record.locationId,
      lotNumber: record.lotNumber,
      accountCode: record.accountCode,
      qualityStatus: record.qualityStatus,
      quantity: record.quantity,
      status,
      memo: record.memo,
      createdBy: operatorId,
      createdAt: now,
    });
  }

  // 修正して再提出: 同じidのまま内容を書き換える
  async updateDisposal(
    id: string,
    record: DisposalRecord,
    status: "UNAPPROVED" | "APPROVED",
  ) {
    await this.db
      .update(schema.stockDisposals)
      .set({
        itemId: record.itemId,
        warehouseId: record.warehouseId,
        locationId: record.locationId,
        lotNumber: record.lotNumber,
        accountCode: record.accountCode,
        qualityStatus: record.qualityStatus,
        quantity: record.quantity,
        status,
        memo: record.memo,
      })
      .where(eq(schema.stockDisposals.id, id));
  }

  async updateStatus(id: string, status: string) {
    await this.db.update(schema.stockDisposals).set({ status }).where(eq(schema.stockDisposals.id, id));
  }

  async deleteDisposal(id: string) {
    await this.db.delete(schema.stockDisposals).where(eq(schema.stockDisposals.id, id));
  }

  async findById(id: string) {
    const res = await this.db
      .select()
      .from(schema.stockDisposals)
      .where(eq(schema.stockDisposals.id, id))
      .limit(1);
    return res[0] || null;
  }

  private buildConditions(searchParams: GetDisposalsQuery) {
    const conditions = [];
    if (searchParams.status && searchParams.status !== "all")
      conditions.push(eq(schema.stockDisposals.status, searchParams.status));
    if (searchParams.startDate)
      conditions.push(gte(schema.stockDisposals.createdAt, new Date(searchParams.startDate)));
    if (searchParams.endDate)
      conditions.push(lte(schema.stockDisposals.createdAt, new Date(searchParams.endDate)));
    if (searchParams.createdBy)
      conditions.push(containsText(schema.stockDisposals.createdBy, searchParams.createdBy));
    if (searchParams.itemId) conditions.push(eq(schema.stockDisposals.itemId, searchParams.itemId));
    if (searchParams.locationId)
      conditions.push(eq(schema.stockDisposals.locationId, searchParams.locationId));
    if (searchParams.warehouseId)
      conditions.push(eq(schema.stockDisposals.warehouseId, searchParams.warehouseId));
    return conditions;
  }

  // 廃棄履歴一覧(新しい順)
  async findPage(searchParams: GetDisposalsQuery, params: PaginationParams, sort: SortQuery = {}) {
    const conditions = this.buildConditions(searchParams);
    const orderBy =
      buildOrderBy(sort, DISPOSALS_SORT_COLUMNS) ?? [desc(schema.stockDisposals.createdAt)];
    return await this.db
      .select()
      .from(schema.stockDisposals)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(...orderBy)
      .limit(params.limit)
      .offset(toOffset(params));
  }

  async countAll(searchParams: GetDisposalsQuery): Promise<number> {
    const conditions = this.buildConditions(searchParams);
    const result = await this.db
      .select({ value: count() })
      .from(schema.stockDisposals)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return result[0]?.value || 0;
  }

  // CSV出力用: 1行=1廃棄のフラット形式
  async findAllForCsv(searchParams: GetDisposalsQuery) {
    const conditions = this.buildConditions(searchParams);
    return await this.db
      .select()
      .from(schema.stockDisposals)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.stockDisposals.createdAt));
  }
}
