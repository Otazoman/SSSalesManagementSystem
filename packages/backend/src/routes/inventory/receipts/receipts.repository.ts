import { drizzle } from "drizzle-orm/d1";
import { eq, and, count, desc, gte, lte, inArray, sum } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { findMailTemplate, findTaxCategoryRates, findUnitNames } from "../../../platform/repository/common-queries";
import { CreateReceiptInput, GetReceiptsQuery } from "./receipts.schema";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム。未指定時は既存動作(作成日時降順)を維持する
const RECEIPTS_SORT_COLUMNS = {
  id: schema.itemReceiptHeaders.id,
  status: schema.itemReceiptHeaders.status,
  receivedDate: schema.itemReceiptHeaders.receivedDate,
  createdBy: schema.itemReceiptHeaders.createdBy,
  createdAt: schema.itemReceiptHeaders.createdAt,
  partnerId: schema.itemReceiptHeaders.partnerId,
  memo: schema.itemReceiptHeaders.memo,
};

export class ReceiptsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): ReceiptsRepository {
    const repo = Object.create(ReceiptsRepository.prototype) as ReceiptsRepository;
    repo.db = db;
    return repo;
  }

  async createReceipt(
    headerId: string,
    input: CreateReceiptInput,
    resolvedItems: Array<{ id: string; accountCode: string }>,
    status: "UNAPPROVED" | "APPROVED",
    operatorId: string,
    now: Date,
  ) {
    const batchQueries: [any, ...any[]] = [
      this.db.insert(schema.itemReceiptHeaders).values({
        id: headerId,
        orderId: input.orderId || null,
        receivedDate: new Date(input.receivedDate),
        supplierInvoiceNumber: input.supplierInvoiceNumber || null,
        status,
        memo: input.memo || null,
        partnerId: input.partnerId || null,
        sourceWarehouseId: input.sourceWarehouseId || null,
        receiptInstructionId: input.receiptInstructionId || null,
        createdBy: operatorId,
        createdAt: now,
      }),
    ];

    input.items.forEach((item, index) => {
      batchQueries.push(
        this.db.insert(schema.itemReceiptItems).values({
          id: resolvedItems[index].id,
          receiptHeaderId: headerId,
          orderItemId: item.orderItemId || null,
          itemId: item.itemId,
          warehouseId: item.warehouseId,
          locationId: item.locationId,
          lotNumber: item.lotNumber || "NONE",
          receivedQuantity: item.quantity,
          accountCode: resolvedItems[index].accountCode,
          inspectionStatus: item.inspectionStatus || "PASSED",
          inspectionMemo: item.inspectionMemo || null,
          qrCodeKey: item.qrCodeKey || null,
        }),
      );
    });

    await this.db.batch(batchQueries);
  }

  // 修正して再提出: ヘッダー項目と明細を丸ごと置き換える(既存明細は全削除→再insert)。
  // headerId自体は変えないため、workflow-engine.startWorkflow()を同じtargetIdで
  // 再度呼ぶことで「新規の別伝票」ではなく同一伝票の再申請として扱える
  async replaceReceiptItems(
    headerId: string,
    input: CreateReceiptInput,
    resolvedItems: Array<{ id: string; accountCode: string }>,
    status: "UNAPPROVED" | "APPROVED",
  ) {
    const batchQueries: [any, ...any[]] = [
      this.db
        .update(schema.itemReceiptHeaders)
        .set({
          orderId: input.orderId || null,
          receivedDate: new Date(input.receivedDate),
          supplierInvoiceNumber: input.supplierInvoiceNumber || null,
          memo: input.memo || null,
          partnerId: input.partnerId || null,
          sourceWarehouseId: input.sourceWarehouseId || null,
          status,
        })
        .where(eq(schema.itemReceiptHeaders.id, headerId)),
      this.db
        .delete(schema.itemReceiptItems)
        .where(eq(schema.itemReceiptItems.receiptHeaderId, headerId)),
    ];

    input.items.forEach((item, index) => {
      batchQueries.push(
        this.db.insert(schema.itemReceiptItems).values({
          id: resolvedItems[index].id,
          receiptHeaderId: headerId,
          orderItemId: item.orderItemId || null,
          itemId: item.itemId,
          warehouseId: item.warehouseId,
          locationId: item.locationId,
          lotNumber: item.lotNumber || "NONE",
          receivedQuantity: item.quantity,
          accountCode: resolvedItems[index].accountCode,
          inspectionStatus: item.inspectionStatus || "PASSED",
          inspectionMemo: item.inspectionMemo || null,
          qrCodeKey: item.qrCodeKey || null,
        }),
      );
    });

    await this.db.batch(batchQueries);
  }

  async updateHeaderStatus(id: string, status: string) {
    await this.db
      .update(schema.itemReceiptHeaders)
      .set({ status })
      .where(eq(schema.itemReceiptHeaders.id, id));
  }

  async deleteReceipt(id: string) {
    await this.db.batch([
      this.db
        .delete(schema.itemReceiptItems)
        .where(eq(schema.itemReceiptItems.receiptHeaderId, id)),
      this.db.delete(schema.itemReceiptHeaders).where(eq(schema.itemReceiptHeaders.id, id)),
    ]);
  }

  async findHeaderById(id: string) {
    const res = await this.db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(eq(schema.itemReceiptHeaders.id, id))
      .limit(1);
    return res[0] || null;
  }

  async findItemsByHeaderId(headerId: string) {
    return await this.db
      .select()
      .from(schema.itemReceiptItems)
      .where(eq(schema.itemReceiptItems.receiptHeaderId, headerId));
  }

  // 検収書発行: order_itemsはitem_receipt_itemsが持たないunitPrice/unitCode/taxCategoryCodeを
  // 持つため、orderItemId経由でleftJoinして引く(sales-order.repository.tsの
  // findItemsWithPricingByHeaderIdと同じ方針)。orderItemIdがnull、またはjoin先が無い
  // (=単独入庫)場合はunitPrice等がnullで返る
  async findItemsWithPricingByHeaderId(headerId: string) {
    return await this.db
      .select({
        id: schema.itemReceiptItems.id,
        itemId: schema.itemReceiptItems.itemId,
        warehouseId: schema.itemReceiptItems.warehouseId,
        locationId: schema.itemReceiptItems.locationId,
        lotNumber: schema.itemReceiptItems.lotNumber,
        receivedQuantity: schema.itemReceiptItems.receivedQuantity,
        accountCode: schema.itemReceiptItems.accountCode,
        orderItemId: schema.itemReceiptItems.orderItemId,
        unitPrice: schema.orderItems.unitPrice,
        unitCode: schema.orderItems.unitCode,
        taxCategoryCode: schema.orderItems.taxCategoryCode,
      })
      .from(schema.itemReceiptItems)
      .leftJoin(schema.orderItems, eq(schema.itemReceiptItems.orderItemId, schema.orderItems.id))
      .where(eq(schema.itemReceiptItems.receiptHeaderId, headerId));
  }

  // 発注→入荷の残数量チェック(purchase-order-receipt.service.tsから使用)。
  // sales-order.repository.tsのgetShippedQuantitiesByOrderItemIdsと同じ方針
  async getReceivedQuantitiesByOrderItemIds(
    orderItemIds: string[],
  ): Promise<Array<{ orderItemId: string | null; receivedQuantity: number }>> {
    if (orderItemIds.length === 0) return [];
    const rows = await this.db
      .select({
        orderItemId: schema.itemReceiptItems.orderItemId,
        receivedQuantity: sum(schema.itemReceiptItems.receivedQuantity),
      })
      .from(schema.itemReceiptItems)
      .innerJoin(
        schema.itemReceiptHeaders,
        eq(schema.itemReceiptHeaders.id, schema.itemReceiptItems.receiptHeaderId),
      )
      .where(
        and(
          inArray(schema.itemReceiptItems.orderItemId, orderItemIds),
          eq(schema.itemReceiptHeaders.status, "APPROVED"),
        ),
      )
      .groupBy(schema.itemReceiptItems.orderItemId);
    return rows.map((r) => ({
      orderItemId: r.orderItemId,
      receivedQuantity: Number(r.receivedQuantity) || 0,
    }));
  }

  // 検収書発行(発注書と同じ方式): PDF生成用 取引先(仕入先)結合取得
  async findReceiptWithPartner(id: string) {
    return await this.db
      .select({
        header: schema.itemReceiptHeaders,
        partner: schema.partners,
      })
      .from(schema.itemReceiptHeaders)
      .leftJoin(schema.partners, eq(schema.itemReceiptHeaders.partnerId, schema.partners.id))
      .where(eq(schema.itemReceiptHeaders.id, id))
      .limit(1);
  }

  async findTaxCategoryRates(): Promise<Map<string, number>> {
    return findTaxCategoryRates(this.db);
  }

  async findUnitNames(): Promise<Map<string, string>> {
    return findUnitNames(this.db);
  }

  async findMailTemplate(id: string) {
    return findMailTemplate(this.db, id);
  }

  async findApprovedReceiptsByIds(ids: string[]) {
    return await this.db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(and(inArray(schema.itemReceiptHeaders.id, ids), eq(schema.itemReceiptHeaders.status, "APPROVED")));
  }

  // K-5-1: 支払確定時の対象検証用(ステータス不問でそのまま取得し、呼び出し元で個別に検証する。
  // findApprovedReceiptsByIdsと異なりstatus絞り込みをしないのは、承認済みでない対象を選んだ場合に
  // 「見つかりません」ではなく「承認済みではありません」という具体的なエラーメッセージを出すため)
  async findReceiptHeadersByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return await this.db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(inArray(schema.itemReceiptHeaders.id, ids));
  }

  // K-5-1: 承認済み(APPROVED)かつ指定取引先の検収記録一覧(支払候補の取得用)
  async findApprovedReceiptsByPartnerId(partnerId: string) {
    return await this.db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(
        and(
          eq(schema.itemReceiptHeaders.partnerId, partnerId),
          eq(schema.itemReceiptHeaders.status, "APPROVED"),
        ),
      );
  }

  async insertReceiptAttachment(data: typeof schema.itemReceiptAttachments.$inferInsert) {
    await this.db.insert(schema.itemReceiptAttachments).values(data);
  }

  async findAttachmentsByReceiptId(receiptHeaderId: string) {
    return await this.db
      .select()
      .from(schema.itemReceiptAttachments)
      .where(eq(schema.itemReceiptAttachments.receiptHeaderId, receiptHeaderId))
      .orderBy(desc(schema.itemReceiptAttachments.uploadedAt));
  }

  async findAttachmentByIdAndReceiptId(attachmentId: string, receiptHeaderId: string) {
    const res = await this.db
      .select()
      .from(schema.itemReceiptAttachments)
      .where(
        and(
          eq(schema.itemReceiptAttachments.id, attachmentId),
          eq(schema.itemReceiptAttachments.receiptHeaderId, receiptHeaderId),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  async findLatestPdfAttachment(receiptHeaderId: string) {
    const res = await this.db
      .select()
      .from(schema.itemReceiptAttachments)
      .where(
        and(
          eq(schema.itemReceiptAttachments.receiptHeaderId, receiptHeaderId),
          eq(schema.itemReceiptAttachments.fileType, "PDF"),
        ),
      )
      .orderBy(desc(schema.itemReceiptAttachments.uploadedAt))
      .limit(1);
    return res[0] || null;
  }

  private buildHeaderConditions(searchParams: GetReceiptsQuery) {
    const conditions = [];
    if (searchParams.status && searchParams.status !== "all")
      conditions.push(eq(schema.itemReceiptHeaders.status, searchParams.status));
    if (searchParams.startDate)
      conditions.push(gte(schema.itemReceiptHeaders.receivedDate, new Date(searchParams.startDate)));
    if (searchParams.endDate)
      conditions.push(lte(schema.itemReceiptHeaders.receivedDate, new Date(searchParams.endDate)));
    if (searchParams.createdBy)
      conditions.push(containsText(schema.itemReceiptHeaders.createdBy, searchParams.createdBy));
    if (searchParams.partnerId)
      conditions.push(eq(schema.itemReceiptHeaders.partnerId, searchParams.partnerId));
    // warehouseId/locationIdは明細(itemReceiptItems)側の項目のため、該当明細を持つ
    // ヘッダーIDのサブクエリで絞り込む
    if (searchParams.warehouseId || searchParams.locationId) {
      const itemConditions = [];
      if (searchParams.warehouseId)
        itemConditions.push(eq(schema.itemReceiptItems.warehouseId, searchParams.warehouseId));
      if (searchParams.locationId)
        itemConditions.push(eq(schema.itemReceiptItems.locationId, searchParams.locationId));
      conditions.push(
        inArray(
          schema.itemReceiptHeaders.id,
          this.db
            .select({ id: schema.itemReceiptItems.receiptHeaderId })
            .from(schema.itemReceiptItems)
            .where(and(...itemConditions)),
        ),
      );
    }
    return conditions;
  }

  // 入庫履歴一覧(新しい順)
  async findHeadersPage(
    searchParams: GetReceiptsQuery,
    params: PaginationParams,
    sort: SortQuery = {},
  ) {
    const conditions = this.buildHeaderConditions(searchParams);
    const orderBy =
      buildOrderBy(sort, RECEIPTS_SORT_COLUMNS) ?? [desc(schema.itemReceiptHeaders.createdAt)];
    return await this.db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(...orderBy)
      .limit(params.limit)
      .offset(toOffset(params));
  }

  async countHeaders(searchParams: GetReceiptsQuery): Promise<number> {
    const conditions = this.buildHeaderConditions(searchParams);
    const result = await this.db
      .select({ value: count() })
      .from(schema.itemReceiptHeaders)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return result[0]?.value || 0;
  }

  // CSV出力用: ヘッダー項目を明細行ごとに繰り返した1行1明細のフラット形式で返す
  async findAllForCsv(searchParams: GetReceiptsQuery) {
    const conditions = this.buildHeaderConditions(searchParams);
    return await this.db
      .select({
        headerId: schema.itemReceiptHeaders.id,
        receivedDate: schema.itemReceiptHeaders.receivedDate,
        supplierInvoiceNumber: schema.itemReceiptHeaders.supplierInvoiceNumber,
        status: schema.itemReceiptHeaders.status,
        headerMemo: schema.itemReceiptHeaders.memo,
        partnerId: schema.itemReceiptHeaders.partnerId,
        receiptInstructionId: schema.itemReceiptHeaders.receiptInstructionId,
        createdBy: schema.itemReceiptHeaders.createdBy,
        createdAt: schema.itemReceiptHeaders.createdAt,
        itemId: schema.itemReceiptItems.itemId,
        warehouseId: schema.itemReceiptItems.warehouseId,
        locationId: schema.itemReceiptItems.locationId,
        lotNumber: schema.itemReceiptItems.lotNumber,
        receivedQuantity: schema.itemReceiptItems.receivedQuantity,
        accountCode: schema.itemReceiptItems.accountCode,
        inspectionStatus: schema.itemReceiptItems.inspectionStatus,
      })
      .from(schema.itemReceiptHeaders)
      .leftJoin(
        schema.itemReceiptItems,
        eq(schema.itemReceiptItems.receiptHeaderId, schema.itemReceiptHeaders.id),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.itemReceiptHeaders.createdAt));
  }
}
