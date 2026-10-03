import { drizzle } from "drizzle-orm/d1";
import { eq, and, sql, asc, lte, count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { ItemPriceStatus } from "./product-price.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム
const PRODUCT_PRICES_SORT_COLUMNS = {
  itemId: schema.itemPrices.itemId,
  priceType: schema.itemPrices.priceType,
  partnerId: schema.itemPrices.partnerId,
  minQuantity: schema.itemPrices.minQuantity,
  unitPrice: schema.itemPrices.unitPrice,
  status: schema.itemPrices.status,
};

type MasterListParams = {
  itemId?: string;
  priceType?: string;
  partnerId?: string;
  statusParam?: ItemPriceStatus;
};

export class ProductPriceRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): ProductPriceRepository {
    const repo: ProductPriceRepository = Object.create(ProductPriceRepository.prototype);
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  async findItemById(itemId: string) {
    const res = await this.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, itemId))
      .limit(1);
    return res[0] || null;
  }

  async findPriceById(id: string) {
    const res = await this.db
      .select()
      .from(schema.itemPrices)
      .where(eq(schema.itemPrices.id, id))
      .limit(1);
    return res[0] || null;
  }

  async findMatchingPrice(
    itemId: string,
    priceType: string,
    minQuantity: number,
    partnerId: string | null, // customerId -> partnerId
  ) {
    const matchConditions = [
      eq(schema.itemPrices.itemId, itemId),
      eq(schema.itemPrices.priceType, priceType as "SALES" | "PURCHASE"),
      eq(schema.itemPrices.minQuantity, minQuantity),
    ];

    if (partnerId) {
      matchConditions.push(eq(schema.itemPrices.partnerId, partnerId));
    } else {
      matchConditions.push(sql`${schema.itemPrices.partnerId} IS NULL`);
    }

    const res = await this.db
      .select()
      .from(schema.itemPrices)
      .where(and(...matchConditions));

    return res[0] || null;
  }

  // パターンA: 見積もり画面等からの自動計算取得
  async getPricesForCalculation(params: {
    itemId?: string;
    priceType?: string;
    partnerId?: string; // customerId -> partnerId
    quantityNum: number;
  }) {
    const conditions = [];

    if (params.itemId) {
      conditions.push(eq(schema.itemPrices.itemId, params.itemId));
    }
    conditions.push(
      eq(schema.itemPrices.priceType, params.priceType || "SALES"),
    );

    if (params.partnerId) {
      conditions.push(
        sql`((${schema.itemPrices.partnerId} = ${params.partnerId} AND ${schema.itemPrices.status} = 'active') OR ${schema.itemPrices.partnerId} IS NULL)`,
      );
    } else {
      conditions.push(sql`${schema.itemPrices.partnerId} IS NULL`);
    }

    if (params.quantityNum > 0) {
      conditions.push(lte(schema.itemPrices.minQuantity, params.quantityNum));
    }

    return await this.db
      .select()
      .from(schema.itemPrices)
      .where(combineConditions(conditions))
      .orderBy(
        sql`CASE WHEN ${schema.itemPrices.partnerId} IS NOT NULL THEN 0 ELSE 1 END`,
        sql`${schema.itemPrices.minQuantity} DESC`,
      );
  }

  private buildMasterConditions(params: MasterListParams) {
    const conditions = [];

    if (params.itemId) {
      conditions.push(containsText(schema.itemPrices.itemId, params.itemId));
    }
    if (params.priceType === "SALES" || params.priceType === "PURCHASE") {
      conditions.push(eq(schema.itemPrices.priceType, params.priceType));
    }
    if (params.partnerId) {
      if (params.partnerId === "standard") {
        conditions.push(sql`${schema.itemPrices.partnerId} IS NULL`);
      } else {
        conditions.push(eq(schema.itemPrices.partnerId, params.partnerId));
      }
    }
    if (params.statusParam) {
      conditions.push(eq(schema.itemPrices.status, params.statusParam));
    }
    return conditions;
  }

  // パターンB: マスタ管理画面からの検索
  async getPricesForMaster(params: MasterListParams, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, PRODUCT_PRICES_SORT_COLUMNS);
    return await this.db
      .select()
      .from(schema.itemPrices)
      .where(combineConditions(this.buildMasterConditions(params)))
      .orderBy(
        ...(orderBy ?? [asc(schema.itemPrices.itemId), asc(schema.itemPrices.minQuantity)]),
      );
  }

  async getPricesForMasterPage(
    params: MasterListParams,
    pagination: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, PRODUCT_PRICES_SORT_COLUMNS);
    return await this.db
      .select()
      .from(schema.itemPrices)
      .where(combineConditions(this.buildMasterConditions(params)))
      .orderBy(
        ...(orderBy ?? [asc(schema.itemPrices.itemId), asc(schema.itemPrices.minQuantity)]),
      )
      .limit(pagination.limit)
      .offset(toOffset(pagination));
  }

  async countPricesForMaster(params: MasterListParams): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.itemPrices)
      .where(combineConditions(this.buildMasterConditions(params)));
    return result[0]?.value || 0;
  }

  async updatePrice(
    id: string,
    data: {
      minQuantity?: number;
      unitPrice?: number;
      unitCode?: string;
      status?: ItemPriceStatus;
      updatedBy: string;
      updatedAt: Date;
    },
  ) {
    await this.db
      .update(schema.itemPrices)
      .set(data)
      .where(eq(schema.itemPrices.id, id));
  }

  async insertPrice(data: {
    id: string;
    itemId: string;
    priceType: "SALES" | "PURCHASE";
    partnerId: string | null; // customerId -> partnerId
    minQuantity: number;
    unitPrice: number;
    unitCode: string;
    status: ItemPriceStatus;
    validFrom: Date;
    createdBy: string;
    createdAt: Date;
    updatedBy: string;
    updatedAt: Date;
  }) {
    await this.db.insert(schema.itemPrices).values(data);
  }

  async deletePrice(id: string) {
    await this.db.delete(schema.itemPrices).where(eq(schema.itemPrices.id, id));
  }

  async updateStatus(id: string, status: ItemPriceStatus, opId: string, now: Date) {
    await this.db
      .update(schema.itemPrices)
      .set({ status, updatedBy: opId, updatedAt: now })
      .where(eq(schema.itemPrices.id, id));
  }
}
