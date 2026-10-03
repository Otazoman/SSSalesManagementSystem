import { drizzle } from "drizzle-orm/d1";
import { eq, and, count, desc, gte, lte, sum } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { GetShipmentInstructionsQuery } from "./shipment-instructions.schema";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム。未指定時は既存動作(作成日時降順)を維持する
const SHIPMENT_INSTRUCTIONS_SORT_COLUMNS = {
  id: schema.itemShipmentInstructions.id,
  status: schema.itemShipmentInstructions.status,
  instructedShipDate: schema.itemShipmentInstructions.instructedShipDate,
  createdBy: schema.itemShipmentInstructions.createdBy,
  createdAt: schema.itemShipmentInstructions.createdAt,
  partnerId: schema.itemShipmentInstructions.partnerId,
  warehouseId: schema.itemShipmentInstructions.warehouseId,
};

export type ResolvedShipmentInstructionItem = {
  id: string;
  itemId: string;
  lotNumber: string;
  instructedQuantity: number;
  accountCode: string;
  memo: string | null;
  // Item7残課題6: この明細がどの受注明細の消込対象かを示す(任意、単独作成ではnull)
  salesOrderItemId: string | null;
};

export class ShipmentInstructionsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(
    db: ReturnType<typeof drizzle<typeof schema>>,
  ): ShipmentInstructionsRepository {
    const repo = Object.create(
      ShipmentInstructionsRepository.prototype,
    ) as ShipmentInstructionsRepository;
    repo.db = db;
    return repo;
  }

  async createInstruction(
    headerId: string,
    partnerId: string,
    warehouseId: string,
    instructedShipDate: Date,
    memo: string | null,
    resolvedItems: ResolvedShipmentInstructionItem[],
    status: "UNAPPROVED" | "APPROVED",
    operatorId: string,
    now: Date,
    salesOrderId: string | null = null,
  ) {
    const batchQueries: [any, ...any[]] = [
      this.db.insert(schema.itemShipmentInstructions).values({
        id: headerId,
        partnerId,
        warehouseId,
        instructedShipDate,
        memo,
        status,
        salesOrderId,
        createdBy: operatorId,
        createdAt: now,
      }),
    ];

    resolvedItems.forEach((item) => {
      batchQueries.push(
        this.db.insert(schema.itemShipmentInstructionItems).values({
          id: item.id,
          instructionHeaderId: headerId,
          itemId: item.itemId,
          lotNumber: item.lotNumber,
          instructedQuantity: item.instructedQuantity,
          accountCode: item.accountCode,
          memo: item.memo,
          salesOrderItemId: item.salesOrderItemId,
        }),
      );
    });

    await this.db.batch(batchQueries);
  }

  // 修正して再提出: ヘッダー項目と明細を丸ごと置き換える(既存明細は全削除→再insert)
  async replaceInstructionItems(
    headerId: string,
    partnerId: string,
    warehouseId: string,
    instructedShipDate: Date,
    memo: string | null,
    resolvedItems: ResolvedShipmentInstructionItem[],
    status: "UNAPPROVED" | "APPROVED",
    salesOrderId: string | null = null,
  ) {
    const batchQueries: [any, ...any[]] = [
      this.db
        .update(schema.itemShipmentInstructions)
        .set({ partnerId, warehouseId, instructedShipDate, memo, status, salesOrderId })
        .where(eq(schema.itemShipmentInstructions.id, headerId)),
      this.db
        .delete(schema.itemShipmentInstructionItems)
        .where(eq(schema.itemShipmentInstructionItems.instructionHeaderId, headerId)),
    ];

    resolvedItems.forEach((item) => {
      batchQueries.push(
        this.db.insert(schema.itemShipmentInstructionItems).values({
          id: item.id,
          instructionHeaderId: headerId,
          itemId: item.itemId,
          lotNumber: item.lotNumber,
          instructedQuantity: item.instructedQuantity,
          accountCode: item.accountCode,
          memo: item.memo,
          salesOrderItemId: item.salesOrderItemId,
        }),
      );
    });

    await this.db.batch(batchQueries);
  }

  async updateHeaderStatus(id: string, status: string) {
    await this.db
      .update(schema.itemShipmentInstructions)
      .set({ status })
      .where(eq(schema.itemShipmentInstructions.id, id));
  }

  // 指示に紐づく実績(item_shipment_headers.shipmentInstructionId)の消化数量を集計し、
  // 全明細の指示数量に対する充足状況からステータスを更新する(APPROVED/PARTIALLY_FULFILLED/FULFILLED
  // の間でのみ遷移させる。UNAPPROVED/REMANDED/CANCELEDの間は呼び出し元が対象にしない前提)。
  // 明細単位(itemId/lotNumber)ではなく指示全体の数量合計で判定する簡易実装
  async recalculateFulfillment(id: string) {
    const header = await this.findHeaderById(id);
    if (!header) return;
    if (header.status !== "APPROVED" && header.status !== "PARTIALLY_FULFILLED") return;

    const [instructedTotal, fulfilledTotal] = await Promise.all([
      this.db
        .select({ value: sum(schema.itemShipmentInstructionItems.instructedQuantity) })
        .from(schema.itemShipmentInstructionItems)
        .where(eq(schema.itemShipmentInstructionItems.instructionHeaderId, id)),
      this.db
        .select({ value: sum(schema.itemShipmentItems.shippedQuantity) })
        .from(schema.itemShipmentItems)
        .innerJoin(
          schema.itemShipmentHeaders,
          eq(schema.itemShipmentHeaders.id, schema.itemShipmentItems.shipmentHeaderId),
        )
        .where(
          and(
            eq(schema.itemShipmentHeaders.shipmentInstructionId, id),
            eq(schema.itemShipmentHeaders.status, "APPROVED"),
          ),
        ),
    ]);

    const instructed = Number(instructedTotal[0]?.value || 0);
    const fulfilled = Number(fulfilledTotal[0]?.value || 0);
    const nextStatus = fulfilled <= 0 ? "APPROVED" : fulfilled >= instructed ? "FULFILLED" : "PARTIALLY_FULFILLED";
    if (nextStatus !== header.status) {
      await this.updateHeaderStatus(id, nextStatus);
    }
  }

  async updateInstructionDocumentPath(id: string, r2Path: string) {
    await this.db
      .update(schema.itemShipmentInstructions)
      .set({ instructionDocumentR2Path: r2Path })
      .where(eq(schema.itemShipmentInstructions.id, id));
  }

  async insertAttachment(data: typeof schema.shipmentInstructionAttachments.$inferInsert) {
    await this.db.insert(schema.shipmentInstructionAttachments).values(data);
  }

  async findAttachmentByIdAndInstructionId(attachmentId: string, instructionId: string) {
    const res = await this.db
      .select()
      .from(schema.shipmentInstructionAttachments)
      .where(
        and(
          eq(schema.shipmentInstructionAttachments.id, attachmentId),
          eq(schema.shipmentInstructionAttachments.instructionId, instructionId),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  async deleteInstruction(id: string) {
    await this.db.batch([
      this.db
        .delete(schema.itemShipmentInstructionItems)
        .where(eq(schema.itemShipmentInstructionItems.instructionHeaderId, id)),
      this.db.delete(schema.itemShipmentInstructions).where(eq(schema.itemShipmentInstructions.id, id)),
    ]);
  }

  async findHeaderById(id: string) {
    const res = await this.db
      .select()
      .from(schema.itemShipmentInstructions)
      .where(eq(schema.itemShipmentInstructions.id, id))
      .limit(1);
    return res[0] || null;
  }

  async findItemsByHeaderId(headerId: string) {
    return await this.db
      .select()
      .from(schema.itemShipmentInstructionItems)
      .where(eq(schema.itemShipmentInstructionItems.instructionHeaderId, headerId));
  }

  // 消込状況の可視化用: 指示に紐づく実績(APPROVED済みのみ)を品目×ロット単位で集計する。
  // recalculateFulfillmentと同じ突合条件だが、こちらは明細ごとの内訳を返す
  async getFulfilledQuantitiesByItem(headerId: string) {
    return await this.db
      .select({
        itemId: schema.itemShipmentItems.itemId,
        lotNumber: schema.itemShipmentItems.lotNumber,
        fulfilledQuantity: sum(schema.itemShipmentItems.shippedQuantity),
      })
      .from(schema.itemShipmentItems)
      .innerJoin(
        schema.itemShipmentHeaders,
        eq(schema.itemShipmentHeaders.id, schema.itemShipmentItems.shipmentHeaderId),
      )
      .where(
        and(
          eq(schema.itemShipmentHeaders.shipmentInstructionId, headerId),
          eq(schema.itemShipmentHeaders.status, "APPROVED"),
        ),
      )
      .groupBy(schema.itemShipmentItems.itemId, schema.itemShipmentItems.lotNumber);
  }

  private buildHeaderConditions(searchParams: GetShipmentInstructionsQuery) {
    const conditions = [];
    if (searchParams.status && searchParams.status !== "all")
      conditions.push(eq(schema.itemShipmentInstructions.status, searchParams.status));
    if (searchParams.startDate)
      conditions.push(
        gte(schema.itemShipmentInstructions.instructedShipDate, new Date(searchParams.startDate)),
      );
    if (searchParams.endDate)
      conditions.push(
        lte(schema.itemShipmentInstructions.instructedShipDate, new Date(searchParams.endDate)),
      );
    if (searchParams.createdBy)
      conditions.push(containsText(schema.itemShipmentInstructions.createdBy, searchParams.createdBy));
    return conditions;
  }

  async findHeadersPage(
    searchParams: GetShipmentInstructionsQuery,
    params: PaginationParams,
    sort: SortQuery = {},
  ) {
    const conditions = this.buildHeaderConditions(searchParams);
    const orderBy =
      buildOrderBy(sort, SHIPMENT_INSTRUCTIONS_SORT_COLUMNS) ??
      [desc(schema.itemShipmentInstructions.createdAt)];
    return await this.db
      .select()
      .from(schema.itemShipmentInstructions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(...orderBy)
      .limit(params.limit)
      .offset(toOffset(params));
  }

  async countHeaders(searchParams: GetShipmentInstructionsQuery): Promise<number> {
    const conditions = this.buildHeaderConditions(searchParams);
    const result = await this.db
      .select({ value: count() })
      .from(schema.itemShipmentInstructions)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return result[0]?.value || 0;
  }

  // CSV出力(指示データ作成): ヘッダー項目を明細行ごとに繰り返した1行1明細のフラット形式
  async findAllForCsv(searchParams: GetShipmentInstructionsQuery) {
    const conditions = this.buildHeaderConditions(searchParams);
    return await this.db
      .select({
        headerId: schema.itemShipmentInstructions.id,
        partnerId: schema.itemShipmentInstructions.partnerId,
        warehouseId: schema.itemShipmentInstructions.warehouseId,
        instructedShipDate: schema.itemShipmentInstructions.instructedShipDate,
        status: schema.itemShipmentInstructions.status,
        headerMemo: schema.itemShipmentInstructions.memo,
        createdBy: schema.itemShipmentInstructions.createdBy,
        createdAt: schema.itemShipmentInstructions.createdAt,
        itemId: schema.itemShipmentInstructionItems.itemId,
        lotNumber: schema.itemShipmentInstructionItems.lotNumber,
        instructedQuantity: schema.itemShipmentInstructionItems.instructedQuantity,
        accountCode: schema.itemShipmentInstructionItems.accountCode,
      })
      .from(schema.itemShipmentInstructions)
      .leftJoin(
        schema.itemShipmentInstructionItems,
        eq(schema.itemShipmentInstructionItems.instructionHeaderId, schema.itemShipmentInstructions.id),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.itemShipmentInstructions.createdAt));
  }
}
