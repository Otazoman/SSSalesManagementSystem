import { drizzle } from "drizzle-orm/d1";
import { selectServiceItemIds } from "../../../platform/inventory/service-items";
import { sql, eq, and, asc, desc, inArray, sum } from "drizzle-orm";
import { count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { findActiveContactsByPartnerId, findItemAccountCodes, findMailTemplate, findTaxCategoryRates, findUnitNames, findUserByEmployeeNumber } from "../../../platform/repository/common-queries";
import { salesInvoiceContactDocumentType } from "../../../constants/contact-document-types";
import { Env } from "../../../types/env";
import { SearchSalesInvoicesQuery } from "./sales-invoice.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソートの許可カラム(quote.repository.tsと同じ方針)
const SALES_INVOICES_SORT_COLUMNS = {
  id: schema.salesInvoices.id,
  title: schema.salesInvoices.title,
  partnerId: schema.salesInvoices.partnerId,
  status: schema.salesInvoices.status,
  documentType: schema.salesInvoices.documentType,
  invoiceDate: schema.salesInvoices.invoiceDate,
  totalAmount: schema.salesInvoices.totalAmount,
  billingStatus: schema.salesInvoices.billingStatus,
  createdAt: schema.salesInvoices.createdAt,
  salesPersonEmployeeNumber: schema.salesInvoices.salesPersonEmployeeNumber,
  inputPersonEmployeeNumber: schema.salesInvoices.inputPersonEmployeeNumber,
};

export class SalesInvoiceRepository {
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
  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): SalesInvoiceRepository {
    const repo: SalesInvoiceRepository = Object.create(SalesInvoiceRepository.prototype);
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildConditions(params: SearchSalesInvoicesQuery) {
    const conditions = [];
    if (params.id) conditions.push(containsText(schema.salesInvoices.id, params.id));
    if (params.title)
      conditions.push(containsText(schema.salesInvoices.title, params.title));
    if (params.partnerId)
      conditions.push(eq(schema.salesInvoices.partnerId, params.partnerId));
    if (params.salesOrderId)
      conditions.push(eq(schema.salesInvoices.salesOrderId, params.salesOrderId));
    if (params.status && params.status !== "all")
      conditions.push(eq(schema.salesInvoices.status, params.status));
    if (params.documentType)
      conditions.push(eq(schema.salesInvoices.documentType, params.documentType));
    if (params.billingStatus)
      conditions.push(eq(schema.salesInvoices.billingStatus, params.billingStatus));

    if (params.startDate) {
      const startTimestamp = Math.floor(
        new Date(`${params.startDate}T00:00:00+09:00`).getTime() / 1000,
      );
      conditions.push(sql`${schema.salesInvoices.createdAt} >= ${startTimestamp}`);
    }
    if (params.endDate) {
      const end = new Date(`${params.endDate}T00:00:00+09:00`);
      end.setDate(end.getDate() + 1);
      const endTimestamp = Math.floor(end.getTime() / 1000);
      conditions.push(sql`${schema.salesInvoices.createdAt} < ${endTimestamp}`);
    }

    if (params.salesPerson) {
      conditions.push(
        eq(schema.salesInvoices.salesPersonEmployeeNumber, params.salesPerson),
      );
    }

    if (params.itemName) {
      const matching = this.db
        .select({ salesInvoiceId: schema.salesInvoiceItems.salesInvoiceId })
        .from(schema.salesInvoiceItems)
        .where(containsText(schema.salesInvoiceItems.itemName, params.itemName));
      conditions.push(inArray(schema.salesInvoices.id, matching));
    }

    return conditions;
  }

  async findInvoices(params: SearchSalesInvoicesQuery, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, SALES_INVOICES_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.salesInvoices)
      .where(combineConditions(this.buildConditions(params)));
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findInvoicesPage(
    params: SearchSalesInvoicesQuery,
    pagination: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, SALES_INVOICES_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.salesInvoices)
      .where(combineConditions(this.buildConditions(params)));
    const q = orderBy ? base.orderBy(...orderBy) : base;
    return await q.limit(pagination.limit).offset(toOffset(pagination));
  }

  async countInvoices(params: SearchSalesInvoicesQuery): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.salesInvoices)
      .where(combineConditions(this.buildConditions(params)));
    return result[0]?.value || 0;
  }

  async findAttachmentsByInvoiceIds(invoiceIds: string[]) {
    if (invoiceIds.length === 0) return [];
    return await this.db
      .select()
      .from(schema.salesInvoiceAttachments)
      .where(inArray(schema.salesInvoiceAttachments.salesInvoiceId, invoiceIds));
  }

  async findExportInvoicesWithDetails() {
    return await this.db
      .select()
      .from(schema.salesInvoices)
      .leftJoin(
        schema.salesInvoiceItems,
        eq(schema.salesInvoices.id, schema.salesInvoiceItems.salesInvoiceId),
      )
      .orderBy(asc(schema.salesInvoices.id), asc(schema.salesInvoiceItems.sortOrder));
  }

  async findUserByEmployeeNumber(empNo: string) {
    return findUserByEmployeeNumber(this.db, empNo);
  }

  async upsertInvoiceFromCsv(data: any) {
    await this.db
      .insert(schema.salesInvoices)
      .values(data)
      .onConflictDoUpdate({
        target: schema.salesInvoices.id,
        set: {
          title: data.title,
          partnerId: data.partnerId,
          salesOrderId: data.salesOrderId,
          companyDepartment: data.companyDepartment,
          invoiceDate: data.invoiceDate,
          status: data.status,
          documentType: data.documentType,
          originalInvoiceId: data.originalInvoiceId,
          totalAmount: data.totalAmount,
          taxAmount: data.taxAmount,
          memo: data.memo,
          salesPersonEmployeeNumber: data.salesPersonEmployeeNumber,
          inputPersonEmployeeNumber: data.inputPersonEmployeeNumber,
          billingStatus: data.billingStatus,
          updatedBy: data.updatedBy,
          updatedAt: data.updatedAt,
        },
      });
  }

  // 明細クリア(quote.repository.tsのdeleteQuoteItemsと異なり、salesInvoiceItemsを直接参照する
  // FKはまだ存在しないため退避処理は不要)
  async deleteInvoiceItems(salesInvoiceId: string) {
    await this.db
      .delete(schema.salesInvoiceItems)
      .where(eq(schema.salesInvoiceItems.salesInvoiceId, salesInvoiceId));
  }

  // BUG-048: 承認済みの伝票の変更申請の承認時に、ヘッダーの更新・明細の入れ替え・履歴を1回の batch で書き込む
  // (以前は1つずつ書き込んでいたため、途中で失敗すると明細が消えたままになりえた)。itemRows が null なら明細は変えない
  async applyApprovedUpdate(
    salesInvoiceId: string,
    header: Partial<typeof schema.salesInvoices.$inferInsert>,
    itemRows: (typeof schema.salesInvoiceItems.$inferInsert)[] | null,
    history: typeof schema.salesInvoiceHistoryLogs.$inferInsert,
  ) {
    const statements: any[] = [
      this.db.update(schema.salesInvoices).set(header).where(eq(schema.salesInvoices.id, salesInvoiceId)),
    ];
    if (itemRows) {
      statements.push(this.db.delete(schema.salesInvoiceItems).where(eq(schema.salesInvoiceItems.salesInvoiceId, salesInvoiceId)));
      for (const row of itemRows) statements.push(this.db.insert(schema.salesInvoiceItems).values(row));
    }
    statements.push(this.db.insert(schema.salesInvoiceHistoryLogs).values(history));
    await this.db.batch(statements as [any, ...any[]]);
  }

  async insertInvoiceItem(itemData: any) {
    await this.db.insert(schema.salesInvoiceItems).values(itemData);
  }

  async findInvoiceById(id: string) {
    const res = await this.db
      .select()
      .from(schema.salesInvoices)
      .where(eq(schema.salesInvoices.id, id))
      .limit(1);
    return res[0] || null;
  }

  async findInvoiceItems(salesInvoiceId: string) {
    return await this.db
      .select()
      .from(schema.salesInvoiceItems)
      .where(eq(schema.salesInvoiceItems.salesInvoiceId, salesInvoiceId))
      .orderBy(asc(schema.salesInvoiceItems.sortOrder));
  }

  async findInvoiceAttachments(salesInvoiceId: string) {
    return await this.db
      .select()
      .from(schema.salesInvoiceAttachments)
      .where(eq(schema.salesInvoiceAttachments.salesInvoiceId, salesInvoiceId));
  }

  async existsInvoice(id: string) {
    const res = await this.db
      .select()
      .from(schema.salesInvoices)
      .where(eq(schema.salesInvoices.id, id))
      .limit(1);
    return res.length > 0;
  }

  async insertInvoice(data: any) {
    await this.db.insert(schema.salesInvoices).values(data);
  }

  async insertInvoiceAttachment(data: any) {
    await this.db.insert(schema.salesInvoiceAttachments).values(data);
  }

  async updateInvoice(id: string, data: any) {
    await this.db
      .update(schema.salesInvoices)
      .set(data)
      .where(eq(schema.salesInvoices.id, id));
  }

  async deleteInvoiceAttachments(salesInvoiceId: string) {
    await this.db
      .delete(schema.salesInvoiceAttachments)
      .where(eq(schema.salesInvoiceAttachments.salesInvoiceId, salesInvoiceId));
  }

  async insertHistoryLog(data: any) {
    await this.db.insert(schema.salesInvoiceHistoryLogs).values(data);
  }

  async deleteInvoice(id: string) {
    await this.db.delete(schema.salesInvoices).where(eq(schema.salesInvoices.id, id));
  }

  async findInvoiceWithPartner(id: string) {
    return await this.db
      .select({
        salesInvoices: schema.salesInvoices,
        partners: schema.partners,
        users: schema.users,
        departmentName: schema.departments.name,
      })
      .from(schema.salesInvoices)
      .leftJoin(schema.partners, eq(schema.salesInvoices.partnerId, schema.partners.id))
      .leftJoin(
        schema.users,
        eq(schema.salesInvoices.salesPersonEmployeeNumber, schema.users.employeeNumber),
      )
      .leftJoin(schema.userRoles, eq(schema.users.id, schema.userRoles.userId))
      .leftJoin(
        schema.departments,
        eq(schema.userRoles.departmentSurrogateId, schema.departments.surrogateId),
      )
      .where(eq(schema.salesInvoices.id, id))
      .limit(1);
  }

  async findTaxCategoryRates(): Promise<Map<string, number>> {
    return findTaxCategoryRates(this.db);
  }

  async findUnitNames(): Promise<Map<string, string>> {
    return findUnitNames(this.db);
  }

  // Item8: 品目連動仕訳(platform/journal/build-journal-lines.ts)の科目解決用。
  // 品目マスタに存在しないitemId(DIRECT入力等)はマップに含まれない(呼び出し元でnull扱いにする)
  async findItemAccountCodes(itemIds: string[]): Promise<Map<string, string | null>> {
    return findItemAccountCodes(this.db, itemIds);
  }

  // 受注ヘッダー取得(標準基準/出荷基準の残数量判定、isPrepaid判定に使う)
  async findSalesOrderById(id: string) {
    const res = await this.db
      .select()
      .from(schema.salesOrders)
      .where(eq(schema.salesOrders.id, id))
      .limit(1);
    return res[0] || null;
  }

  async findSalesOrderItems(salesOrderId: string) {
    return await this.db
      .select()
      .from(schema.salesOrderItems)
      .where(eq(schema.salesOrderItems.salesOrderId, salesOrderId))
      .orderBy(asc(schema.salesOrderItems.sortOrder));
  }

  async findSalesOrderItemById(id: string) {
    const res = await this.db
      .select()
      .from(schema.salesOrderItems)
      .where(eq(schema.salesOrderItems.id, id))
      .limit(1);
    return res[0] || null;
  }

  // Item7と同じ方針(item_shipment_items×item_shipment_headers)。承認済み出庫実績のみ集計
  async getShippedQuantitiesByOrderItemIds(
    orderItemIds: string[],
  ): Promise<Array<{ salesOrderItemId: string | null; shippedQuantity: number }>> {
    if (orderItemIds.length === 0) return [];
    const rows = await this.db
      .select({
        salesOrderItemId: schema.itemShipmentItems.salesOrderItemId,
        shippedQuantity: sum(schema.itemShipmentItems.shippedQuantity),
      })
      .from(schema.itemShipmentItems)
      .innerJoin(
        schema.itemShipmentHeaders,
        eq(schema.itemShipmentHeaders.id, schema.itemShipmentItems.shipmentHeaderId),
      )
      .where(
        and(
          inArray(schema.itemShipmentItems.salesOrderItemId, orderItemIds),
          eq(schema.itemShipmentHeaders.status, "APPROVED"),
        ),
      )
      .groupBy(schema.itemShipmentItems.salesOrderItemId);
    return rows.map((r) => ({
      salesOrderItemId: r.salesOrderItemId,
      shippedQuantity: Number(r.shippedQuantity || 0),
    }));
  }

  // Item8: 受注明細に対して既に売上計上済み(APPROVED)の数量。SALEは加算、RETURNは減算し、
  // DISCOUNT/CORRECTIONは数量を持たない前提のため対象外(sourceOrderItemIdが付与されないはず)
  async getInvoicedQuantitiesByOrderItemIds(
    orderItemIds: string[],
  ): Promise<Map<string, number>> {
    if (orderItemIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        sourceOrderItemId: schema.salesInvoiceItems.sourceOrderItemId,
        documentType: schema.salesInvoices.documentType,
        quantity: sum(schema.salesInvoiceItems.quantity),
      })
      .from(schema.salesInvoiceItems)
      .innerJoin(
        schema.salesInvoices,
        eq(schema.salesInvoices.id, schema.salesInvoiceItems.salesInvoiceId),
      )
      .where(
        and(
          inArray(schema.salesInvoiceItems.sourceOrderItemId, orderItemIds),
          eq(schema.salesInvoices.status, "APPROVED"),
        ),
      )
      .groupBy(
        schema.salesInvoiceItems.sourceOrderItemId,
        schema.salesInvoices.documentType,
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

  async findAttachmentByIdAndInvoiceId(attachmentId: string, salesInvoiceId: string) {
    const res = await this.db
      .select()
      .from(schema.salesInvoiceAttachments)
      .where(
        and(
          eq(schema.salesInvoiceAttachments.id, attachmentId),
          eq(schema.salesInvoiceAttachments.salesInvoiceId, salesInvoiceId),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  // K-4-1: quote.repository.tsの同名メソッドと同型(OTPダウンロード・メール送信用)
  async findMailTemplate(id: string) {
    return findMailTemplate(this.db, id);
  }

  async findApprovedInvoicesByIds(ids: string[]) {
    return await this.db
      .select()
      .from(schema.salesInvoices)
      .where(
        and(
          inArray(schema.salesInvoices.id, ids),
          eq(schema.salesInvoices.status, "APPROVED"),
        ),
      );
  }

  async findLatestPdfAttachment(salesInvoiceId: string) {
    const res = await this.db
      .select()
      .from(schema.salesInvoiceAttachments)
      .where(
        and(
          eq(schema.salesInvoiceAttachments.salesInvoiceId, salesInvoiceId),
          eq(schema.salesInvoiceAttachments.fileType, "PDF"),
        ),
      )
      .orderBy(desc(schema.salesInvoiceAttachments.uploadedAt))
      .limit(1);
    return res[0] || null;
  }

  // V-5: 売上関連書類は内訳(SALE/RETURN/DISCOUNT/CORRECTION)ごとに送る担当者が異なる
  async findActiveContactsByPartnerId(partnerId: string, invoiceDocumentType: string) {
    return findActiveContactsByPartnerId(
      this.db,
      partnerId,
      salesInvoiceContactDocumentType(invoiceDocumentType),
    );
  }

  // Item8 Phase4(billing): 請求作成時、対象のsales_invoicesをまとめてBILLEDへ更新する
  async markInvoicesAsBilled(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(schema.salesInvoices)
      .set({ billingStatus: "BILLED" })
      .where(inArray(schema.salesInvoices.id, ids));
  }

  // 請求作成時の二重請求防止: 「未請求(UNBILLED)のものだけ」を原子的にBILLEDへ更新し、更新できたidを返す。
  // 事前チェック(読み取り)と更新の間に別リクエストが同じ売上を請求済みにしていた場合、
  // その売上はここで更新されず戻り値に含まれないため、呼び出し側で不足を検知して失敗させられる
  async claimUnbilledInvoices(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .update(schema.salesInvoices)
      .set({ billingStatus: "BILLED" })
      .where(
        and(
          inArray(schema.salesInvoices.id, ids),
          eq(schema.salesInvoices.billingStatus, "UNBILLED"),
        ),
      )
      .returning({ id: schema.salesInvoices.id });
    return rows.map((row) => row.id);
  }

  // 追加要望: 請求の削除時、紐づいていた売上を未請求(UNBILLED)へ戻し、再度請求対象にできるようにする
  async markInvoicesAsUnbilled(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(schema.salesInvoices)
      .set({ billingStatus: "UNBILLED" })
      .where(inArray(schema.salesInvoices.id, ids));
  }

}
