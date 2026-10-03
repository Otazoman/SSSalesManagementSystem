import { drizzle } from "drizzle-orm/d1";
import { eq, count } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { SaveTaxCategoryInput } from "./tax-categories.schema";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";

// ヘッダクリックソート(追加要望D)の許可カラム
const TAX_CATEGORIES_SORT_COLUMNS = {
  code: schema.taxCategories.code,
  name: schema.taxCategories.name,
  taxType: schema.taxCategories.taxType,
  taxRate: schema.taxCategories.taxRate,
  validFrom: schema.taxCategories.validFrom,
  validTo: schema.taxCategories.validTo,
};

export class TaxCategoriesRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  async getAllTaxCategories(sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, TAX_CATEGORIES_SORT_COLUMNS);
    const base = this.db.select().from(schema.taxCategories);
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async getTaxCategoriesPage(params: PaginationParams, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, TAX_CATEGORIES_SORT_COLUMNS);
    const base = this.db.select().from(schema.taxCategories);
    const q = orderBy ? base.orderBy(...orderBy) : base;
    return await q.limit(params.limit).offset(toOffset(params));
  }

  async countTaxCategories(): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.taxCategories);
    return result[0]?.value || 0;
  }

  async findByCode(code: string) {
    const res = await this.db
      .select()
      .from(schema.taxCategories)
      .where(eq(schema.taxCategories.code, code))
      .limit(1);
    return res[0] || null;
  }

  // 削除ガード: 商品マスタ(items.taxCategoryCode)から参照されている件数を返す
  async countItemsUsingTaxCategory(code: string): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.items)
      .where(eq(schema.items.taxCategoryCode, code));
    return result[0]?.value || 0;
  }

  async upsertTaxCategory(input: SaveTaxCategoryInput) {
    const validFromDate = input.validFrom ? new Date(input.validFrom) : null;
    const validToDate = input.validTo ? new Date(input.validTo) : null;

    await this.db
      .insert(schema.taxCategories)
      .values({
        code: input.code.trim(),
        name: input.name.trim(),
        taxType: input.taxType,
        taxRate: input.taxRate,
        validFrom: validFromDate,
        validTo: validToDate,
      })
      .onConflictDoUpdate({
        target: schema.taxCategories.code,
        set: {
          name: input.name.trim(),
          taxType: input.taxType,
          taxRate: input.taxRate,
          validFrom: validFromDate,
          validTo: validToDate,
        },
      });
  }

  async deleteTaxCategory(code: string) {
    const result = await this.db
      .delete(schema.taxCategories)
      .where(eq(schema.taxCategories.code, code));
    return result.meta.changes;
  }
}
