import { drizzle } from "drizzle-orm/d1";
import { eq, and, sql, isNull, count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { BadRequestError } from "../../../platform/http/http-error";
import {
  SearchProductsQuery,
  RegisterProductInput,
  UpdateProductInput,
  AttachmentInput,
} from "./products.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { deleteOrphanedR2Attachments } from "../../../platform/r2/delete-orphaned-attachments";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText, endsWithText, startsWithText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム
const PRODUCTS_SORT_COLUMNS = {
  id: schema.items.id,
  name: schema.items.name,
  status: schema.items.status,
};

const PRODUCT_SELECT_COLUMNS = {
  id: schema.items.id,
  name: schema.items.name,
  isPurchased: schema.items.isPurchased,
  isSales: schema.items.isSales,
  isService: schema.items.isService,
  baseUnitCode: schema.items.baseUnitCode,
  taxCategoryCode: schema.items.taxCategoryCode, // ▼ 追加
  productBarcode: schema.items.productBarcode,
  accountCode: schema.items.accountCode,
  supplierId: schema.items.supplierId,
  supplierPartNumber: schema.items.supplierPartNumber,
  memo: schema.items.memo,
  status: schema.items.status,
  standardSalesPrice: sql<number>`COALESCE((SELECT unit_price FROM item_prices WHERE item_id = items.id AND price_type = 'SALES' AND partner_id IS NULL LIMIT 1), 0)`,
  standardPurchasePrice: sql<number>`COALESCE((SELECT unit_price FROM item_prices WHERE item_id = items.id AND price_type = 'PURCHASE' AND partner_id IS NULL LIMIT 1), 0)`,
};

export class ProductsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): ProductsRepository {
    const repo: ProductsRepository = Object.create(ProductsRepository.prototype);
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildSearchConditions(query: SearchProductsQuery) {
    const id = query.id?.trim();
    const name = query.name?.trim();
    const nameMode = query.nameMode || "partial";
    const barcode = query.barcode?.trim();
    const accountCode = query.accountCode?.trim();
    const statusParam = query.status?.trim();
    const filter = query.filter?.trim();
    const taxCategoryCode = query.taxCategoryCode?.trim();

    const conditions = [];
    if (id) conditions.push(containsText(schema.items.id, id));
    if (name) {
      if (nameMode === "forward")
        conditions.push(startsWithText(schema.items.name, name));
      else if (nameMode === "backward")
        conditions.push(endsWithText(schema.items.name, name));
      else if (nameMode === "exact")
        conditions.push(eq(schema.items.name, name));
      else conditions.push(containsText(schema.items.name, name));
    }
    if (barcode)
      conditions.push(containsText(schema.items.productBarcode, barcode));
    if (accountCode) conditions.push(eq(schema.items.accountCode, accountCode));
    if (statusParam && statusParam !== "all")
      conditions.push(eq(schema.items.status, statusParam as any));
    if (taxCategoryCode)
      conditions.push(eq(schema.items.taxCategoryCode, taxCategoryCode));

    if (filter === "sales") conditions.push(eq(schema.items.isSales, true));
    else if (filter === "purchased")
      conditions.push(eq(schema.items.isPurchased, true));
    else if (filter === "service")
      conditions.push(eq(schema.items.isService, true));

    return conditions;
  }

  private async attachAttachments<T extends { id: string }>(rawItems: T[]) {
    return await Promise.all(
      rawItems.map(async (item) => {
        const atts = await this.db
          .select()
          .from(schema.itemAttachments)
          .where(eq(schema.itemAttachments.itemId, item.id));
        return { ...item, attachments: atts || [] };
      }),
    );
  }

  async searchProducts(query: SearchProductsQuery, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, PRODUCTS_SORT_COLUMNS);
    const base = this.db
      .select(PRODUCT_SELECT_COLUMNS)
      .from(schema.items)
      .where(combineConditions(this.buildSearchConditions(query)));
    const rawItems = await (orderBy ? base.orderBy(...orderBy) : base);

    return await this.attachAttachments(rawItems);
  }

  async searchProductsPage(
    query: SearchProductsQuery,
    params: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, PRODUCTS_SORT_COLUMNS);
    const base = this.db
      .select(PRODUCT_SELECT_COLUMNS)
      .from(schema.items)
      .where(combineConditions(this.buildSearchConditions(query)));
    const q = orderBy ? base.orderBy(...orderBy) : base;
    const rawItems = await q.limit(params.limit).offset(toOffset(params));

    return await this.attachAttachments(rawItems);
  }

  async countProducts(query: SearchProductsQuery): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.items)
      .where(combineConditions(this.buildSearchConditions(query)));
    return result[0]?.value || 0;
  }

  // ▼ 不具合修正: エクスポート用の全件取得メソッドを実装
  async getAllProductsForExport(query: SearchProductsQuery) {
    return await this.searchProducts(query);
  }

  async findProductById(id: string) {
    const res = await this.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, id))
      .limit(1);
    return res[0] || null;
  }

  // ➕ 指定した商品に属する添付ファイルを1件取得(他商品のファイルは取得できない)
  async findAttachmentByIdAndItemId(attachmentId: string, itemId: string) {
    const res = await this.db
      .select()
      .from(schema.itemAttachments)
      .where(
        and(
          eq(schema.itemAttachments.id, attachmentId),
          eq(schema.itemAttachments.itemId, itemId),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  // マスタコード自動採番: 呼び出し元(ProductsService.registerProduct)がidを解決済みの前提のため、
  // ここではidをstring必須として受ける
  async createProduct(
    input: RegisterProductInput & { id: string },
    opId: string,
    now: Date,
    status: string = "temporary",
  ) {
    const newItemId = input.id.trim();

    // BUG-044: 品目と標準単価(販売・仕入)は1回の batch で登録する(途中で失敗した時に、単価の無い品目が残らないように)
    const salesPriceVal = Number(input.standardSalesPrice || 0);
    const purchasePriceVal = Number(input.standardPurchasePrice || 0);
    await this.db.batch([
      this.db.insert(schema.items).values({
        id: newItemId,
        name: input.name.trim(),
        isPurchased: !!input.isPurchased,
        isSales: !!input.isSales,
        isService: !!input.isService,
        baseUnitCode: input.baseUnitCode || "pcs",
        taxCategoryCode: input.taxCategoryCode || "TAX_10", // ▼ 追加
        productBarcode: input.productBarcode?.trim() || null,
        accountCode: input.accountCode || null,
        supplierId: input.supplierId || null,
        supplierPartNumber: input.supplierPartNumber?.trim() || null,
        status,
        memo: input.memo?.trim() || null,
        createdBy: opId,
        createdAt: now,
        updatedBy: opId,
        updatedAt: now,
      }),
      this.db.insert(schema.itemPrices).values({
        id: `PRC-S-${newItemId}`,
        itemId: newItemId,
        priceType: "SALES",
        partnerId: null,
        unitPrice: salesPriceVal,
        unitCode: input.baseUnitCode || "pcs",
        status: "active",
        validFrom: now,
        createdBy: opId,
        createdAt: now,
        updatedBy: opId,
        updatedAt: now,
      }),
      this.db.insert(schema.itemPrices).values({
        id: `PRC-P-${newItemId}`,
        itemId: newItemId,
        priceType: "PURCHASE",
        partnerId: null,
        unitPrice: purchasePriceVal,
        unitCode: input.baseUnitCode || "pcs",
        status: "active",
        validFrom: now,
        createdBy: opId,
        createdAt: now,
        updatedBy: opId,
        updatedAt: now,
      }),
      ...(Array.isArray(input.attachments) ? this.attachmentInserts(newItemId, input.attachments, opId, now) : []),
    ]);
  }

  async updateProduct(
    id: string,
    input: UpdateProductInput,
    opId: string,
    now: Date,
    bucket: R2Bucket,
  ) {
    // BUG-048: 読み取り(既存の標準単価・添付)を先に済ませ、品目・標準単価(販売・仕入)・添付の入れ替えを1回の batch で書き込む。
    // 不要になった R2 のファイルは、DB の書き込みが成功した後に消す(先に消すと、書き込みが失敗した時に DB が参照するファイルが無くなる)
    const findStandardPrice = async (priceType: "SALES" | "PURCHASE") =>
      (
        await this.db
          .select()
          .from(schema.itemPrices)
          .where(
            and(
              eq(schema.itemPrices.itemId, id),
              eq(schema.itemPrices.priceType, priceType),
              isNull(schema.itemPrices.partnerId),
            ),
          )
          .limit(1)
      )[0];
    const existingSalesPrice = await findStandardPrice("SALES");
    const existingPurchasePrice = await findStandardPrice("PURCHASE");
    const oldAttachments = await this.db
      .select()
      .from(schema.itemAttachments)
      .where(eq(schema.itemAttachments.itemId, id));

    // 単価更新（省略なしで従来通り）: 既存があれば更新、無ければ登録
    const upsertStandardPrice = (
      priceType: "SALES" | "PURCHASE",
      existing: typeof existingSalesPrice,
      unitPrice: number,
    ) =>
      existing
        ? this.db
            .update(schema.itemPrices)
            .set({ unitPrice, unitCode: input.baseUnitCode, updatedBy: opId, updatedAt: now })
            .where(eq(schema.itemPrices.id, existing.id))
        : this.db.insert(schema.itemPrices).values({
            id: `${priceType === "SALES" ? "PRC-S" : "PRC-P"}-${id}`,
            itemId: id,
            priceType,
            partnerId: null,
            unitPrice,
            unitCode: input.baseUnitCode,
            status: "active",
            validFrom: now,
            createdBy: opId,
            createdAt: now,
            updatedBy: opId,
            updatedAt: now,
          });

    await this.db.batch([
      this.db
        .update(schema.items)
        .set({
          name: input.name.trim(),
          isPurchased: !!input.isPurchased,
          isSales: !!input.isSales,
          isService: !!input.isService,
          baseUnitCode: input.baseUnitCode || "pcs",
          taxCategoryCode: input.taxCategoryCode || "TAX_10", // ▼ 追加
          productBarcode: input.productBarcode?.trim() || null,
          accountCode: input.accountCode || null,
          supplierId: input.supplierId || null,
          supplierPartNumber: input.supplierPartNumber?.trim() || null,
          status: input.status,
          memo: input.memo?.trim() || null,
          updatedBy: opId,
          updatedAt: now,
        })
        .where(eq(schema.items.id, id)),
      upsertStandardPrice("SALES", existingSalesPrice, Number(input.standardSalesPrice || 0)),
      upsertStandardPrice("PURCHASE", existingPurchasePrice, Number(input.standardPurchasePrice || 0)),
      this.db.delete(schema.itemAttachments).where(eq(schema.itemAttachments.itemId, id)),
      ...(Array.isArray(input.attachments) ? this.attachmentInserts(id, input.attachments, opId, now) : []),
    ]);

    // 古い添付ファイルのクリーンアップ処理
    await deleteOrphanedR2Attachments(
      bucket,
      oldAttachments,
      (input.attachments || []).map((att) => att.attachmentR2Path),
    );
  }

  async suspendProduct(id: string, opId: string) {
    await this.db
      .update(schema.items)
      .set({ status: "suspended", updatedBy: opId, updatedAt: new Date() })
      .where(eq(schema.items.id, id));
  }

  async updateStatus(id: string, status: string, opId: string, now: Date) {
    await this.db
      .update(schema.items)
      .set({ status, updatedBy: opId, updatedAt: now })
      .where(eq(schema.items.id, id));
  }

  async deleteProduct(id: string, bucket: R2Bucket) {
    const currentAttachments = await this.db
      .select()
      .from(schema.itemAttachments)
      .where(eq(schema.itemAttachments.itemId, id));

    // BUG-048: 添付・標準単価・品目の削除は1回の batch で行う。伝票で使われている品目は品目の削除が外部キーの制約で
    // 失敗するが、以前は先に添付・単価(と R2 のファイル)を消していたため、品目だけが残っていた。R2 のファイルは成功した後に消す。
    // registerProduct()が標準売単価・仕入単価のitemPricesを無条件に自動生成するため、
    // 削除時にも合わせて削除しないとFK制約違反で商品を物理削除できなくなる
    const results = await this.db.batch([
      this.db.delete(schema.itemAttachments).where(eq(schema.itemAttachments.itemId, id)),
      this.db.delete(schema.itemPrices).where(eq(schema.itemPrices.itemId, id)),
      this.db.delete(schema.items).where(eq(schema.items.id, id)),
    ]);

    for (const att of currentAttachments) {
      if (att.storageType === "R2" && att.attachmentR2Path) {
        try {
          await bucket.delete(att.attachmentR2Path);
        } catch (r2Err) {
          console.error(`R2ファイルの実体削除に失敗:`, r2Err);
        }
      }
    }
    return results[2].meta.changes;
  }

  async importProductRow(row: any, opId: string, now: Date) {
    let resolvedSupplierId: string | null = null;

    if (row.supplierId) {
      const partner = await this.db
        .select({ id: schema.partners.id })
        .from(schema.partners)
        .where(eq(schema.partners.id, row.supplierId))
        .limit(1);

      if (partner.length > 0) {
        resolvedSupplierId = partner[0].id;
      } else {
        throw new BadRequestError(
          `指定された仕入先コード「${row.supplierId}」は取引先マスタ(partners)に存在しません`,
        );
      }
    }

    // BUG-048: 品目と標準単価(販売・仕入)の登録・更新は1回の batch で行う
    await this.db.batch([
    this.db
      .insert(schema.items)
      .values({
        id: row.id,
        name: row.name,
        isPurchased: row.isPurchased,
        isSales: row.isSales,
        isService: row.isService,
        baseUnitCode: row.baseUnitCode,
        taxCategoryCode: row.taxCategoryCode || "TAX_10", // ▼ 追加
        productBarcode: row.productBarcode,
        accountCode: row.accountCode,
        supplierId: resolvedSupplierId,
        supplierPartNumber: row.supplierPartNumber,
        status: "active",
        memo: row.memo,
        createdBy: opId,
        createdAt: now,
        updatedBy: opId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.items.id,
        set: {
          name: row.name,
          isPurchased: row.isPurchased,
          isSales: row.isSales,
          isService: row.isService,
          baseUnitCode: row.baseUnitCode,
          taxCategoryCode: row.taxCategoryCode || "TAX_10", // ▼ 追加
          productBarcode: row.productBarcode,
          accountCode: row.accountCode,
          supplierId: resolvedSupplierId,
          supplierPartNumber: row.supplierPartNumber,
          memo: row.memo,
          updatedBy: opId,
          updatedAt: now,
        },
      }),

    // ▼ 不具合修正: 固定IDでUPSERTできるようにPRC-S-${row.id} に統一
    this.db
      .insert(schema.itemPrices)
      .values({
        id: `PRC-S-${row.id}`,
        itemId: row.id,
        priceType: "SALES",
        partnerId: null,
        unitPrice: row.salesPriceVal,
        unitCode: row.baseUnitCode,
        status: "active",
        validFrom: now,
        createdBy: opId,
        createdAt: now,
        updatedBy: opId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.itemPrices.id,
        set: {
          unitPrice: row.salesPriceVal,
          unitCode: row.baseUnitCode,
          updatedBy: opId,
          updatedAt: now,
        },
      }),

    this.db
      .insert(schema.itemPrices)
      .values({
        id: `PRC-P-${row.id}`,
        itemId: row.id,
        priceType: "PURCHASE",
        partnerId: null,
        unitPrice: row.purchasePriceVal,
        unitCode: row.baseUnitCode,
        status: "active",
        validFrom: now,
        createdBy: opId,
        createdAt: now,
        updatedBy: opId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.itemPrices.id,
        set: {
          unitPrice: row.purchasePriceVal,
          unitCode: row.baseUnitCode,
          updatedBy: opId,
          updatedAt: now,
        },
      }),
    ]);
  }

  // BUG-048: 添付の登録文を返す(呼び出し側で他の書き込みと1回の batch にまとめる)
  private attachmentInserts(
    itemId: string,
    attachments: AttachmentInput[],
    opId: string,
    now: Date,
  ) {
    return attachments.map((att) =>
      this.db.insert(schema.itemAttachments).values({
        id:
          att.id ||
          `ATT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        itemId,
        fileName: att.fileName,
        storageType: att.storageType || "R2",
        attachmentR2Path: att.attachmentR2Path || null,
        externalUrl: att.externalUrl || null,
        fileType: att.fileType || "OTHER",
        uploadedById: opId,
        uploadedAt: now,
      }),
    );
  }
}
