import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";

export type ReclassificationRecord = {
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  accountCode: string;
  fromQualityStatus: string;
  toQualityStatus: string;
  quantity: number;
  memo: string | null;
};

export class ReclassificationsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): ReclassificationsRepository {
    const repo = Object.create(ReclassificationsRepository.prototype) as ReclassificationsRepository;
    repo.db = db;
    return repo;
  }

  async createReclassification(
    id: string,
    record: ReclassificationRecord,
    status: "UNAPPROVED" | "APPROVED",
    operatorId: string,
    now: Date,
  ) {
    await this.db.insert(schema.stockReclassifications).values({
      id,
      itemId: record.itemId,
      warehouseId: record.warehouseId,
      locationId: record.locationId,
      lotNumber: record.lotNumber,
      accountCode: record.accountCode,
      fromQualityStatus: record.fromQualityStatus,
      toQualityStatus: record.toQualityStatus,
      quantity: record.quantity,
      status,
      memo: record.memo,
      createdBy: operatorId,
      createdAt: now,
    });
  }

  // 修正して再提出: 同じidのまま内容を書き換える
  async updateReclassification(
    id: string,
    record: ReclassificationRecord,
    status: "UNAPPROVED" | "APPROVED",
  ) {
    await this.db
      .update(schema.stockReclassifications)
      .set({
        itemId: record.itemId,
        warehouseId: record.warehouseId,
        locationId: record.locationId,
        lotNumber: record.lotNumber,
        accountCode: record.accountCode,
        fromQualityStatus: record.fromQualityStatus,
        toQualityStatus: record.toQualityStatus,
        quantity: record.quantity,
        status,
        memo: record.memo,
      })
      .where(eq(schema.stockReclassifications.id, id));
  }

  async updateStatus(id: string, status: string) {
    await this.db
      .update(schema.stockReclassifications)
      .set({ status })
      .where(eq(schema.stockReclassifications.id, id));
  }

  async deleteReclassification(id: string) {
    await this.db.delete(schema.stockReclassifications).where(eq(schema.stockReclassifications.id, id));
  }

  async findById(id: string) {
    const res = await this.db
      .select()
      .from(schema.stockReclassifications)
      .where(eq(schema.stockReclassifications.id, id))
      .limit(1);
    return res[0] || null;
  }
}
