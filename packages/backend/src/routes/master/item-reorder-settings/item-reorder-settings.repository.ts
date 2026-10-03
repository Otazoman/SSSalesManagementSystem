import { drizzle } from "drizzle-orm/d1";
import { eq, and, count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { ItemReorderSettingPayload } from "./item-reorder-settings.schema";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";

// ヘッダクリックソート(追加要望D)の許可カラム
const ITEM_REORDER_SETTINGS_SORT_COLUMNS = {
  itemId: schema.itemReorderSettings.itemId,
  itemName: schema.items.name,
  warehouseId: schema.itemReorderSettings.warehouseId,
  warehouseName: schema.warehouses.name,
  reorderPoint: schema.itemReorderSettings.reorderPoint,
  safetyStock: schema.itemReorderSettings.safetyStock,
  memo: schema.itemReorderSettings.memo,
};

export class ItemReorderSettingsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  // 一覧: 品目名・倉庫名・品目マスタの既定単位/税区分(検出ロジック用)を付与して返す
  async findAll(sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, ITEM_REORDER_SETTINGS_SORT_COLUMNS);
    const base = this.db
      .select({
        id: schema.itemReorderSettings.id,
        itemId: schema.itemReorderSettings.itemId,
        itemName: schema.items.name,
        baseUnitCode: schema.items.baseUnitCode,
        taxCategoryCode: schema.items.taxCategoryCode,
        warehouseId: schema.itemReorderSettings.warehouseId,
        warehouseName: schema.warehouses.name,
        reorderPoint: schema.itemReorderSettings.reorderPoint,
        safetyStock: schema.itemReorderSettings.safetyStock,
        memo: schema.itemReorderSettings.memo,
      })
      .from(schema.itemReorderSettings)
      .innerJoin(schema.items, eq(schema.items.id, schema.itemReorderSettings.itemId))
      .innerJoin(
        schema.warehouses,
        eq(schema.warehouses.id, schema.itemReorderSettings.warehouseId),
      );
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findById(id: string) {
    const res = await this.db
      .select()
      .from(schema.itemReorderSettings)
      .where(eq(schema.itemReorderSettings.id, id))
      .limit(1);
    return res[0] || null;
  }

  async findByItemAndWarehouse(itemId: string, warehouseId: string) {
    const res = await this.db
      .select()
      .from(schema.itemReorderSettings)
      .where(
        and(
          eq(schema.itemReorderSettings.itemId, itemId),
          eq(schema.itemReorderSettings.warehouseId, warehouseId),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  async insert(
    id: string,
    input: ItemReorderSettingPayload,
    opId: string,
    now: Date,
  ) {
    await this.db.insert(schema.itemReorderSettings).values({
      id,
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      reorderPoint: input.reorderPoint,
      safetyStock: input.safetyStock,
      memo: input.memo || null,
      createdBy: opId,
      createdAt: now,
      updatedBy: opId,
      updatedAt: now,
    });
  }

  async update(id: string, input: ItemReorderSettingPayload, opId: string, now: Date) {
    await this.db
      .update(schema.itemReorderSettings)
      .set({
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        reorderPoint: input.reorderPoint,
        safetyStock: input.safetyStock,
        memo: input.memo || null,
        updatedBy: opId,
        updatedAt: now,
      })
      .where(eq(schema.itemReorderSettings.id, id));
  }

  async delete(id: string) {
    const result = await this.db
      .delete(schema.itemReorderSettings)
      .where(eq(schema.itemReorderSettings.id, id));
    return result.meta.changes;
  }

  async count(): Promise<number> {
    const result = await this.db.select({ value: count() }).from(schema.itemReorderSettings);
    return result[0]?.value || 0;
  }
}
