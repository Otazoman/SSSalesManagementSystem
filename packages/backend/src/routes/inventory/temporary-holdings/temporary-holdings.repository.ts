import { drizzle } from "drizzle-orm/d1";
import { and, asc, desc, eq, like, or } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { SearchTemporaryHoldingsQuery } from "./temporary-holdings.schema";

// REQ-011(2): 一時保管の台帳(temporary_holdings)と動き(temporary_holding_movements)の永続化
export class TemporaryHoldingsRepository {
  db!: ReturnType<typeof drizzle<typeof schema>>;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): TemporaryHoldingsRepository {
    const repo: TemporaryHoldingsRepository = Object.create(TemporaryHoldingsRepository.prototype);
    repo.db = db;
    return repo;
  }

  getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  async findMany(params: SearchTemporaryHoldingsQuery) {
    const t = schema.temporaryHoldings;
    const keyword = params.keyword?.trim();
    const conditions = [
      params.category && params.category !== "all" ? eq(t.category, params.category) : undefined,
      params.status && params.status !== "all" ? eq(t.status, params.status) : undefined,
      params.warehouseId ? eq(t.warehouseId, params.warehouseId) : undefined,
      params.partnerId ? eq(t.partnerId, params.partnerId) : undefined,
      keyword ? or(like(t.itemName, `%${keyword}%`), like(t.id, `%${keyword}%`), like(t.sourceId, `%${keyword}%`)) : undefined,
    ];
    return this.db
      .select()
      .from(t)
      .where(combineConditions(conditions))
      .orderBy(desc(t.receivedDate), desc(t.id));
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(schema.temporaryHoldings).where(eq(schema.temporaryHoldings.id, id)).limit(1);
    return row ?? null;
  }

  async existsId(id: string): Promise<boolean> {
    return !!(await this.findById(id));
  }

  async insertHolding(values: typeof schema.temporaryHoldings.$inferInsert) {
    await this.db.insert(schema.temporaryHoldings).values(values);
  }

  async updateHolding(id: string, values: Partial<typeof schema.temporaryHoldings.$inferInsert>) {
    await this.db.update(schema.temporaryHoldings).set(values).where(eq(schema.temporaryHoldings.id, id));
  }

  async deleteHolding(id: string) {
    await this.db.delete(schema.temporaryHoldings).where(eq(schema.temporaryHoldings.id, id));
  }

  async findMovements(holdingId: string) {
    return this.db
      .select()
      .from(schema.temporaryHoldingMovements)
      .where(eq(schema.temporaryHoldingMovements.holdingId, holdingId))
      .orderBy(asc(schema.temporaryHoldingMovements.movementDate), asc(schema.temporaryHoldingMovements.createdAt));
  }

  async findMovementsByHoldingIds(holdingIds: string[]) {
    if (holdingIds.length === 0) return [];
    const rows = await this.db.select().from(schema.temporaryHoldingMovements);
    const ids = new Set(holdingIds);
    return rows.filter((r) => ids.has(r.holdingId));
  }

  async findMovementById(id: string) {
    const [row] = await this.db
      .select()
      .from(schema.temporaryHoldingMovements)
      .where(eq(schema.temporaryHoldingMovements.id, id))
      .limit(1);
    return row ?? null;
  }

  // REQ-011(3): 在庫へ移す動き(相手の伝票が入庫)のうち、まだ確定していないもの
  async findPendingMoveBySource(sourceId: string) {
    const [row] = await this.db
      .select()
      .from(schema.temporaryHoldingMovements)
      .where(
        and(
          eq(schema.temporaryHoldingMovements.movementType, "MOVE_TO_STOCK"),
          eq(schema.temporaryHoldingMovements.sourceType, "STOCK_RECEIPT"),
          eq(schema.temporaryHoldingMovements.sourceId, sourceId),
          eq(schema.temporaryHoldingMovements.approvalStatus, "PENDING"),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async insertMovement(values: typeof schema.temporaryHoldingMovements.$inferInsert) {
    await this.db.insert(schema.temporaryHoldingMovements).values(values);
  }

  async updateMovement(id: string, values: Partial<typeof schema.temporaryHoldingMovements.$inferInsert>) {
    await this.db.update(schema.temporaryHoldingMovements).set(values).where(eq(schema.temporaryHoldingMovements.id, id));
  }

  async deleteMovement(id: string) {
    await this.db.delete(schema.temporaryHoldingMovements).where(eq(schema.temporaryHoldingMovements.id, id));
  }

  async findOrderItem(orderId: string, itemId: string) {
    const [row] = await this.db
      .select({ item: schema.orderItems, partnerId: schema.orders.partnerId })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .where(and(eq(schema.orderItems.id, itemId), eq(schema.orderItems.orderId, orderId)))
      .limit(1);
    return row ?? null;
  }

  async findSalesOrderItem(salesOrderId: string, itemId: string) {
    const [row] = await this.db
      .select()
      .from(schema.salesOrderItems)
      .where(and(eq(schema.salesOrderItems.id, itemId), eq(schema.salesOrderItems.salesOrderId, salesOrderId)))
      .limit(1);
    return row ?? null;
  }

  async warehouseExists(id: string): Promise<boolean> {
    const [row] = await this.db.select({ id: schema.warehouses.id }).from(schema.warehouses).where(eq(schema.warehouses.id, id)).limit(1);
    return !!row;
  }

  async partnerExists(id: string): Promise<boolean> {
    const [row] = await this.db.select({ id: schema.partners.id }).from(schema.partners).where(eq(schema.partners.id, id)).limit(1);
    return !!row;
  }
}
