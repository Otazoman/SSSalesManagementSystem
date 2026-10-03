import { drizzle } from "drizzle-orm/d1";
import { eq, and, or, sql, count, gt, lt, lte, gte, isNull, isNotNull } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { GetItemStructuresQuery } from "./item-structures.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム
const ITEM_STRUCTURES_SORT_COLUMNS = {
  parentItemId: schema.itemStructures.parentItemId,
  childItemId: schema.itemStructures.childItemId,
  revision: schema.itemStructures.revision,
  quantityRequired: schema.itemStructures.quantityRequired,
  validFrom: schema.itemStructures.validFrom,
  validTo: schema.itemStructures.validTo,
  status: schema.itemStructures.status,
};

export type ItemStructureRecord = typeof schema.itemStructures.$inferSelect;
export type NewItemStructureRecord = typeof schema.itemStructures.$inferInsert;

export class ItemStructuresRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  /**
   * 既にDrizzle化済みのdbインスタンスから構築する(workflow-engine/target-adapters等、
   * raw D1Databaseではなくワークフロー共通の既存db(AppDb)しか持たない文脈向け)。
   */
  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): ItemStructuresRepository {
    const repo: ItemStructuresRepository = Object.create(
      ItemStructuresRepository.prototype,
    );
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  async findItemById(id: string) {
    const result = await this.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, id))
      .limit(1);
    return result[0] || null;
  }

  private buildConditions(query: GetItemStructuresQuery) {
    const conditions = [];
    if (query.parentItemId) {
      conditions.push(
        containsText(schema.itemStructures.parentItemId, query.parentItemId),
      );
    }
    if (query.childItemId) {
      conditions.push(
        containsText(schema.itemStructures.childItemId, query.childItemId),
      );
    }
    if (query.revision) {
      conditions.push(eq(schema.itemStructures.revision, query.revision));
    }
    if (query.status && query.status !== "all") {
      conditions.push(eq(schema.itemStructures.status, query.status));
    }
    if (query.periodStatus && query.periodStatus !== "all") {
      // frontendのgetPeriodStatus()と同じ判定基準(現在時刻比較)をSQL条件として再現する
      const now = new Date();
      if (query.periodStatus === "future") {
        conditions.push(gt(schema.itemStructures.validFrom, now));
      } else if (query.periodStatus === "expired") {
        conditions.push(
          and(
            isNotNull(schema.itemStructures.validTo),
            lt(schema.itemStructures.validTo, now),
          )!,
        );
      } else if (query.periodStatus === "current") {
        conditions.push(
          lte(schema.itemStructures.validFrom, now),
          or(
            isNull(schema.itemStructures.validTo),
            gte(schema.itemStructures.validTo, now),
          )!,
        );
      }
    }
    return conditions;
  }

  async findManyWithDetails(query: GetItemStructuresQuery, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, ITEM_STRUCTURES_SORT_COLUMNS);
    const base = this.db
      .select({
        id: schema.itemStructures.id,
        parentItemId: schema.itemStructures.parentItemId,
        parentItemName: sql<string>`(SELECT name FROM items WHERE id = "item_structures"."parent_item_id")`,
        childItemId: schema.itemStructures.childItemId,
        childItemName: schema.items.name,
        childItemStatus: schema.items.status,
        quantityRequired: schema.itemStructures.quantityRequired,
        revision: schema.itemStructures.revision,
        validFrom: schema.itemStructures.validFrom,
        validTo: schema.itemStructures.validTo,
        memo: schema.itemStructures.memo,
        status: schema.itemStructures.status,
        // customer_id -> partner_id に修正
        childUnitPrice: sql<number>`COALESCE((SELECT unit_price FROM item_prices WHERE item_id = "item_structures"."child_item_id" AND price_type = 'PURCHASE' AND partner_id IS NULL LIMIT 1), 0)`,
        // customer_id -> partner_id に修正
        subTotalCost: sql<number>`"item_structures"."quantity_required" * COALESCE((SELECT unit_price FROM item_prices WHERE item_id = "item_structures"."child_item_id" AND price_type = 'PURCHASE' AND partner_id IS NULL LIMIT 1), 0)`,
      })
      .from(schema.itemStructures)
      .innerJoin(
        schema.items,
        eq(schema.itemStructures.childItemId, schema.items.id),
      )
      .where(combineConditions(this.buildConditions(query)));
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findManyWithDetailsPage(
    query: GetItemStructuresQuery,
    params: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, ITEM_STRUCTURES_SORT_COLUMNS);
    const base = this.db
      .select({
        id: schema.itemStructures.id,
        parentItemId: schema.itemStructures.parentItemId,
        parentItemName: sql<string>`(SELECT name FROM items WHERE id = "item_structures"."parent_item_id")`,
        childItemId: schema.itemStructures.childItemId,
        childItemName: schema.items.name,
        childItemStatus: schema.items.status,
        quantityRequired: schema.itemStructures.quantityRequired,
        revision: schema.itemStructures.revision,
        validFrom: schema.itemStructures.validFrom,
        validTo: schema.itemStructures.validTo,
        memo: schema.itemStructures.memo,
        status: schema.itemStructures.status,
        childUnitPrice: sql<number>`COALESCE((SELECT unit_price FROM item_prices WHERE item_id = "item_structures"."child_item_id" AND price_type = 'PURCHASE' AND partner_id IS NULL LIMIT 1), 0)`,
        subTotalCost: sql<number>`"item_structures"."quantity_required" * COALESCE((SELECT unit_price FROM item_prices WHERE item_id = "item_structures"."child_item_id" AND price_type = 'PURCHASE' AND partner_id IS NULL LIMIT 1), 0)`,
      })
      .from(schema.itemStructures)
      .innerJoin(
        schema.items,
        eq(schema.itemStructures.childItemId, schema.items.id),
      )
      .where(combineConditions(this.buildConditions(query)));
    const q = orderBy ? base.orderBy(...orderBy) : base;
    return await q.limit(params.limit).offset(toOffset(params));
  }

  async countManyWithDetails(query: GetItemStructuresQuery): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.itemStructures)
      .innerJoin(
        schema.items,
        eq(schema.itemStructures.childItemId, schema.items.id),
      )
      .where(combineConditions(this.buildConditions(query)));
    return result[0]?.value || 0;
  }

  async findByParentChildRev(
    parentItemId: string,
    childItemId: string,
    revision: string,
  ) {
    const result = await this.db
      .select()
      .from(schema.itemStructures)
      .where(
        and(
          eq(schema.itemStructures.parentItemId, parentItemId),
          eq(schema.itemStructures.childItemId, childItemId),
          eq(schema.itemStructures.revision, revision),
        ),
      )
      .limit(1);
    return result[0] || null;
  }

  async findById(id: string) {
    const result = await this.db
      .select()
      .from(schema.itemStructures)
      .where(eq(schema.itemStructures.id, id))
      .limit(1);
    return result[0] || null;
  }

  async insert(record: NewItemStructureRecord) {
    await this.db.insert(schema.itemStructures).values(record);
  }

  async update(id: string, record: Partial<NewItemStructureRecord>) {
    await this.db
      .update(schema.itemStructures)
      .set(record)
      .where(eq(schema.itemStructures.id, id));
  }

  async delete(id: string) {
    await this.db
      .delete(schema.itemStructures)
      .where(eq(schema.itemStructures.id, id));
  }

  async updateStatus(id: string, status: string, opId: string, now: Date) {
    await this.db
      .update(schema.itemStructures)
      .set({ status, updatedBy: opId, updatedAt: now })
      .where(eq(schema.itemStructures.id, id));
  }

  async findAllForCsv(query: GetItemStructuresQuery) {
    return await this.db
      .select({
        id: schema.itemStructures.id,
        parentItemId: schema.itemStructures.parentItemId,
        childItemId: schema.itemStructures.childItemId,
        quantityRequired: schema.itemStructures.quantityRequired,
        revision: schema.itemStructures.revision,
        validFrom: schema.itemStructures.validFrom,
        validTo: schema.itemStructures.validTo,
        memo: schema.itemStructures.memo,
        status: schema.itemStructures.status,
        // customer_id -> partner_id に修正
        childUnitPrice: sql<number>`COALESCE((SELECT unit_price FROM item_prices WHERE item_id = "item_structures"."child_item_id" AND price_type = 'PURCHASE' AND partner_id IS NULL LIMIT 1), 0)`,
      })
      .from(schema.itemStructures)
      .where(combineConditions(this.buildConditions(query)));
  }

  async findActiveParents() {
    return await this.db
      .select({
        id: schema.itemStructures.parentItemId,
        name: schema.items.name,
      })
      .from(schema.itemStructures)
      .innerJoin(
        schema.items,
        eq(schema.itemStructures.parentItemId, schema.items.id),
      )
      .groupBy(schema.itemStructures.parentItemId);
  }
}
