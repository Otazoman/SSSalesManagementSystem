import { drizzle } from "drizzle-orm/d1";
import { eq, and, count, desc, gte, lte } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { GetAuditsQuery } from "./audits.schema";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム。未指定時は既存動作(作成日時降順)を維持する
const AUDITS_SORT_COLUMNS = {
  id: schema.stockAudits.id,
  status: schema.stockAudits.status,
  createdBy: schema.stockAudits.createdBy,
  createdAt: schema.stockAudits.createdAt,
  itemId: schema.stockAudits.itemId,
  locationId: schema.stockAudits.locationId,
  theoreticalQuantity: schema.stockAudits.theoreticalQuantity,
  countedQuantity: schema.stockAudits.countedQuantity,
  differenceQuantity: schema.stockAudits.differenceQuantity,
  memo: schema.stockAudits.memo,
};

export type AuditRecord = {
  id: string;
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  accountCode: string;
  qualityStatus: string;
  theoreticalQuantity: number;
  countedQuantity: number;
  differenceQuantity: number;
  memo: string | null;
  qrCodeKey: string | null;
};

export class AuditsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): AuditsRepository {
    const repo = Object.create(AuditsRepository.prototype) as AuditsRepository;
    repo.db = db;
    return repo;
  }

  async createAudit(
    id: string,
    record: AuditRecord,
    status: "UNAPPROVED" | "APPROVED",
    operatorId: string,
    now: Date,
  ) {
    await this.db.insert(schema.stockAudits).values({
      id,
      itemId: record.itemId,
      warehouseId: record.warehouseId,
      locationId: record.locationId,
      lotNumber: record.lotNumber,
      accountCode: record.accountCode,
      qualityStatus: record.qualityStatus,
      theoreticalQuantity: record.theoreticalQuantity,
      countedQuantity: record.countedQuantity,
      differenceQuantity: record.differenceQuantity,
      status,
      memo: record.memo,
      qrCodeKey: record.qrCodeKey,
      createdBy: operatorId,
      createdAt: now,
    });
  }

  // 修正して再提出: 同じidのまま内容を書き換える(単一行のためitems側の削除→再insertは不要)
  async updateAudit(
    id: string,
    record: AuditRecord,
    status: "UNAPPROVED" | "APPROVED",
  ) {
    await this.db
      .update(schema.stockAudits)
      .set({
        itemId: record.itemId,
        warehouseId: record.warehouseId,
        locationId: record.locationId,
        lotNumber: record.lotNumber,
        accountCode: record.accountCode,
        qualityStatus: record.qualityStatus,
        theoreticalQuantity: record.theoreticalQuantity,
        countedQuantity: record.countedQuantity,
        differenceQuantity: record.differenceQuantity,
        status,
        memo: record.memo,
        qrCodeKey: record.qrCodeKey,
      })
      .where(eq(schema.stockAudits.id, id));
  }

  async updateStatus(id: string, status: string) {
    await this.db.update(schema.stockAudits).set({ status }).where(eq(schema.stockAudits.id, id));
  }

  async deleteAudit(id: string) {
    await this.db.delete(schema.stockAudits).where(eq(schema.stockAudits.id, id));
  }

  async findById(id: string) {
    const res = await this.db
      .select()
      .from(schema.stockAudits)
      .where(eq(schema.stockAudits.id, id))
      .limit(1);
    return res[0] || null;
  }

  private buildConditions(searchParams: GetAuditsQuery) {
    const conditions = [];
    if (searchParams.status && searchParams.status !== "all")
      conditions.push(eq(schema.stockAudits.status, searchParams.status));
    if (searchParams.startDate)
      conditions.push(gte(schema.stockAudits.createdAt, new Date(searchParams.startDate)));
    if (searchParams.endDate)
      conditions.push(lte(schema.stockAudits.createdAt, new Date(searchParams.endDate)));
    if (searchParams.createdBy)
      conditions.push(containsText(schema.stockAudits.createdBy, searchParams.createdBy));
    if (searchParams.itemId) conditions.push(eq(schema.stockAudits.itemId, searchParams.itemId));
    if (searchParams.locationId)
      conditions.push(eq(schema.stockAudits.locationId, searchParams.locationId));
    return conditions;
  }

  // 棚卸履歴一覧(新しい順)
  async findPage(searchParams: GetAuditsQuery, params: PaginationParams, sort: SortQuery = {}) {
    const conditions = this.buildConditions(searchParams);
    const orderBy = buildOrderBy(sort, AUDITS_SORT_COLUMNS) ?? [desc(schema.stockAudits.createdAt)];
    return await this.db
      .select()
      .from(schema.stockAudits)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(...orderBy)
      .limit(params.limit)
      .offset(toOffset(params));
  }

  async countAll(searchParams: GetAuditsQuery): Promise<number> {
    const conditions = this.buildConditions(searchParams);
    const result = await this.db
      .select({ value: count() })
      .from(schema.stockAudits)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return result[0]?.value || 0;
  }

  // CSV出力用: 1行=1棚卸のフラット形式(既に単一テーブルのため入出庫のようなjoinは不要)
  async findAllForCsv(searchParams: GetAuditsQuery) {
    const conditions = this.buildConditions(searchParams);
    return await this.db
      .select()
      .from(schema.stockAudits)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.stockAudits.createdAt));
  }
}
