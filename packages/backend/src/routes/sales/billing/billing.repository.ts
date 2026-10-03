import { drizzle } from "drizzle-orm/d1";
import { eq, sql, asc, inArray, sum } from "drizzle-orm";
import { count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { findActiveContactsByPartnerId, findMailTemplate, findPartnerById, findTaxCategoryRates, findUnitNames, findUserByEmployeeNumber } from "../../../platform/repository/common-queries";
import { Env } from "../../../types/env";
import { SearchBillingQuery } from "./billing.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

const BILLING_HEADERS_SORT_COLUMNS = {
  id: schema.billingHeaders.id,
  title: schema.billingHeaders.title,
  partnerId: schema.billingHeaders.partnerId,
  mode: schema.billingHeaders.mode,
  status: schema.billingHeaders.status,
  billingDate: schema.billingHeaders.billingDate,
  totalAmount: schema.billingHeaders.totalAmount,
  reconciliationStatus: schema.billingHeaders.reconciliationStatus,
  createdAt: schema.billingHeaders.createdAt,
};

// Item8 Phase4: sales-invoice.repository.tsと同じ構成。billing_headers/billing_items/
// payment_receiptsを担当する。sales_invoices自体への書き込み(billingStatus更新)は行わない
// (SalesInvoiceRepository.markInvoicesAsBilled()を呼び出し元から使う方針)
export class BillingRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildConditions(params: SearchBillingQuery) {
    const conditions = [];
    if (params.id) conditions.push(containsText(schema.billingHeaders.id, params.id));
    if (params.title) conditions.push(containsText(schema.billingHeaders.title, params.title));
    if (params.partnerId) conditions.push(eq(schema.billingHeaders.partnerId, params.partnerId));
    if (params.mode) conditions.push(eq(schema.billingHeaders.mode, params.mode));
    if (params.status) conditions.push(eq(schema.billingHeaders.status, params.status));
    if (params.reconciliationStatus)
      conditions.push(eq(schema.billingHeaders.reconciliationStatus, params.reconciliationStatus));

    if (params.startDate) {
      const startTimestamp = Math.floor(
        new Date(`${params.startDate}T00:00:00+09:00`).getTime() / 1000,
      );
      conditions.push(sql`${schema.billingHeaders.billingDate} >= ${startTimestamp}`);
    }
    if (params.endDate) {
      const end = new Date(`${params.endDate}T00:00:00+09:00`);
      end.setDate(end.getDate() + 1);
      const endTimestamp = Math.floor(end.getTime() / 1000);
      conditions.push(sql`${schema.billingHeaders.billingDate} < ${endTimestamp}`);
    }

    return conditions;
  }

  async findHeaders(params: SearchBillingQuery, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, BILLING_HEADERS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.billingHeaders)
      .where(combineConditions(this.buildConditions(params)));
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findHeadersPage(
    params: SearchBillingQuery,
    pagination: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, BILLING_HEADERS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.billingHeaders)
      .where(combineConditions(this.buildConditions(params)));
    const q = orderBy ? base.orderBy(...orderBy) : base;
    return await q.limit(pagination.limit).offset(toOffset(pagination));
  }

  async countHeaders(params: SearchBillingQuery): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.billingHeaders)
      .where(combineConditions(this.buildConditions(params)));
    return result[0]?.value || 0;
  }

  async findHeaderById(id: string) {
    const res = await this.db
      .select()
      .from(schema.billingHeaders)
      .where(eq(schema.billingHeaders.id, id))
      .limit(1);
    return res[0] || null;
  }

  // 追加要望: 一覧からの一括メール送信対象取得
  async findHeadersByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return await this.db
      .select()
      .from(schema.billingHeaders)
      .where(inArray(schema.billingHeaders.id, ids));
  }

  async existsHeader(id: string) {
    const res = await this.db
      .select()
      .from(schema.billingHeaders)
      .where(eq(schema.billingHeaders.id, id))
      .limit(1);
    return res.length > 0;
  }

  async insertHeader(data: typeof schema.billingHeaders.$inferInsert) {
    await this.db.insert(schema.billingHeaders).values(data);
  }

  // 請求作成用: ヘッダと全明細を1回のbatch(D1では原子的に実行)で登録する。
  // 途中で失敗してもヘッダだけ・明細の一部だけが残らない
  async insertHeaderWithItems(
    header: typeof schema.billingHeaders.$inferInsert,
    items: (typeof schema.billingItems.$inferInsert)[],
  ) {
    await this.db.batch([
      this.db.insert(schema.billingHeaders).values(header),
      ...items.map((item) => this.db.insert(schema.billingItems).values(item)),
    ]);
  }

  async updateHeader(id: string, data: Partial<typeof schema.billingHeaders.$inferInsert>) {
    await this.db.update(schema.billingHeaders).set(data).where(eq(schema.billingHeaders.id, id));
  }

  // 追加要望: 請求の削除。billing_items/payment_receiptsはbillingHeaderIdへのFKが
  // onDelete: cascadeのため、ヘッダーの削除だけで自動的に道連れ削除される
  async deleteHeader(id: string) {
    await this.db.delete(schema.billingHeaders).where(eq(schema.billingHeaders.id, id));
  }

  async findItemsByHeaderId(billingHeaderId: string) {
    return await this.db
      .select()
      .from(schema.billingItems)
      .where(eq(schema.billingItems.billingHeaderId, billingHeaderId))
      .orderBy(asc(schema.billingItems.sortOrder));
  }

  async insertItem(data: typeof schema.billingItems.$inferInsert) {
    await this.db.insert(schema.billingItems).values(data);
  }

  // 詳細画面用: billing_itemsに紐づくsales_invoicesの明細まで展開する。
  // K-4-3: salesInvoiceIdがnull(完全手動入力行)の場合はsales_invoicesが存在しないため、
  // leftJoinとしてsalesInvoiceがnullのまま行自体は残す
  async findItemsWithInvoiceDetail(billingHeaderId: string) {
    return await this.db
      .select({
        billingItem: schema.billingItems,
        salesInvoice: schema.salesInvoices,
      })
      .from(schema.billingItems)
      .leftJoin(
        schema.salesInvoices,
        eq(schema.billingItems.salesInvoiceId, schema.salesInvoices.id),
      )
      .where(eq(schema.billingItems.billingHeaderId, billingHeaderId))
      .orderBy(asc(schema.billingItems.sortOrder));
  }

  // 請求作成の対象候補検証用: 指定id群のsales_invoicesをそのまま取得する(読み取り専用。
  // billingStatusの更新自体はSalesInvoiceRepository.markInvoicesAsBilled()で行う)
  async findSalesInvoicesByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return await this.db
      .select()
      .from(schema.salesInvoices)
      .where(inArray(schema.salesInvoices.id, ids));
  }

  async findSalesInvoiceItemsByInvoiceIds(invoiceIds: string[]) {
    if (invoiceIds.length === 0) return [];
    return await this.db
      .select()
      .from(schema.salesInvoiceItems)
      .where(inArray(schema.salesInvoiceItems.salesInvoiceId, invoiceIds))
      .orderBy(asc(schema.salesInvoiceItems.sortOrder));
  }

  async findPartnerById(id: string) {
    return findPartnerById(this.db, id);
  }

  // K-4-4: sales-invoice.repository.tsの同名メソッドと同型(請求書の再送付用)
  async findActiveContactsByPartnerId(partnerId: string) {
    return findActiveContactsByPartnerId(this.db, partnerId, "billing");
  }

  async findMailTemplate(id: string) {
    return findMailTemplate(this.db, id);
  }

  async findTaxCategoryRates(): Promise<Map<string, number>> {
    return findTaxCategoryRates(this.db);
  }

  async findUnitNames(): Promise<Map<string, string>> {
    return findUnitNames(this.db);
  }

  async findUserByEmployeeNumber(empNo: string) {
    return findUserByEmployeeNumber(this.db, empNo);
  }

  // --- 手動消込(payment_receipts) ---

  async findPaymentReceiptsByHeaderId(billingHeaderId: string) {
    return await this.db
      .select()
      .from(schema.paymentReceipts)
      .where(eq(schema.paymentReceipts.billingHeaderId, billingHeaderId));
  }

  async insertPaymentReceipt(data: typeof schema.paymentReceipts.$inferInsert) {
    await this.db.insert(schema.paymentReceipts).values(data);
  }

  async sumReconciledAmount(billingHeaderId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sum(schema.paymentReceipts.amount) })
      .from(schema.paymentReceipts)
      .where(eq(schema.paymentReceipts.billingHeaderId, billingHeaderId));
    return Number(rows[0]?.total || 0);
  }

  // --- CSVエクスポート用 ---

  async findExportHeadersWithItems() {
    return await this.db
      .select()
      .from(schema.billingHeaders)
      .leftJoin(
        schema.billingItems,
        eq(schema.billingHeaders.id, schema.billingItems.billingHeaderId),
      )
      .orderBy(asc(schema.billingHeaders.id), asc(schema.billingItems.sortOrder));
  }

  async findExportPaymentReceipts() {
    return await this.db
      .select()
      .from(schema.paymentReceipts)
      .orderBy(asc(schema.paymentReceipts.billingHeaderId));
  }

  async upsertHeaderFromCsv(data: any) {
    await this.db
      .insert(schema.billingHeaders)
      .values(data)
      .onConflictDoUpdate({
        target: schema.billingHeaders.id,
        set: {
          title: data.title,
          partnerId: data.partnerId,
          billingDate: data.billingDate,
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

  async deleteItemsByHeaderId(billingHeaderId: string) {
    await this.db.delete(schema.billingItems).where(eq(schema.billingItems.billingHeaderId, billingHeaderId));
  }
}
