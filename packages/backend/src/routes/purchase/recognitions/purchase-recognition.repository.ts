import { drizzle } from "drizzle-orm/d1";
import { selectServiceItemIds } from "../../../platform/inventory/service-items";
import { sql, eq, and, asc, desc, inArray, sum } from "drizzle-orm";
import { count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { findItemAccountCodes, findMailTemplate, findTaxCategoryRates, findUnitNames, findUserByEmployeeNumber } from "../../../platform/repository/common-queries";
import { Env } from "../../../types/env";
import { SearchPurchaseRecognitionsQuery } from "./purchase-recognition.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソートの許可カラム(sales-invoice.repository.tsと同じ方針)
const PURCHASE_RECOGNITIONS_SORT_COLUMNS = {
  id: schema.purchaseRecognitions.id,
  title: schema.purchaseRecognitions.title,
  partnerId: schema.purchaseRecognitions.partnerId,
  status: schema.purchaseRecognitions.status,
  documentType: schema.purchaseRecognitions.documentType,
  recognitionDate: schema.purchaseRecognitions.recognitionDate,
  totalAmount: schema.purchaseRecognitions.totalAmount,
  paymentStatus: schema.purchaseRecognitions.paymentStatus,
  createdAt: schema.purchaseRecognitions.createdAt,
  purchasePersonEmployeeNumber: schema.purchaseRecognitions.purchasePersonEmployeeNumber,
  inputPersonEmployeeNumber: schema.purchaseRecognitions.inputPersonEmployeeNumber,
};

export class PurchaseRecognitionRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  // BUG-056・BUG-065: 品目マスタでサービス(isService)の品目id(在庫・出荷・入荷の対象外。platform/inventory/service-items.ts)
  async findServiceItemIds(itemIds: Array<string | null | undefined>): Promise<Set<string>> {
    return selectServiceItemIds(this.db, itemIds);
  }

  /**
   * 既にDrizzle化済みのdbインスタンスから構築する(workflow-engine/target-adapters等向け)。
   */
  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): PurchaseRecognitionRepository {
    const repo: PurchaseRecognitionRepository = Object.create(
      PurchaseRecognitionRepository.prototype,
    );
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildConditions(params: SearchPurchaseRecognitionsQuery) {
    const conditions = [];
    if (params.id) conditions.push(containsText(schema.purchaseRecognitions.id, params.id));
    if (params.title)
      conditions.push(containsText(schema.purchaseRecognitions.title, params.title));
    if (params.partnerId)
      conditions.push(eq(schema.purchaseRecognitions.partnerId, params.partnerId));
    if (params.orderId)
      conditions.push(eq(schema.purchaseRecognitions.orderId, params.orderId));
    if (params.status && params.status !== "all")
      conditions.push(eq(schema.purchaseRecognitions.status, params.status));
    if (params.documentType)
      conditions.push(eq(schema.purchaseRecognitions.documentType, params.documentType));
    if (params.paymentStatus)
      conditions.push(eq(schema.purchaseRecognitions.paymentStatus, params.paymentStatus));

    if (params.startDate) {
      const startTimestamp = Math.floor(
        new Date(`${params.startDate}T00:00:00+09:00`).getTime() / 1000,
      );
      conditions.push(sql`${schema.purchaseRecognitions.createdAt} >= ${startTimestamp}`);
    }
    if (params.endDate) {
      const end = new Date(`${params.endDate}T00:00:00+09:00`);
      end.setDate(end.getDate() + 1);
      const endTimestamp = Math.floor(end.getTime() / 1000);
      conditions.push(sql`${schema.purchaseRecognitions.createdAt} < ${endTimestamp}`);
    }

    if (params.purchasePerson) {
      conditions.push(
        eq(schema.purchaseRecognitions.purchasePersonEmployeeNumber, params.purchasePerson),
      );
    }

    if (params.itemName) {
      const matching = this.db
        .select({ purchaseRecognitionId: schema.purchaseRecognitionItems.purchaseRecognitionId })
        .from(schema.purchaseRecognitionItems)
        .where(containsText(schema.purchaseRecognitionItems.itemName, params.itemName));
      conditions.push(inArray(schema.purchaseRecognitions.id, matching));
    }

    return conditions;
  }

  async findRecognitions(params: SearchPurchaseRecognitionsQuery, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, PURCHASE_RECOGNITIONS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.purchaseRecognitions)
      .where(combineConditions(this.buildConditions(params)));
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findRecognitionsPage(
    params: SearchPurchaseRecognitionsQuery,
    pagination: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, PURCHASE_RECOGNITIONS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.purchaseRecognitions)
      .where(combineConditions(this.buildConditions(params)));
    const q = orderBy ? base.orderBy(...orderBy) : base;
    return await q.limit(pagination.limit).offset(toOffset(pagination));
  }

  async countRecognitions(params: SearchPurchaseRecognitionsQuery): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.purchaseRecognitions)
      .where(combineConditions(this.buildConditions(params)));
    return result[0]?.value || 0;
  }

  async findAttachmentsByRecognitionIds(recognitionIds: string[]) {
    if (recognitionIds.length === 0) return [];
    return await this.db
      .select()
      .from(schema.purchaseRecognitionAttachments)
      .where(inArray(schema.purchaseRecognitionAttachments.purchaseRecognitionId, recognitionIds));
  }

  async findExportRecognitionsWithDetails() {
    return await this.db
      .select()
      .from(schema.purchaseRecognitions)
      .leftJoin(
        schema.purchaseRecognitionItems,
        eq(schema.purchaseRecognitions.id, schema.purchaseRecognitionItems.purchaseRecognitionId),
      )
      .orderBy(
        asc(schema.purchaseRecognitions.id),
        asc(schema.purchaseRecognitionItems.sortOrder),
      );
  }

  async findUserByEmployeeNumber(empNo: string) {
    return findUserByEmployeeNumber(this.db, empNo);
  }

  async upsertRecognitionFromCsv(data: any) {
    await this.db
      .insert(schema.purchaseRecognitions)
      .values(data)
      .onConflictDoUpdate({
        target: schema.purchaseRecognitions.id,
        set: {
          title: data.title,
          partnerId: data.partnerId,
          orderId: data.orderId,
          companyDepartment: data.companyDepartment,
          recognitionDate: data.recognitionDate,
          status: data.status,
          documentType: data.documentType,
          originalRecognitionId: data.originalRecognitionId,
          totalAmount: data.totalAmount,
          taxAmount: data.taxAmount,
          memo: data.memo,
          purchasePersonEmployeeNumber: data.purchasePersonEmployeeNumber,
          inputPersonEmployeeNumber: data.inputPersonEmployeeNumber,
          paymentStatus: data.paymentStatus,
          updatedBy: data.updatedBy,
          updatedAt: data.updatedAt,
        },
      });
  }

  async deleteRecognitionItems(purchaseRecognitionId: string) {
    await this.db
      .delete(schema.purchaseRecognitionItems)
      .where(eq(schema.purchaseRecognitionItems.purchaseRecognitionId, purchaseRecognitionId));
  }

  // BUG-048: 承認済みの伝票の変更申請の承認時に、ヘッダーの更新・明細の入れ替え・履歴を1回の batch で書き込む
  // (以前は1つずつ書き込んでいたため、途中で失敗すると明細が消えたままになりえた)。itemRows が null なら明細は変えない
  async applyApprovedUpdate(
    purchaseRecognitionId: string,
    header: Partial<typeof schema.purchaseRecognitions.$inferInsert>,
    itemRows: (typeof schema.purchaseRecognitionItems.$inferInsert)[] | null,
    history: typeof schema.purchaseRecognitionHistoryLogs.$inferInsert,
  ) {
    const statements: any[] = [
      this.db.update(schema.purchaseRecognitions).set(header).where(eq(schema.purchaseRecognitions.id, purchaseRecognitionId)),
    ];
    if (itemRows) {
      statements.push(
        this.db.delete(schema.purchaseRecognitionItems).where(eq(schema.purchaseRecognitionItems.purchaseRecognitionId, purchaseRecognitionId)),
      );
      for (const row of itemRows) statements.push(this.db.insert(schema.purchaseRecognitionItems).values(row));
    }
    statements.push(this.db.insert(schema.purchaseRecognitionHistoryLogs).values(history));
    await this.db.batch(statements as [any, ...any[]]);
  }

  async insertRecognitionItem(itemData: any) {
    await this.db.insert(schema.purchaseRecognitionItems).values(itemData);
  }

  async findRecognitionById(id: string) {
    const res = await this.db
      .select()
      .from(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.id, id))
      .limit(1);
    return res[0] || null;
  }

  async findRecognitionItems(purchaseRecognitionId: string) {
    return await this.db
      .select()
      .from(schema.purchaseRecognitionItems)
      .where(eq(schema.purchaseRecognitionItems.purchaseRecognitionId, purchaseRecognitionId))
      .orderBy(asc(schema.purchaseRecognitionItems.sortOrder));
  }

  // L-1-b: 仕入計上に紐づく検収記録(入庫)。参照専用の紐づけで、支払候補の警告に使う
  async findReceiptLinkIds(purchaseRecognitionId: string): Promise<string[]> {
    const rows = await this.db
      .select({ itemReceiptId: schema.purchaseRecognitionReceipts.itemReceiptId })
      .from(schema.purchaseRecognitionReceipts)
      .where(eq(schema.purchaseRecognitionReceipts.purchaseRecognitionId, purchaseRecognitionId));
    return rows.map((r) => r.itemReceiptId);
  }

  // 紐づけ先の検証用(存在・承認状態・取引先の確認)
  async findItemReceiptsByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return await this.db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(inArray(schema.itemReceiptHeaders.id, ids));
  }

  // 仕入計上の紐づけを丸ごと置き換える(空配列なら紐づけ解除)
  // BUG-048: 削除と登録は1回の batch で行う(途中で失敗して紐づけが消えたままにならないように)
  async replaceReceiptLinks(purchaseRecognitionId: string, itemReceiptIds: string[]) {
    await this.db.batch([
      this.db
        .delete(schema.purchaseRecognitionReceipts)
        .where(eq(schema.purchaseRecognitionReceipts.purchaseRecognitionId, purchaseRecognitionId)),
      ...itemReceiptIds.map((itemReceiptId) =>
        this.db.insert(schema.purchaseRecognitionReceipts).values({
          id: crypto.randomUUID(),
          purchaseRecognitionId,
          itemReceiptId,
        }),
      ),
    ]);
  }

  async findRecognitionAttachments(purchaseRecognitionId: string) {
    return await this.db
      .select()
      .from(schema.purchaseRecognitionAttachments)
      .where(
        eq(schema.purchaseRecognitionAttachments.purchaseRecognitionId, purchaseRecognitionId),
      );
  }

  async existsRecognition(id: string) {
    const res = await this.db
      .select()
      .from(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.id, id))
      .limit(1);
    return res.length > 0;
  }

  async insertRecognition(data: any) {
    await this.db.insert(schema.purchaseRecognitions).values(data);
  }

  async insertRecognitionAttachment(data: any) {
    await this.db.insert(schema.purchaseRecognitionAttachments).values(data);
  }

  async updateRecognition(id: string, data: any) {
    await this.db
      .update(schema.purchaseRecognitions)
      .set(data)
      .where(eq(schema.purchaseRecognitions.id, id));
  }

  async deleteRecognitionAttachments(purchaseRecognitionId: string) {
    await this.db
      .delete(schema.purchaseRecognitionAttachments)
      .where(
        eq(schema.purchaseRecognitionAttachments.purchaseRecognitionId, purchaseRecognitionId),
      );
  }

  async insertHistoryLog(data: any) {
    await this.db.insert(schema.purchaseRecognitionHistoryLogs).values(data);
  }

  async deleteRecognition(id: string) {
    await this.db
      .delete(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.id, id));
  }

  // Item10 Phase5(payments): 支払確定時、対象のpurchase_recognitionsをまとめてPAIDへ更新する
  // (sales-invoice.repository.ts markInvoicesAsBilled()と同じ方針)
  async markRecognitionsAsPaid(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(schema.purchaseRecognitions)
      .set({ paymentStatus: "PAID" })
      .where(inArray(schema.purchaseRecognitions.id, ids));
  }

  async findRecognitionWithPartner(id: string) {
    return await this.db
      .select({
        purchaseRecognitions: schema.purchaseRecognitions,
        partners: schema.partners,
        users: schema.users,
        departmentName: schema.departments.name,
      })
      .from(schema.purchaseRecognitions)
      .leftJoin(schema.partners, eq(schema.purchaseRecognitions.partnerId, schema.partners.id))
      .leftJoin(
        schema.users,
        eq(
          schema.purchaseRecognitions.purchasePersonEmployeeNumber,
          schema.users.employeeNumber,
        ),
      )
      .leftJoin(schema.userRoles, eq(schema.users.id, schema.userRoles.userId))
      .leftJoin(
        schema.departments,
        eq(schema.userRoles.departmentSurrogateId, schema.departments.surrogateId),
      )
      .where(eq(schema.purchaseRecognitions.id, id))
      .limit(1);
  }

  async findTaxCategoryRates(): Promise<Map<string, number>> {
    return findTaxCategoryRates(this.db);
  }

  async findUnitNames(): Promise<Map<string, string>> {
    return findUnitNames(this.db);
  }

  // Item10: 品目連動仕訳(platform/journal/build-journal-lines.ts)の科目解決用。
  // 品目マスタに存在しないitemId(DIRECT入力等)はマップに含まれない(呼び出し元でnull扱いにする)
  async findItemAccountCodes(itemIds: string[]): Promise<Map<string, string | null>> {
    return findItemAccountCodes(this.db, itemIds);
  }

  // 発注ヘッダー取得(標準基準/入荷基準の残数量判定、isPaid判定に使う)
  async findOrderById(id: string) {
    const res = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .limit(1);
    return res[0] || null;
  }

  async findOrderItems(orderId: string) {
    return await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId))
      .orderBy(asc(schema.orderItems.sortOrder));
  }

  async findOrderItemById(id: string) {
    const res = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.id, id))
      .limit(1);
    return res[0] || null;
  }

  // receipts.repository.tsのgetReceivedQuantitiesByOrderItemIdsと同じ方針。承認済み入庫実績のみ集計
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
      receivedQuantity: Number(r.receivedQuantity || 0),
    }));
  }

  // Item10: 発注明細に対して既に仕入計上済み(APPROVED)の数量。PURCHASEは加算、RETURNは減算し、
  // DISCOUNT/CORRECTIONは数量を持たない前提のため対象外(sourceOrderItemIdが付与されないはず)
  async getRecognizedQuantitiesByOrderItemIds(
    orderItemIds: string[],
  ): Promise<Map<string, number>> {
    if (orderItemIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        sourceOrderItemId: schema.purchaseRecognitionItems.sourceOrderItemId,
        documentType: schema.purchaseRecognitions.documentType,
        quantity: sum(schema.purchaseRecognitionItems.quantity),
      })
      .from(schema.purchaseRecognitionItems)
      .innerJoin(
        schema.purchaseRecognitions,
        eq(schema.purchaseRecognitions.id, schema.purchaseRecognitionItems.purchaseRecognitionId),
      )
      .where(
        and(
          inArray(schema.purchaseRecognitionItems.sourceOrderItemId, orderItemIds),
          eq(schema.purchaseRecognitions.status, "APPROVED"),
        ),
      )
      .groupBy(
        schema.purchaseRecognitionItems.sourceOrderItemId,
        schema.purchaseRecognitions.documentType,
      );

    const result = new Map<string, number>();
    for (const row of rows) {
      if (!row.sourceOrderItemId) continue;
      const qty = Number(row.quantity || 0);
      const signedQty = row.documentType === "RETURN" ? -qty : qty;
      result.set(
        row.sourceOrderItemId,
        (result.get(row.sourceOrderItemId) || 0) + signedQty,
      );
    }
    return result;
  }

  async findAttachmentByIdAndRecognitionId(attachmentId: string, purchaseRecognitionId: string) {
    const res = await this.db
      .select()
      .from(schema.purchaseRecognitionAttachments)
      .where(
        and(
          eq(schema.purchaseRecognitionAttachments.id, attachmentId),
          eq(
            schema.purchaseRecognitionAttachments.purchaseRecognitionId,
            purchaseRecognitionId,
          ),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  async findMailTemplate(id: string) {
    return findMailTemplate(this.db, id);
  }
}
