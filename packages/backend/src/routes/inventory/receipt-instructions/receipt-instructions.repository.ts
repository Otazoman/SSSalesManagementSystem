import { drizzle } from "drizzle-orm/d1";
import { eq, and, count, desc, gte, lte, sum } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { GetReceiptInstructionsQuery } from "./receipt-instructions.schema";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム。未指定時は既存動作(作成日時降順)を維持する
const RECEIPT_INSTRUCTIONS_SORT_COLUMNS = {
  id: schema.itemReceiptInstructions.id,
  status: schema.itemReceiptInstructions.status,
  instructedReceiveDate: schema.itemReceiptInstructions.instructedReceiveDate,
  createdBy: schema.itemReceiptInstructions.createdBy,
  createdAt: schema.itemReceiptInstructions.createdAt,
  partnerId: schema.itemReceiptInstructions.partnerId,
  warehouseId: schema.itemReceiptInstructions.warehouseId,
};

export type ResolvedReceiptInstructionItem = {
  id: string;
  itemId: string;
  lotNumber: string;
  instructedQuantity: number;
  accountCode: string;
  memo: string | null;
};

export class ReceiptInstructionsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(
    db: ReturnType<typeof drizzle<typeof schema>>,
  ): ReceiptInstructionsRepository {
    const repo = Object.create(
      ReceiptInstructionsRepository.prototype,
    ) as ReceiptInstructionsRepository;
    repo.db = db;
    return repo;
  }

  async createInstruction(
    headerId: string,
    partnerId: string,
    warehouseId: string,
    instructedReceiveDate: Date,
    memo: string | null,
    resolvedItems: ResolvedReceiptInstructionItem[],
    status: "UNAPPROVED" | "APPROVED",
    operatorId: string,
    now: Date,
  ) {
    const batchQueries: [any, ...any[]] = [
      this.db.insert(schema.itemReceiptInstructions).values({
        id: headerId,
        partnerId,
        warehouseId,
        instructedReceiveDate,
        memo,
        status,
        createdBy: operatorId,
        createdAt: now,
      }),
    ];

    resolvedItems.forEach((item) => {
      batchQueries.push(
        this.db.insert(schema.itemReceiptInstructionItems).values({
          id: item.id,
          instructionHeaderId: headerId,
          itemId: item.itemId,
          lotNumber: item.lotNumber,
          instructedQuantity: item.instructedQuantity,
          accountCode: item.accountCode,
          memo: item.memo,
        }),
      );
    });

    await this.db.batch(batchQueries);
  }

  async replaceInstructionItems(
    headerId: string,
    partnerId: string,
    warehouseId: string,
    instructedReceiveDate: Date,
    memo: string | null,
    resolvedItems: ResolvedReceiptInstructionItem[],
    status: "UNAPPROVED" | "APPROVED",
  ) {
    const batchQueries: [any, ...any[]] = [
      this.db
        .update(schema.itemReceiptInstructions)
        .set({ partnerId, warehouseId, instructedReceiveDate, memo, status })
        .where(eq(schema.itemReceiptInstructions.id, headerId)),
      this.db
        .delete(schema.itemReceiptInstructionItems)
        .where(eq(schema.itemReceiptInstructionItems.instructionHeaderId, headerId)),
    ];

    resolvedItems.forEach((item) => {
      batchQueries.push(
        this.db.insert(schema.itemReceiptInstructionItems).values({
          id: item.id,
          instructionHeaderId: headerId,
          itemId: item.itemId,
          lotNumber: item.lotNumber,
          instructedQuantity: item.instructedQuantity,
          accountCode: item.accountCode,
          memo: item.memo,
        }),
      );
    });

    await this.db.batch(batchQueries);
  }

  async updateHeaderStatus(id: string, status: string) {
    await this.db
      .update(schema.itemReceiptInstructions)
      .set({ status })
      .where(eq(schema.itemReceiptInstructions.id, id));
  }

  // 指示に紐づく実績(item_receipt_headers.receiptInstructionId)の消化数量を集計し、
  // 全明細の指示数量に対する充足状況からステータスを更新する(APPROVED/PARTIALLY_FULFILLED/FULFILLED
  // の間でのみ遷移させる)。明細単位ではなく指示全体の数量合計で判定する簡易実装
  async recalculateFulfillment(id: string) {
    const header = await this.findHeaderById(id);
    if (!header) return;
    if (header.status !== "APPROVED" && header.status !== "PARTIALLY_FULFILLED") return;

    const [instructedTotal, fulfilledTotal] = await Promise.all([
      this.db
        .select({ value: sum(schema.itemReceiptInstructionItems.instructedQuantity) })
        .from(schema.itemReceiptInstructionItems)
        .where(eq(schema.itemReceiptInstructionItems.instructionHeaderId, id)),
      this.db
        .select({ value: sum(schema.itemReceiptItems.receivedQuantity) })
        .from(schema.itemReceiptItems)
        .innerJoin(
          schema.itemReceiptHeaders,
          eq(schema.itemReceiptHeaders.id, schema.itemReceiptItems.receiptHeaderId),
        )
        .where(
          and(
            eq(schema.itemReceiptHeaders.receiptInstructionId, id),
            eq(schema.itemReceiptHeaders.status, "APPROVED"),
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
      .update(schema.itemReceiptInstructions)
      .set({ instructionDocumentR2Path: r2Path })
      .where(eq(schema.itemReceiptInstructions.id, id));
  }

  async insertAttachment(data: typeof schema.receiptInstructionAttachments.$inferInsert) {
    await this.db.insert(schema.receiptInstructionAttachments).values(data);
  }

  async findAttachmentByIdAndInstructionId(attachmentId: string, instructionId: string) {
    const res = await this.db
      .select()
      .from(schema.receiptInstructionAttachments)
      .where(
        and(
          eq(schema.receiptInstructionAttachments.id, attachmentId),
          eq(schema.receiptInstructionAttachments.instructionId, instructionId),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  async deleteInstruction(id: string) {
    await this.db.batch([
      this.db
        .delete(schema.itemReceiptInstructionItems)
        .where(eq(schema.itemReceiptInstructionItems.instructionHeaderId, id)),
      this.db.delete(schema.itemReceiptInstructions).where(eq(schema.itemReceiptInstructions.id, id)),
    ]);
  }

  async findHeaderById(id: string) {
    const res = await this.db
      .select()
      .from(schema.itemReceiptInstructions)
      .where(eq(schema.itemReceiptInstructions.id, id))
      .limit(1);
    return res[0] || null;
  }

  async findItemsByHeaderId(headerId: string) {
    return await this.db
      .select()
      .from(schema.itemReceiptInstructionItems)
      .where(eq(schema.itemReceiptInstructionItems.instructionHeaderId, headerId));
  }

  // 消込状況の可視化用: 指示に紐づく実績(APPROVED済みのみ)を品目×ロット単位で集計する。
  // recalculateFulfillmentと同じ突合条件だが、こちらは明細ごとの内訳を返す
  async getFulfilledQuantitiesByItem(headerId: string) {
    return await this.db
      .select({
        itemId: schema.itemReceiptItems.itemId,
        lotNumber: schema.itemReceiptItems.lotNumber,
        fulfilledQuantity: sum(schema.itemReceiptItems.receivedQuantity),
      })
      .from(schema.itemReceiptItems)
      .innerJoin(
        schema.itemReceiptHeaders,
        eq(schema.itemReceiptHeaders.id, schema.itemReceiptItems.receiptHeaderId),
      )
      .where(
        and(
          eq(schema.itemReceiptHeaders.receiptInstructionId, headerId),
          eq(schema.itemReceiptHeaders.status, "APPROVED"),
        ),
      )
      .groupBy(schema.itemReceiptItems.itemId, schema.itemReceiptItems.lotNumber);
  }

  private buildHeaderConditions(searchParams: GetReceiptInstructionsQuery) {
    const conditions = [];
    if (searchParams.status && searchParams.status !== "all")
      conditions.push(eq(schema.itemReceiptInstructions.status, searchParams.status));
    if (searchParams.startDate)
      conditions.push(
        gte(schema.itemReceiptInstructions.instructedReceiveDate, new Date(searchParams.startDate)),
      );
    if (searchParams.endDate)
      conditions.push(
        lte(schema.itemReceiptInstructions.instructedReceiveDate, new Date(searchParams.endDate)),
      );
    if (searchParams.createdBy)
      conditions.push(containsText(schema.itemReceiptInstructions.createdBy, searchParams.createdBy));
    return conditions;
  }

  async findHeadersPage(
    searchParams: GetReceiptInstructionsQuery,
    params: PaginationParams,
    sort: SortQuery = {},
  ) {
    const conditions = this.buildHeaderConditions(searchParams);
    const orderBy =
      buildOrderBy(sort, RECEIPT_INSTRUCTIONS_SORT_COLUMNS) ??
      [desc(schema.itemReceiptInstructions.createdAt)];
    return await this.db
      .select()
      .from(schema.itemReceiptInstructions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(...orderBy)
      .limit(params.limit)
      .offset(toOffset(params));
  }

  async countHeaders(searchParams: GetReceiptInstructionsQuery): Promise<number> {
    const conditions = this.buildHeaderConditions(searchParams);
    const result = await this.db
      .select({ value: count() })
      .from(schema.itemReceiptInstructions)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return result[0]?.value || 0;
  }

  async findAllForCsv(searchParams: GetReceiptInstructionsQuery) {
    const conditions = this.buildHeaderConditions(searchParams);
    return await this.db
      .select({
        headerId: schema.itemReceiptInstructions.id,
        partnerId: schema.itemReceiptInstructions.partnerId,
        warehouseId: schema.itemReceiptInstructions.warehouseId,
        instructedReceiveDate: schema.itemReceiptInstructions.instructedReceiveDate,
        status: schema.itemReceiptInstructions.status,
        headerMemo: schema.itemReceiptInstructions.memo,
        createdBy: schema.itemReceiptInstructions.createdBy,
        createdAt: schema.itemReceiptInstructions.createdAt,
        itemId: schema.itemReceiptInstructionItems.itemId,
        lotNumber: schema.itemReceiptInstructionItems.lotNumber,
        instructedQuantity: schema.itemReceiptInstructionItems.instructedQuantity,
        accountCode: schema.itemReceiptInstructionItems.accountCode,
      })
      .from(schema.itemReceiptInstructions)
      .leftJoin(
        schema.itemReceiptInstructionItems,
        eq(schema.itemReceiptInstructionItems.instructionHeaderId, schema.itemReceiptInstructions.id),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.itemReceiptInstructions.createdAt));
  }
}
