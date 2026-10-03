import { drizzle } from "drizzle-orm/d1";
import { eq, and, count, desc, gte, lte, inArray } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { findMailTemplate } from "../../../platform/repository/common-queries";
import { GetShipmentsQuery } from "./shipments.schema";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム。未指定時は既存動作(作成日時降順)を維持する
const SHIPMENTS_SORT_COLUMNS = {
  id: schema.itemShipmentHeaders.id,
  status: schema.itemShipmentHeaders.status,
  shippedDate: schema.itemShipmentHeaders.shippedDate,
  createdBy: schema.itemShipmentHeaders.createdBy,
  createdAt: schema.itemShipmentHeaders.createdAt,
  partnerId: schema.itemShipmentHeaders.partnerId,
  memo: schema.itemShipmentHeaders.memo,
};

export type ResolvedShipmentItem = {
  id: string;
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  qualityStatus: string;
  accountCode: string;
  shippedQuantity: number;
  // Item7残課題6: この明細がどの受注明細の消込対象かを示す(任意、受注に紐づかない出庫ではnull)
  salesOrderItemId: string | null;
};

export class ShipmentsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): ShipmentsRepository {
    const repo = Object.create(ShipmentsRepository.prototype) as ShipmentsRepository;
    repo.db = db;
    return repo;
  }

  async createShipment(
    headerId: string,
    shippedDate: Date,
    memo: string | null,
    resolvedItems: ResolvedShipmentItem[],
    status: "UNAPPROVED" | "APPROVED",
    operatorId: string,
    now: Date,
    partnerId: string | null = null,
    shipmentInstructionId: string | null = null,
    salesOrderId: string | null = null,
    destinationWarehouseId: string | null = null,
  ) {
    const batchQueries: [any, ...any[]] = [
      this.db.insert(schema.itemShipmentHeaders).values({
        id: headerId,
        shippedDate,
        status,
        memo,
        partnerId,
        shipmentInstructionId,
        salesOrderId,
        destinationWarehouseId,
        createdBy: operatorId,
        createdAt: now,
      }),
    ];

    resolvedItems.forEach((item) => {
      batchQueries.push(
        this.db.insert(schema.itemShipmentItems).values({
          id: item.id,
          shipmentHeaderId: headerId,
          itemId: item.itemId,
          warehouseId: item.warehouseId,
          locationId: item.locationId,
          lotNumber: item.lotNumber,
          qualityStatus: item.qualityStatus,
          shippedQuantity: item.shippedQuantity,
          accountCode: item.accountCode,
          salesOrderItemId: item.salesOrderItemId,
        }),
      );
    });

    await this.db.batch(batchQueries);
  }

  // 修正して再提出: ヘッダー項目と明細を丸ごと置き換える(既存明細は全削除→再insert)。
  // headerId自体は変えないため、workflow-engine.startWorkflow()を同じtargetIdで
  // 再度呼ぶことで「新規の別伝票」ではなく同一伝票の再申請として扱える
  async replaceShipmentItems(
    headerId: string,
    shippedDate: Date,
    memo: string | null,
    resolvedItems: ResolvedShipmentItem[],
    status: "UNAPPROVED" | "APPROVED",
    partnerId: string | null = null,
    salesOrderId: string | null = null,
    destinationWarehouseId: string | null = null,
  ) {
    const batchQueries: [any, ...any[]] = [
      this.db
        .update(schema.itemShipmentHeaders)
        .set({ shippedDate, memo, status, partnerId, salesOrderId, destinationWarehouseId })
        .where(eq(schema.itemShipmentHeaders.id, headerId)),
      this.db
        .delete(schema.itemShipmentItems)
        .where(eq(schema.itemShipmentItems.shipmentHeaderId, headerId)),
    ];

    resolvedItems.forEach((item) => {
      batchQueries.push(
        this.db.insert(schema.itemShipmentItems).values({
          id: item.id,
          shipmentHeaderId: headerId,
          itemId: item.itemId,
          warehouseId: item.warehouseId,
          locationId: item.locationId,
          lotNumber: item.lotNumber,
          qualityStatus: item.qualityStatus,
          shippedQuantity: item.shippedQuantity,
          accountCode: item.accountCode,
          salesOrderItemId: item.salesOrderItemId,
        }),
      );
    });

    await this.db.batch(batchQueries);
  }

  async updateHeaderStatus(id: string, status: string) {
    await this.db
      .update(schema.itemShipmentHeaders)
      .set({ status })
      .where(eq(schema.itemShipmentHeaders.id, id));
  }

  async updateDeliveryNotePath(id: string, r2Path: string) {
    await this.db
      .update(schema.itemShipmentHeaders)
      .set({ deliveryNoteR2Path: r2Path })
      .where(eq(schema.itemShipmentHeaders.id, id));
  }

  async deleteShipment(id: string) {
    await this.db.batch([
      this.db
        .delete(schema.itemShipmentItems)
        .where(eq(schema.itemShipmentItems.shipmentHeaderId, id)),
      this.db
        .delete(schema.itemShipmentHeaders)
        .where(eq(schema.itemShipmentHeaders.id, id)),
    ]);
  }

  async findHeaderById(id: string) {
    const res = await this.db
      .select()
      .from(schema.itemShipmentHeaders)
      .where(eq(schema.itemShipmentHeaders.id, id))
      .limit(1);
    return res[0] || null;
  }

  // 納品書メール送信(方式A): sales-order.repository.tsのfindMailTemplate/findApprovedOrdersByIds
  // と同型のヘルパー
  async findMailTemplate(id: string) {
    return findMailTemplate(this.db, id);
  }

  async findApprovedShipmentsByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return await this.db
      .select()
      .from(schema.itemShipmentHeaders)
      .where(
        and(inArray(schema.itemShipmentHeaders.id, ids), eq(schema.itemShipmentHeaders.status, "APPROVED")),
      );
  }

  async findItemsByHeaderId(headerId: string) {
    return await this.db
      .select()
      .from(schema.itemShipmentItems)
      .where(eq(schema.itemShipmentItems.shipmentHeaderId, headerId));
  }

  // Item7残課題7: 受注に紐づく明細のみ、sales_order_itemsから単価・金額をleftJoinで引く。
  // salesOrderItemIdがnull、またはjoin先が無い(=単独出庫)場合はunitPrice/amountがnullで返る
  async findItemsWithPricingByHeaderId(headerId: string) {
    return await this.db
      .select({
        id: schema.itemShipmentItems.id,
        itemId: schema.itemShipmentItems.itemId,
        warehouseId: schema.itemShipmentItems.warehouseId,
        locationId: schema.itemShipmentItems.locationId,
        lotNumber: schema.itemShipmentItems.lotNumber,
        qualityStatus: schema.itemShipmentItems.qualityStatus,
        shippedQuantity: schema.itemShipmentItems.shippedQuantity,
        accountCode: schema.itemShipmentItems.accountCode,
        salesOrderItemId: schema.itemShipmentItems.salesOrderItemId,
        unitPrice: schema.salesOrderItems.unitPrice,
        amount: schema.salesOrderItems.amount,
      })
      .from(schema.itemShipmentItems)
      .leftJoin(
        schema.salesOrderItems,
        eq(schema.itemShipmentItems.salesOrderItemId, schema.salesOrderItems.id),
      )
      .where(eq(schema.itemShipmentItems.shipmentHeaderId, headerId));
  }

  private buildHeaderConditions(searchParams: GetShipmentsQuery) {
    const conditions = [];
    if (searchParams.status && searchParams.status !== "all")
      conditions.push(eq(schema.itemShipmentHeaders.status, searchParams.status));
    if (searchParams.startDate)
      conditions.push(gte(schema.itemShipmentHeaders.shippedDate, new Date(searchParams.startDate)));
    if (searchParams.endDate)
      conditions.push(lte(schema.itemShipmentHeaders.shippedDate, new Date(searchParams.endDate)));
    if (searchParams.createdBy)
      conditions.push(containsText(schema.itemShipmentHeaders.createdBy, searchParams.createdBy));
    if (searchParams.partnerId)
      conditions.push(eq(schema.itemShipmentHeaders.partnerId, searchParams.partnerId));
    // warehouseId/locationIdは明細(itemShipmentItems)側の項目のため、該当明細を持つ
    // ヘッダーIDのサブクエリで絞り込む
    if (searchParams.warehouseId || searchParams.locationId) {
      const itemConditions = [];
      if (searchParams.warehouseId)
        itemConditions.push(eq(schema.itemShipmentItems.warehouseId, searchParams.warehouseId));
      if (searchParams.locationId)
        itemConditions.push(eq(schema.itemShipmentItems.locationId, searchParams.locationId));
      conditions.push(
        inArray(
          schema.itemShipmentHeaders.id,
          this.db
            .select({ id: schema.itemShipmentItems.shipmentHeaderId })
            .from(schema.itemShipmentItems)
            .where(and(...itemConditions)),
        ),
      );
    }
    return conditions;
  }

  // 出庫履歴一覧(新しい順)
  async findHeadersPage(
    searchParams: GetShipmentsQuery,
    params: PaginationParams,
    sort: SortQuery = {},
  ) {
    const conditions = this.buildHeaderConditions(searchParams);
    const orderBy =
      buildOrderBy(sort, SHIPMENTS_SORT_COLUMNS) ?? [desc(schema.itemShipmentHeaders.createdAt)];
    return await this.db
      .select()
      .from(schema.itemShipmentHeaders)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(...orderBy)
      .limit(params.limit)
      .offset(toOffset(params));
  }

  async countHeaders(searchParams: GetShipmentsQuery): Promise<number> {
    const conditions = this.buildHeaderConditions(searchParams);
    const result = await this.db
      .select({ value: count() })
      .from(schema.itemShipmentHeaders)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return result[0]?.value || 0;
  }

  // CSV出力用: ヘッダー項目を明細行ごとに繰り返した1行1明細のフラット形式で返す
  async findAllForCsv(searchParams: GetShipmentsQuery) {
    const conditions = this.buildHeaderConditions(searchParams);
    return await this.db
      .select({
        headerId: schema.itemShipmentHeaders.id,
        shippedDate: schema.itemShipmentHeaders.shippedDate,
        status: schema.itemShipmentHeaders.status,
        headerMemo: schema.itemShipmentHeaders.memo,
        partnerId: schema.itemShipmentHeaders.partnerId,
        shipmentInstructionId: schema.itemShipmentHeaders.shipmentInstructionId,
        createdBy: schema.itemShipmentHeaders.createdBy,
        createdAt: schema.itemShipmentHeaders.createdAt,
        itemId: schema.itemShipmentItems.itemId,
        warehouseId: schema.itemShipmentItems.warehouseId,
        locationId: schema.itemShipmentItems.locationId,
        lotNumber: schema.itemShipmentItems.lotNumber,
        shippedQuantity: schema.itemShipmentItems.shippedQuantity,
        accountCode: schema.itemShipmentItems.accountCode,
        qualityStatus: schema.itemShipmentItems.qualityStatus,
      })
      .from(schema.itemShipmentHeaders)
      .leftJoin(
        schema.itemShipmentItems,
        eq(schema.itemShipmentItems.shipmentHeaderId, schema.itemShipmentHeaders.id),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.itemShipmentHeaders.createdAt));
  }
}
