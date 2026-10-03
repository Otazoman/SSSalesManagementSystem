import { drizzle } from "drizzle-orm/d1";
import { selectServiceItemIds } from "../../../platform/inventory/service-items";
import { sql, eq, and, asc, desc, inArray, ne, gt, sum } from "drizzle-orm";
import { count as sqlCount } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { findActiveContactsByPartnerId, findMailTemplate, findPartnerById, findTaxCategoryRates, findUnitNames, findUserByEmployeeNumber } from "../../../platform/repository/common-queries";
import { Env } from "../../../types/env";
import { SearchOrdersQuery } from "./sales-order.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム
const SALES_ORDERS_SORT_COLUMNS = {
  id: schema.salesOrders.id,
  title: schema.salesOrders.title,
  partnerId: schema.salesOrders.partnerId,
  status: schema.salesOrders.status,
  orderDate: schema.salesOrders.orderDate,
  totalAmount: schema.salesOrders.totalAmount,
  createdAt: schema.salesOrders.createdAt,
  salesPersonEmployeeNumber: schema.salesOrders.salesPersonEmployeeNumber,
  inputPersonEmployeeNumber: schema.salesOrders.inputPersonEmployeeNumber,
  sourceQuoteId: schema.salesOrders.sourceQuoteId,
};

export class SalesOrderRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  // BUG-056・BUG-065: 品目マスタでサービス(isService)の品目id(在庫・出荷・入荷の対象外。platform/inventory/service-items.ts)
  async findServiceItemIds(itemIds: Array<string | null | undefined>): Promise<Set<string>> {
    return selectServiceItemIds(this.db, itemIds);
  }

  /**
   * 既にDrizzle化済みのdbインスタンスから構築する(workflow-engine/target-adapters等、
   * raw D1Databaseではなくワークフロー共通の既存db(AppDb)しか持たない文脈向け)。
   */
  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): SalesOrderRepository {
    const repo: SalesOrderRepository = Object.create(SalesOrderRepository.prototype);
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildOrderConditions(params: SearchOrdersQuery) {
    const conditions = [];
    if (params.id) conditions.push(containsText(schema.salesOrders.id, params.id));
    if (params.title)
      conditions.push(containsText(schema.salesOrders.title, params.title));
    if (params.partnerId)
      conditions.push(eq(schema.salesOrders.partnerId, params.partnerId));
    if (params.status && params.status !== "all")
      conditions.push(eq(schema.salesOrders.status, params.status));
    if (params.sourceQuoteId)
      conditions.push(eq(schema.salesOrders.sourceQuoteId, params.sourceQuoteId));

    if (params.startDate) {
      const startTimestamp = Math.floor(
        new Date(`${params.startDate}T00:00:00+09:00`).getTime() / 1000,
      );
      conditions.push(sql`${schema.salesOrders.createdAt} >= ${startTimestamp}`);
    }
    if (params.endDate) {
      const end = new Date(`${params.endDate}T00:00:00+09:00`);
      end.setDate(end.getDate() + 1);
      const endTimestamp = Math.floor(end.getTime() / 1000);
      conditions.push(sql`${schema.salesOrders.createdAt} < ${endTimestamp}`);
    }

    if (params.salesPerson) {
      conditions.push(
        eq(schema.salesOrders.salesPersonEmployeeNumber, params.salesPerson),
      );
    }

    if (params.itemName) {
      const matchingOrders = this.db
        .select({ salesOrderId: schema.salesOrderItems.salesOrderId })
        .from(schema.salesOrderItems)
        .where(containsText(schema.salesOrderItems.itemName, params.itemName));
      conditions.push(inArray(schema.salesOrders.id, matchingOrders));
    }

    // Item7残課題2-5: バックオーダー(引当不足)がある受注のみで絞り込む検索フィルタ
    if (params.hasBackorder === "true") {
      const backorderedOrders = this.db
        .select({ salesOrderId: schema.salesOrderItems.salesOrderId })
        .from(schema.salesOrderItems)
        .where(gt(schema.salesOrderItems.backorderedQuantity, 0));
      conditions.push(inArray(schema.salesOrders.id, backorderedOrders));
    }

    // 追加要望: 注残(受注数量に対して承認済みの売上計上がまだ満たない明細)がある受注のみで
    // 絞り込む検索フィルタ。sales-invoice-crud.service.tsのgetInvoicedQuantitiesByOrderItemIds
    // と同じ「承認済み(APPROVED)の売上計上のみを消込対象とし、RETURNは符号反転して差し引く」
    // 計算式を、一覧検索用にEXISTS相関サブクエリとしてそのまま踏襲する
    if (params.hasUnrecognizedSales === "true") {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${schema.salesOrderItems}
          WHERE ${schema.salesOrderItems.salesOrderId} = ${schema.salesOrders.id}
            AND ${schema.salesOrderItems.quantity} > (
              SELECT COALESCE(SUM(
                CASE WHEN ${schema.salesInvoices.documentType} = 'RETURN'
                  THEN -${schema.salesInvoiceItems.quantity}
                  ELSE ${schema.salesInvoiceItems.quantity}
                END
              ), 0)
              FROM ${schema.salesInvoiceItems}
              INNER JOIN ${schema.salesInvoices}
                ON ${schema.salesInvoices.id} = ${schema.salesInvoiceItems.salesInvoiceId}
              WHERE ${schema.salesInvoiceItems.sourceOrderItemId} = ${schema.salesOrderItems.id}
                AND ${schema.salesInvoices.status} = 'APPROVED'
            )
        )`,
      );
    }

    return conditions;
  }

  async findOrders(params: SearchOrdersQuery, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, SALES_ORDERS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.salesOrders)
      .where(combineConditions(this.buildOrderConditions(params)));
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findOrdersPage(
    params: SearchOrdersQuery,
    pagination: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, SALES_ORDERS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.salesOrders)
      .where(combineConditions(this.buildOrderConditions(params)));
    const q = orderBy ? base.orderBy(...orderBy) : base;
    return await q.limit(pagination.limit).offset(toOffset(pagination));
  }

  async countOrders(params: SearchOrdersQuery): Promise<number> {
    const result = await this.db
      .select({ value: sqlCount() })
      .from(schema.salesOrders)
      .where(combineConditions(this.buildOrderConditions(params)));
    return result[0]?.value || 0;
  }

  async findAttachmentsByOrderIds(orderIds: string[]) {
    if (orderIds.length === 0) return [];
    return await this.db
      .select()
      .from(schema.salesOrderAttachments)
      .where(inArray(schema.salesOrderAttachments.salesOrderId, orderIds));
  }

  async findOrderById(id: string) {
    const res = await this.db
      .select()
      .from(schema.salesOrders)
      .where(eq(schema.salesOrders.id, id))
      .limit(1);
    return res[0] || null;
  }

  async findOrderItems(salesOrderId: string) {
    return await this.db
      .select()
      .from(schema.salesOrderItems)
      .where(eq(schema.salesOrderItems.salesOrderId, salesOrderId))
      .orderBy(asc(schema.salesOrderItems.sortOrder));
  }

  async findOrderItemById(id: string) {
    const res = await this.db
      .select()
      .from(schema.salesOrderItems)
      .where(eq(schema.salesOrderItems.id, id))
      .limit(1);
    return res[0] || null;
  }

  // Item9 Phase6: 欠品自動提案①(受注紐付け方式)。承認済み受注を横断して欠品(引当不足)明細を
  // フラットに一覧する。buildOrderConditions()のhasBackorderと同じgt(backorderedQuantity, 0)条件を
  // JOINして使う(受注単位の絞り込みではなく明細単位でそのままフラット化する点のみ異なる)
  async findBackorderedItemsAcrossOrders() {
    return await this.db
      .select({
        salesOrderId: schema.salesOrderItems.salesOrderId,
        salesOrderTitle: schema.salesOrders.title,
        id: schema.salesOrderItems.id,
        itemId: schema.salesOrderItems.itemId,
        itemName: schema.salesOrderItems.itemName,
        inputType: schema.salesOrderItems.inputType,
        quantity: schema.salesOrderItems.quantity,
        backorderedQuantity: schema.salesOrderItems.backorderedQuantity,
        unitPrice: schema.salesOrderItems.unitPrice,
        unitCode: schema.salesOrderItems.unitCode,
        taxCategoryCode: schema.salesOrderItems.taxCategoryCode,
        memo: schema.salesOrderItems.memo,
      })
      .from(schema.salesOrderItems)
      .innerJoin(schema.salesOrders, eq(schema.salesOrders.id, schema.salesOrderItems.salesOrderId))
      .where(
        and(
          gt(schema.salesOrderItems.backorderedQuantity, 0),
          eq(schema.salesOrders.status, "APPROVED"),
        ),
      )
      .orderBy(asc(schema.salesOrders.id));
  }

  // Item7残課題6: 明細ごとの出荷済数量(item_shipment_itemsをitem_shipment_headersとJOINし、
  // 実際に確定(APPROVED)した出庫実績のみ集計する。出荷指示の指示数量は含まない)
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
    return rows.map((r) => ({ salesOrderItemId: r.salesOrderItemId, shippedQuantity: Number(r.shippedQuantity || 0) }));
  }

  async updateShipmentStatus(orderId: string, shipmentStatus: string): Promise<void> {
    await this.db
      .update(schema.salesOrders)
      .set({ shipmentStatus })
      .where(eq(schema.salesOrders.id, orderId));
  }

  async findOrderAttachments(salesOrderId: string) {
    return await this.db
      .select()
      .from(schema.salesOrderAttachments)
      .where(eq(schema.salesOrderAttachments.salesOrderId, salesOrderId));
  }

  async existsOrder(id: string) {
    const res = await this.db
      .select()
      .from(schema.salesOrders)
      .where(eq(schema.salesOrders.id, id))
      .limit(1);
    return res.length > 0;
  }

  async insertOrder(data: any) {
    await this.db.insert(schema.salesOrders).values(data);
  }

  async insertOrderItem(data: any) {
    await this.db.insert(schema.salesOrderItems).values(data);
  }

  // Item7残課題2-5: 引当実行結果(不足分)を明細へ反映する
  async updateOrderItemBackorder(orderItemId: string, backorderedQuantity: number) {
    await this.db
      .update(schema.salesOrderItems)
      .set({ backorderedQuantity })
      .where(eq(schema.salesOrderItems.id, orderItemId));
  }

  // Item7残課題2-5: 削除対象の明細が倉庫単位引当(sales_order_item_reservations)を
  // 持っている場合、明細行を削除する前にwarehouse_stock_reservationsのカウンタを解放する。
  // 明細のDELETE自体は(通常更新/CSV再インポート/承認確定の複数箇所から)delete→再insertの
  // パターンで呼ばれるため、ここで解放しないとカウンタだけが解放されずに残り続ける
  // (quote_items側で見つかったFK制約違反バグと同種の問題への予防的対応。ただしこちらはFK制約
  // 自体はonDelete:cascadeのためエラーにはならず、静かにカウンタが残留するだけの違いがある)
  // Item7残課題2-5フォローアップ6: skipReservationRelease=trueの場合、カウンタの解放を行わない
  // (承認済み受注への変更申請の承認確定時専用。申請提出時点で既に旧引当を解放・新引当を
  // 確保済みのため、ここでもう一度解放すると二重解放になってしまう)
  // Item7残課題6: item_shipment_items/item_shipment_instruction_items/sales_invoice_itemsの
  // salesOrderItemId(sourceOrderItemId)はsalesOrderItems.idへのFK(onDelete指定なし=RESTRICT)
  // のため、出荷指示/出庫/売上計上が紐づく受注の明細を削除しようとするとDBレベルで例外が
  // 発生してしまう。削除処理を始める前に呼び出し元で検知し、分かりやすいエラーメッセージで
  // ブロックする(または再インポート時は明細を保持する)ためのチェック。
  // 元は出荷指示/出庫のみを見ていたが、sales_invoice_items(売上計上済み明細)を見落としており
  // 実際にはそちらのFK制約でも同じ例外が発生していたため、あわせてチェックするよう拡張した
  // CSV取込の明細ID(lineId)の検証用: その明細IDを持つ受注のID(無ければnull)
  async findOrderIdOfItem(salesOrderItemId: string): Promise<string | null> {
    const rows = await this.db
      .select({ salesOrderId: schema.salesOrderItems.salesOrderId })
      .from(schema.salesOrderItems)
      .where(eq(schema.salesOrderItems.id, salesOrderItemId))
      .limit(1);
    return rows[0]?.salesOrderId ?? null;
  }

  async hasDownstreamItemReferences(salesOrderItemIds: string[]): Promise<boolean> {
    if (salesOrderItemIds.length === 0) return false;
    const [shipmentRows, instructionRows, invoiceRows] = await Promise.all([
      this.db
        .select({ id: schema.itemShipmentItems.id })
        .from(schema.itemShipmentItems)
        .where(inArray(schema.itemShipmentItems.salesOrderItemId, salesOrderItemIds))
        .limit(1),
      this.db
        .select({ id: schema.itemShipmentInstructionItems.id })
        .from(schema.itemShipmentInstructionItems)
        .where(inArray(schema.itemShipmentInstructionItems.salesOrderItemId, salesOrderItemIds))
        .limit(1),
      this.db
        .select({ id: schema.salesInvoiceItems.id })
        .from(schema.salesInvoiceItems)
        .where(inArray(schema.salesInvoiceItems.sourceOrderItemId, salesOrderItemIds))
        .limit(1),
    ]);
    return shipmentRows.length > 0 || instructionRows.length > 0 || invoiceRows.length > 0;
  }

  async deleteOrderItems(salesOrderId: string, options?: { skipReservationRelease?: boolean }) {
    const targetItems = await this.db
      .select({ id: schema.salesOrderItems.id, itemId: schema.salesOrderItems.itemId })
      .from(schema.salesOrderItems)
      .where(eq(schema.salesOrderItems.salesOrderId, salesOrderId));
    const targetIds = targetItems.map((row) => row.id);
    const itemIdByOrderItemId = new Map(targetItems.map((row) => [row.id, row.itemId]));

    if (targetIds.length > 0 && !options?.skipReservationRelease) {
      const reservations = await this.db
        .select({
          salesOrderItemId: schema.salesOrderItemReservations.salesOrderItemId,
          warehouseId: schema.salesOrderItemReservations.warehouseId,
          reservedQuantity: schema.salesOrderItemReservations.reservedQuantity,
        })
        .from(schema.salesOrderItemReservations)
        .where(inArray(schema.salesOrderItemReservations.salesOrderItemId, targetIds));

      const now = new Date();
      for (const r of reservations) {
        const itemId = itemIdByOrderItemId.get(r.salesOrderItemId);
        if (!itemId) continue;
        await this.db
          .update(schema.warehouseStockReservations)
          .set({
            reservedQuantity: sql`MAX(${schema.warehouseStockReservations.reservedQuantity} - ${r.reservedQuantity}, 0)`,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.warehouseStockReservations.itemId, itemId),
              eq(schema.warehouseStockReservations.warehouseId, r.warehouseId),
            ),
          );
      }
    }

    await this.db
      .delete(schema.salesOrderItems)
      .where(eq(schema.salesOrderItems.salesOrderId, salesOrderId));
  }

  // BUG-048: 承認済みの受注の変更申請の承認時に、ヘッダーの更新・明細の入れ替え・引当の記録(ledger)・履歴を1回の batch で書き込む。
  // 在庫の引当の数(カウンタ)は申請の提出時に調整済みのため、ここでは触らない(deleteOrderItems の skipReservationRelease と同じ)。
  // itemRows が null なら明細は変えない
  async applyApprovedUpdate(
    salesOrderId: string,
    header: Partial<typeof schema.salesOrders.$inferInsert>,
    itemRows: (typeof schema.salesOrderItems.$inferInsert)[] | null,
    ledgerRows: (typeof schema.salesOrderItemReservations.$inferInsert)[],
    history: typeof schema.salesOrderHistoryLogs.$inferInsert,
  ) {
    const statements: any[] = [
      this.db.update(schema.salesOrders).set(header).where(eq(schema.salesOrders.id, salesOrderId)),
    ];
    if (itemRows) {
      statements.push(this.db.delete(schema.salesOrderItems).where(eq(schema.salesOrderItems.salesOrderId, salesOrderId)));
      for (const row of itemRows) statements.push(this.db.insert(schema.salesOrderItems).values(row));
      for (const row of ledgerRows) statements.push(this.db.insert(schema.salesOrderItemReservations).values(row));
    }
    statements.push(this.db.insert(schema.salesOrderHistoryLogs).values(history));
    await this.db.batch(statements as [any, ...any[]]);
  }

  async insertOrderAttachment(data: any) {
    await this.db.insert(schema.salesOrderAttachments).values(data);
  }

  async deleteOrderAttachments(salesOrderId: string) {
    await this.db
      .delete(schema.salesOrderAttachments)
      .where(eq(schema.salesOrderAttachments.salesOrderId, salesOrderId));
  }

  async updateOrder(id: string, data: any) {
    await this.db
      .update(schema.salesOrders)
      .set(data)
      .where(eq(schema.salesOrders.id, id));
  }

  async insertHistoryLog(data: any) {
    await this.db.insert(schema.salesOrderHistoryLogs).values(data);
  }

  async deleteOrder(id: string) {
    await this.db.delete(schema.salesOrders).where(eq(schema.salesOrders.id, id));
  }

  async findAttachmentByIdAndOrderId(attachmentId: string, salesOrderId: string) {
    const res = await this.db
      .select()
      .from(schema.salesOrderAttachments)
      .where(
        and(
          eq(schema.salesOrderAttachments.id, attachmentId),
          eq(schema.salesOrderAttachments.salesOrderId, salesOrderId),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  // Item7: 与信確認用。指定取引先の承認済み(APPROVED)受注の合計金額を返す
  // (Item8実装前の近似値。excludeOrderIdは自身の再申請時に二重計上しないための除外用)
  async findApprovedOrderTotalByPartner(
    partnerId: string,
    excludeOrderId?: string,
  ): Promise<number> {
    const conditions = [
      eq(schema.salesOrders.partnerId, partnerId),
      eq(schema.salesOrders.status, "APPROVED"),
    ];
    if (excludeOrderId) conditions.push(ne(schema.salesOrders.id, excludeOrderId));

    const result = await this.db
      .select({ value: sql<number>`COALESCE(SUM(${schema.salesOrders.totalAmount}), 0)` })
      .from(schema.salesOrders)
      .where(and(...conditions));
    return Number(result[0]?.value || 0);
  }

  // Item7: 与信確認用に取引先のcreditLimitのみ取得する
  async findPartnerById(partnerId: string) {
    return findPartnerById(this.db, partnerId);
  }

  // PDF生成用 取引先および担当ユーザー結合取得(quote.repository.ts findQuoteWithPartnerと同型)
  async findOrderWithPartner(id: string) {
    return await this.db
      .select({
        salesOrders: schema.salesOrders,
        partners: schema.partners,
        users: schema.users,
        departmentName: schema.departments.name,
      })
      .from(schema.salesOrders)
      .leftJoin(schema.partners, eq(schema.salesOrders.partnerId, schema.partners.id))
      .leftJoin(
        schema.users,
        eq(schema.salesOrders.salesPersonEmployeeNumber, schema.users.employeeNumber),
      )
      .leftJoin(schema.userRoles, eq(schema.users.id, schema.userRoles.userId))
      .leftJoin(
        schema.departments,
        eq(schema.userRoles.departmentSurrogateId, schema.departments.surrogateId),
      )
      .where(eq(schema.salesOrders.id, id))
      .limit(1);
  }

  async findUserByEmployeeNumber(empNo: string) {
    return findUserByEmployeeNumber(this.db, empNo);
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

  async findApprovedOrdersByIds(orderIds: string[]) {
    return await this.db
      .select()
      .from(schema.salesOrders)
      .where(and(inArray(schema.salesOrders.id, orderIds), eq(schema.salesOrders.status, "APPROVED")));
  }

  async findLatestPdfAttachment(salesOrderId: string) {
    const res = await this.db
      .select()
      .from(schema.salesOrderAttachments)
      .where(
        and(
          eq(schema.salesOrderAttachments.salesOrderId, salesOrderId),
          eq(schema.salesOrderAttachments.fileType, "PDF"),
        ),
      )
      .orderBy(desc(schema.salesOrderAttachments.uploadedAt))
      .limit(1);
    return res[0] || null;
  }

  async findActiveContactsByPartnerId(partnerId: string) {
    return findActiveContactsByPartnerId(this.db, partnerId, "sales_order");
  }

  // CSV用全件データ取得
  async findExportOrdersWithDetails() {
    return await this.db
      .select()
      .from(schema.salesOrders)
      .leftJoin(schema.salesOrderItems, eq(schema.salesOrders.id, schema.salesOrderItems.salesOrderId))
      .orderBy(asc(schema.salesOrders.id), asc(schema.salesOrderItems.sortOrder));
  }

  // 見積ヘッダー Upsert (CSVインポート用)
  async upsertOrderFromCsv(data: any) {
    await this.db
      .insert(schema.salesOrders)
      .values(data)
      .onConflictDoUpdate({
        target: schema.salesOrders.id,
        set: {
          title: data.title,
          partnerId: data.partnerId,
          sourceQuoteId: data.sourceQuoteId,
          companyDepartment: data.companyDepartment,
          orderDate: data.orderDate,
          status: data.status,
          totalAmount: data.totalAmount,
          taxAmount: data.taxAmount,
          memo: data.memo,
          terms: data.terms,
          salesPersonEmployeeNumber: data.salesPersonEmployeeNumber,
          inputPersonEmployeeNumber: data.inputPersonEmployeeNumber,
          updatedBy: data.updatedBy,
          updatedAt: data.updatedAt,
        },
      });
  }

  // 見積からの受注作成用: 見積ヘッダー・明細の取得(読み取り専用、quotesスキーマを直接参照)
  async findQuoteForOrderCreation(quoteId: string) {
    const res = await this.db
      .select()
      .from(schema.quotes)
      .where(eq(schema.quotes.id, quoteId))
      .limit(1);
    return res[0] || null;
  }

  async findQuoteItemsForOrderCreation(quoteId: string) {
    return await this.db
      .select()
      .from(schema.quoteItems)
      .where(eq(schema.quoteItems.quoteId, quoteId))
      .orderBy(asc(schema.quoteItems.sortOrder));
  }

  // BUG-059: 見積明細ごとの受注済み数量(その見積明細から作られた受注明細の数量の合計。受注の状態は問わない)
  async getOrderedQuantitiesByQuoteItemIds(quoteItemIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (quoteItemIds.length === 0) return result;
    const rows = await this.db
      .select({
        quoteItemId: schema.salesOrderItems.sourceQuoteItemId,
        orderedQuantity: sum(schema.salesOrderItems.quantity),
      })
      .from(schema.salesOrderItems)
      .where(inArray(schema.salesOrderItems.sourceQuoteItemId, quoteItemIds))
      .groupBy(schema.salesOrderItems.sourceQuoteItemId);
    for (const r of rows) {
      if (r.quoteItemId) result.set(r.quoteItemId, Number(r.orderedQuantity || 0));
    }
    return result;
  }

  // Item7残課題2-5(#4): 在庫一覧でどの受注が引き当てているかのトレーサビリティ表示用。
  // 品目1件について、受注×倉庫の引当実績(sales_order_item_reservations)を取引先名付きで返す
  async findOrderReservationsByItemId(itemId: string) {
    return await this.db
      .select({
        salesOrderId: schema.salesOrders.id,
        salesOrderTitle: schema.salesOrders.title,
        partnerName: schema.partners.name,
        warehouseId: schema.salesOrderItemReservations.warehouseId,
        reservedQuantity: schema.salesOrderItemReservations.reservedQuantity,
      })
      .from(schema.salesOrderItemReservations)
      .innerJoin(
        schema.salesOrderItems,
        eq(schema.salesOrderItems.id, schema.salesOrderItemReservations.salesOrderItemId),
      )
      .innerJoin(schema.salesOrders, eq(schema.salesOrders.id, schema.salesOrderItems.salesOrderId))
      .leftJoin(schema.partners, eq(schema.partners.id, schema.salesOrders.partnerId))
      .where(eq(schema.salesOrderItems.itemId, itemId));
  }
}
