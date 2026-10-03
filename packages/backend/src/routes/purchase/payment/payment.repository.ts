import { drizzle } from "drizzle-orm/d1";
import { eq, sql, asc, inArray, sum, and } from "drizzle-orm";
import { count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { findPartnerById, findUserByEmployeeNumber } from "../../../platform/repository/common-queries";
import { Env } from "../../../types/env";
import { SearchPaymentQuery } from "./payment.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

const PAYMENT_HEADERS_SORT_COLUMNS = {
  id: schema.paymentHeaders.id,
  title: schema.paymentHeaders.title,
  partnerId: schema.paymentHeaders.partnerId,
  mode: schema.paymentHeaders.mode,
  status: schema.paymentHeaders.status,
  paymentDate: schema.paymentHeaders.paymentDate,
  totalAmount: schema.paymentHeaders.totalAmount,
  reconciliationStatus: schema.paymentHeaders.reconciliationStatus,
  createdAt: schema.paymentHeaders.createdAt,
};

// Item10 Phase5: billing.repository.tsと同じ構成。payment_headers/payment_header_items/
// payment_disbursementsを担当する。purchase_recognitions自体への書き込み(paymentStatus更新)は
// 行わない(PurchaseRecognitionRepository.markRecognitionsAsPaid()を呼び出し元から使う方針)
export class PaymentRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildConditions(params: SearchPaymentQuery) {
    const conditions = [];
    if (params.id) conditions.push(containsText(schema.paymentHeaders.id, params.id));
    if (params.title) conditions.push(containsText(schema.paymentHeaders.title, params.title));
    if (params.partnerId) conditions.push(eq(schema.paymentHeaders.partnerId, params.partnerId));
    if (params.mode) conditions.push(eq(schema.paymentHeaders.mode, params.mode));
    if (params.status) conditions.push(eq(schema.paymentHeaders.status, params.status));
    if (params.reconciliationStatus)
      conditions.push(eq(schema.paymentHeaders.reconciliationStatus, params.reconciliationStatus));

    if (params.startDate) {
      const startTimestamp = Math.floor(
        new Date(`${params.startDate}T00:00:00+09:00`).getTime() / 1000,
      );
      conditions.push(sql`${schema.paymentHeaders.paymentDate} >= ${startTimestamp}`);
    }
    if (params.endDate) {
      const end = new Date(`${params.endDate}T00:00:00+09:00`);
      end.setDate(end.getDate() + 1);
      const endTimestamp = Math.floor(end.getTime() / 1000);
      conditions.push(sql`${schema.paymentHeaders.paymentDate} < ${endTimestamp}`);
    }

    return conditions;
  }

  async findHeaders(params: SearchPaymentQuery, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, PAYMENT_HEADERS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.paymentHeaders)
      .where(combineConditions(this.buildConditions(params)));
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findHeadersPage(
    params: SearchPaymentQuery,
    pagination: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, PAYMENT_HEADERS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.paymentHeaders)
      .where(combineConditions(this.buildConditions(params)));
    const q = orderBy ? base.orderBy(...orderBy) : base;
    return await q.limit(pagination.limit).offset(toOffset(pagination));
  }

  async countHeaders(params: SearchPaymentQuery): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.paymentHeaders)
      .where(combineConditions(this.buildConditions(params)));
    return result[0]?.value || 0;
  }

  async findHeaderById(id: string) {
    const res = await this.db
      .select()
      .from(schema.paymentHeaders)
      .where(eq(schema.paymentHeaders.id, id))
      .limit(1);
    return res[0] || null;
  }

  // ファームバンキング: 選択した支払ヘッダーを一括取得
  async findHeadersByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return await this.db
      .select()
      .from(schema.paymentHeaders)
      .where(inArray(schema.paymentHeaders.id, ids));
  }

  async existsHeader(id: string) {
    const res = await this.db
      .select()
      .from(schema.paymentHeaders)
      .where(eq(schema.paymentHeaders.id, id))
      .limit(1);
    return res.length > 0;
  }

  async insertHeader(data: typeof schema.paymentHeaders.$inferInsert) {
    await this.db.insert(schema.paymentHeaders).values(data);
  }

  async updateHeader(id: string, data: Partial<typeof schema.paymentHeaders.$inferInsert>) {
    await this.db.update(schema.paymentHeaders).set(data).where(eq(schema.paymentHeaders.id, id));
  }

  async findItemsByHeaderId(paymentHeaderId: string) {
    return await this.db
      .select()
      .from(schema.paymentHeaderItems)
      .where(eq(schema.paymentHeaderItems.paymentHeaderId, paymentHeaderId))
      .orderBy(asc(schema.paymentHeaderItems.sortOrder));
  }

  async insertItem(data: typeof schema.paymentHeaderItems.$inferInsert) {
    await this.db.insert(schema.paymentHeaderItems).values(data);
  }

  // 詳細画面用: payment_header_itemsに紐づくpurchase_recognitions/item_receipt_headersの明細まで
  // 展開する。K-5-1/K-5-3: purchaseRecognitionId/itemReceiptIdどちらもnull(完全手動入力行)の場合に
  // 行自体が消えないよう、billing.repository.tsのfindItemsWithInvoiceDetailと同じくleftJoinにする。
  // K-5-2: purchase_recognitions.orderId経由でordersまでleftJoinし、前払実績(isPaid/paidAt)を
  // 画面側で参照できるようにする
  async findItemsWithReferenceDetail(paymentHeaderId: string) {
    return await this.db
      .select({
        paymentHeaderItem: schema.paymentHeaderItems,
        purchaseRecognition: schema.purchaseRecognitions,
        itemReceipt: schema.itemReceiptHeaders,
        advanceOrder: schema.orders,
      })
      .from(schema.paymentHeaderItems)
      .leftJoin(
        schema.purchaseRecognitions,
        eq(schema.paymentHeaderItems.purchaseRecognitionId, schema.purchaseRecognitions.id),
      )
      .leftJoin(
        schema.itemReceiptHeaders,
        eq(schema.paymentHeaderItems.itemReceiptId, schema.itemReceiptHeaders.id),
      )
      .leftJoin(schema.orders, eq(schema.purchaseRecognitions.orderId, schema.orders.id))
      .where(eq(schema.paymentHeaderItems.paymentHeaderId, paymentHeaderId))
      .orderBy(asc(schema.paymentHeaderItems.sortOrder));
  }

  // 支払確定の対象候補検証用: 指定id群のpurchase_recognitionsをそのまま取得する(読み取り専用。
  // paymentStatusの更新自体はPurchaseRecognitionRepository.markRecognitionsAsPaid()で行う)
  async findPurchaseRecognitionsByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return await this.db
      .select()
      .from(schema.purchaseRecognitions)
      .where(inArray(schema.purchaseRecognitions.id, ids));
  }

  // K-5-2: 支払作成モーダルの「仕入から選択」タブ用候補一覧(未払・承認済みの仕入計上)
  async findUnpaidApprovedRecognitionsByPartnerId(partnerId: string) {
    return await this.db
      .select()
      .from(schema.purchaseRecognitions)
      .where(
        and(
          eq(schema.purchaseRecognitions.partnerId, partnerId),
          eq(schema.purchaseRecognitions.status, "APPROVED"),
          eq(schema.purchaseRecognitions.paymentStatus, "UNPAID"),
        ),
      );
  }

  // K-5-2: 指定id群の発注(前払判定用)。isPaid/paidAt/totalAmountのみ最小限取得する
  async findOrdersByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return await this.db
      .select({
        id: schema.orders.id,
        isPaid: schema.orders.isPaid,
        paidAt: schema.orders.paidAt,
        totalAmount: schema.orders.totalAmount,
      })
      .from(schema.orders)
      .where(inArray(schema.orders.id, ids));
  }

  // K-5-1: 指定した検収記録id群のうち、既にいずれかの支払(payment_header_items.itemReceiptId)から
  // 参照済みのものをSetで返す(二重支払の起票を防ぐ)
  async findUsedItemReceiptIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ itemReceiptId: schema.paymentHeaderItems.itemReceiptId })
      .from(schema.paymentHeaderItems)
      .where(inArray(schema.paymentHeaderItems.itemReceiptId, ids));
    return new Set(rows.map((r) => r.itemReceiptId).filter((id): id is string => !!id));
  }

  // L-1-b: 検収記録に紐づく仕入計上(purchase_recognition_receipts経由)と、その支払状況。
  // 検収側の支払候補で「同じ納品の仕入が既に支払済み」の警告を出すために使う
  async findLinkedRecognitionsByReceiptIds(
    ids: string[],
  ): Promise<{ itemReceiptId: string; recognitionId: string; paymentStatus: string }[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({
        itemReceiptId: schema.purchaseRecognitionReceipts.itemReceiptId,
        recognitionId: schema.purchaseRecognitions.id,
        paymentStatus: schema.purchaseRecognitions.paymentStatus,
      })
      .from(schema.purchaseRecognitionReceipts)
      .innerJoin(
        schema.purchaseRecognitions,
        eq(schema.purchaseRecognitionReceipts.purchaseRecognitionId, schema.purchaseRecognitions.id),
      )
      .where(inArray(schema.purchaseRecognitionReceipts.itemReceiptId, ids));
    return rows;
  }

  // L-1-b: 仕入計上に紐づく検収記録id。仕入側の支払候補で「同じ納品の検収が既に支払対象」の警告に使う
  async findLinkedReceiptIdsByRecognitionIds(
    ids: string[],
  ): Promise<{ recognitionId: string; itemReceiptId: string }[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({
        recognitionId: schema.purchaseRecognitionReceipts.purchaseRecognitionId,
        itemReceiptId: schema.purchaseRecognitionReceipts.itemReceiptId,
      })
      .from(schema.purchaseRecognitionReceipts)
      .where(inArray(schema.purchaseRecognitionReceipts.purchaseRecognitionId, ids));
    return rows;
  }

  async findPartnerById(id: string) {
    return findPartnerById(this.db, id);
  }

  async findUserByEmployeeNumber(empNo: string) {
    return findUserByEmployeeNumber(this.db, empNo);
  }

  // --- 手動消込(payment_disbursements) ---

  async findDisbursementsByHeaderId(paymentHeaderId: string) {
    return await this.db
      .select()
      .from(schema.paymentDisbursements)
      .where(eq(schema.paymentDisbursements.paymentHeaderId, paymentHeaderId));
  }

  async insertDisbursement(data: typeof schema.paymentDisbursements.$inferInsert) {
    await this.db.insert(schema.paymentDisbursements).values(data);
  }

  async sumReconciledAmount(paymentHeaderId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sum(schema.paymentDisbursements.amount) })
      .from(schema.paymentDisbursements)
      .where(eq(schema.paymentDisbursements.paymentHeaderId, paymentHeaderId));
    return Number(rows[0]?.total || 0);
  }

  // --- CSVエクスポート用 ---

  async findExportHeadersWithItems() {
    return await this.db
      .select()
      .from(schema.paymentHeaders)
      .leftJoin(
        schema.paymentHeaderItems,
        eq(schema.paymentHeaders.id, schema.paymentHeaderItems.paymentHeaderId),
      )
      .orderBy(asc(schema.paymentHeaders.id), asc(schema.paymentHeaderItems.sortOrder));
  }

  async findExportDisbursements() {
    return await this.db
      .select()
      .from(schema.paymentDisbursements)
      .orderBy(asc(schema.paymentDisbursements.paymentHeaderId));
  }

  async upsertHeaderFromCsv(data: any) {
    await this.db
      .insert(schema.paymentHeaders)
      .values(data)
      .onConflictDoUpdate({
        target: schema.paymentHeaders.id,
        set: {
          title: data.title,
          partnerId: data.partnerId,
          paymentDate: data.paymentDate,
          mode: data.mode,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          status: data.status,
          totalAmount: data.totalAmount,
          taxAmount: data.taxAmount,
          reconciledAmount: data.reconciledAmount,
          reconciliationStatus: data.reconciliationStatus,
          memo: data.memo,
          updatedBy: data.updatedBy,
          updatedAt: data.updatedAt,
        },
      });
  }

  async deleteItemsByHeaderId(paymentHeaderId: string) {
    await this.db
      .delete(schema.paymentHeaderItems)
      .where(eq(schema.paymentHeaderItems.paymentHeaderId, paymentHeaderId));
  }
}
