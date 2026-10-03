import { drizzle } from "drizzle-orm/d1";
import { sql, eq, and, asc, desc, inArray } from "drizzle-orm";
import { count as sqlCount } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { findActiveContactsByPartnerId, findMailTemplate, findTaxCategoryRates, findUnitNames, findUserByEmployeeNumber } from "../../../platform/repository/common-queries";
import { Env } from "../../../types/env";
import { SearchOrdersQuery } from "./purchase-order.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム
const PURCHASE_ORDERS_SORT_COLUMNS = {
  id: schema.orders.id,
  title: schema.orders.title,
  status: schema.orders.status,
  partnerId: schema.orders.partnerId,
  createdAt: schema.orders.createdAt,
};

// sales-order.repository.tsと同じ方針。sales_orders固有(倉庫引当・出荷・与信)のメソッドは
// 発注(仕入先への発注)には存在しない概念のため移植せず、CRUD・PDF・CSV・OTP・メール送信に
// 必要な範囲のみを持つ
export class PurchaseOrderRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): PurchaseOrderRepository {
    const repo: PurchaseOrderRepository = Object.create(PurchaseOrderRepository.prototype);
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildOrderConditions(params: SearchOrdersQuery) {
    const conditions = [];
    if (params.id) conditions.push(containsText(schema.orders.id, params.id));
    if (params.title) conditions.push(containsText(schema.orders.title, params.title));
    if (params.partnerId) conditions.push(eq(schema.orders.partnerId, params.partnerId));
    if (params.status && params.status !== "all")
      conditions.push(eq(schema.orders.status, params.status));
    if (params.requestId) conditions.push(eq(schema.orders.requestId, params.requestId));
    if (params.personEmployeeNumber) {
      conditions.push(
        sql`(
          ${schema.orders.purchasePersonEmployeeNumber} = ${params.personEmployeeNumber}
          OR ${schema.orders.inputPersonEmployeeNumber} = ${params.personEmployeeNumber}
        )`,
      );
    }
    // 追加要望: 明細に含まれる商品(コード・品目名。マスタ選択/手入力どちらも対象)で検索する
    if (params.itemKeyword) {
      const keyword = params.itemKeyword;
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${schema.orderItems}
          LEFT JOIN ${schema.items} ON ${schema.items.id} = ${schema.orderItems.itemId}
          WHERE ${schema.orderItems.orderId} = ${schema.orders.id}
            AND (
              ${containsText(schema.orderItems.itemId, keyword)}
              OR ${containsText(schema.orderItems.itemName, keyword)}
              OR ${containsText(schema.items.name, keyword)}
            )
        )`,
      );
    }

    if (params.startDate) {
      const startTimestamp = Math.floor(
        new Date(`${params.startDate}T00:00:00+09:00`).getTime() / 1000,
      );
      conditions.push(sql`${schema.orders.createdAt} >= ${startTimestamp}`);
    }
    if (params.endDate) {
      const end = new Date(`${params.endDate}T00:00:00+09:00`);
      end.setDate(end.getDate() + 1);
      const endTimestamp = Math.floor(end.getTime() / 1000);
      conditions.push(sql`${schema.orders.createdAt} < ${endTimestamp}`);
    }

    // 追加要望: 注残(発注数量に対して承認済みの仕入計上がまだ満たない明細)がある発注のみで
    // 絞り込む検索フィルタ。purchase-recognition-crud.service.tsの
    // getRecognizedQuantitiesByOrderItemIdsと同じ「承認済み(APPROVED)の仕入計上のみを消込対象
    // とし、RETURNは符号反転して差し引く」計算式を、一覧検索用にEXISTS相関サブクエリとして
    // そのまま踏襲する
    if (params.hasUnrecognizedPurchase === "true") {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${schema.orderItems}
          WHERE ${schema.orderItems.orderId} = ${schema.orders.id}
            AND ${schema.orderItems.quantity} > (
              SELECT COALESCE(SUM(
                CASE WHEN ${schema.purchaseRecognitions.documentType} = 'RETURN'
                  THEN -${schema.purchaseRecognitionItems.quantity}
                  ELSE ${schema.purchaseRecognitionItems.quantity}
                END
              ), 0)
              FROM ${schema.purchaseRecognitionItems}
              INNER JOIN ${schema.purchaseRecognitions}
                ON ${schema.purchaseRecognitions.id} = ${schema.purchaseRecognitionItems.purchaseRecognitionId}
              WHERE ${schema.purchaseRecognitionItems.sourceOrderItemId} = ${schema.orderItems.id}
                AND ${schema.purchaseRecognitions.status} = 'APPROVED'
            )
        )`,
      );
    }

    return conditions;
  }

  async findOrders(params: SearchOrdersQuery, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, PURCHASE_ORDERS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.orders)
      .where(combineConditions(this.buildOrderConditions(params)));
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findOrdersPage(
    params: SearchOrdersQuery,
    pagination: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, PURCHASE_ORDERS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.orders)
      .where(combineConditions(this.buildOrderConditions(params)));
    const q = orderBy ? base.orderBy(...orderBy) : base;
    return await q.limit(pagination.limit).offset(toOffset(pagination));
  }

  async countOrders(params: SearchOrdersQuery): Promise<number> {
    const result = await this.db
      .select({ value: sqlCount() })
      .from(schema.orders)
      .where(combineConditions(this.buildOrderConditions(params)));
    return result[0]?.value || 0;
  }

  async findAttachmentsByOrderIds(orderIds: string[]) {
    if (orderIds.length === 0) return [];
    return await this.db
      .select()
      .from(schema.orderAttachments)
      .where(inArray(schema.orderAttachments.orderId, orderIds));
  }

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

  async findOrderAttachments(orderId: string) {
    return await this.db
      .select()
      .from(schema.orderAttachments)
      .where(eq(schema.orderAttachments.orderId, orderId));
  }

  async existsOrder(id: string) {
    const res = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .limit(1);
    return res.length > 0;
  }

  async insertOrder(data: any) {
    await this.db.insert(schema.orders).values(data);
  }

  async insertOrderItem(data: any) {
    await this.db.insert(schema.orderItems).values(data);
  }

  // CSV取込の明細ID(lineId)の検証用: その明細IDを持つ発注のID(無ければnull)
  async findOrderIdOfItem(orderItemId: string): Promise<string | null> {
    const rows = await this.db
      .select({ orderId: schema.orderItems.orderId })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.id, orderItemId))
      .limit(1);
    return rows[0]?.orderId ?? null;
  }

  // CSV取込の再取込用: 発注明細が仕入・入庫・発注の添付から参照されているか。参照されている明細を消すと
  // FK制約で取込全体が失敗するため、参照されていれば明細を入れ替えない(受注のCSV取込と同じ方針)
  async hasDownstreamItemReferences(orderItemIds: string[]): Promise<boolean> {
    if (orderItemIds.length === 0) return false;
    const [recognitionRows, receiptRows, attachmentRows] = await Promise.all([
      this.db
        .select({ id: schema.purchaseRecognitionItems.id })
        .from(schema.purchaseRecognitionItems)
        .where(inArray(schema.purchaseRecognitionItems.sourceOrderItemId, orderItemIds))
        .limit(1),
      this.db
        .select({ id: schema.itemReceiptItems.id })
        .from(schema.itemReceiptItems)
        .where(inArray(schema.itemReceiptItems.orderItemId, orderItemIds))
        .limit(1),
      this.db
        .select({ id: schema.orderAttachments.id })
        .from(schema.orderAttachments)
        .where(inArray(schema.orderAttachments.orderItemId, orderItemIds))
        .limit(1),
    ]);
    return recognitionRows.length > 0 || receiptRows.length > 0 || attachmentRows.length > 0;
  }

  async deleteOrderItems(orderId: string) {
    await this.db.delete(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
  }

  // BUG-048: 承認済みの伝票の変更申請の承認時に、ヘッダーの更新・明細の入れ替え・履歴を1回の batch で書き込む
  // (以前は1つずつ書き込んでいたため、途中で失敗すると明細が消えたままになりえた)。itemRows が null なら明細は変えない
  async applyApprovedUpdate(
    orderId: string,
    header: Partial<typeof schema.orders.$inferInsert>,
    itemRows: (typeof schema.orderItems.$inferInsert)[] | null,
  ) {
    const statements: any[] = [this.db.update(schema.orders).set(header).where(eq(schema.orders.id, orderId))];
    if (itemRows) {
      statements.push(this.db.delete(schema.orderItems).where(eq(schema.orderItems.orderId, orderId)));
      for (const row of itemRows) statements.push(this.db.insert(schema.orderItems).values(row));
    }
    await this.db.batch(statements as [any, ...any[]]);
  }

  async insertOrderAttachment(data: any) {
    await this.db.insert(schema.orderAttachments).values(data);
  }

  async deleteOrderAttachments(orderId: string) {
    await this.db
      .delete(schema.orderAttachments)
      .where(eq(schema.orderAttachments.orderId, orderId));
  }

  async updateOrder(id: string, data: any) {
    await this.db.update(schema.orders).set(data).where(eq(schema.orders.id, id));
  }

  async deleteOrder(id: string) {
    await this.db.delete(schema.orders).where(eq(schema.orders.id, id));
  }

  async findAttachmentByIdAndOrderId(attachmentId: string, orderId: string) {
    const res = await this.db
      .select()
      .from(schema.orderAttachments)
      .where(
        and(
          eq(schema.orderAttachments.id, attachmentId),
          eq(schema.orderAttachments.orderId, orderId),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  // PDF生成用 取引先(仕入先)および担当ユーザー結合取得(quote/sales-order.repositoryと同型)
  async findOrderWithPartner(id: string) {
    return await this.db
      .select({
        orders: schema.orders,
        partners: schema.partners,
        users: schema.users,
      })
      .from(schema.orders)
      .leftJoin(schema.partners, eq(schema.orders.partnerId, schema.partners.id))
      .leftJoin(
        schema.users,
        eq(schema.orders.purchasePersonEmployeeNumber, schema.users.employeeNumber),
      )
      .where(eq(schema.orders.id, id))
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
      .from(schema.orders)
      .where(and(inArray(schema.orders.id, orderIds), eq(schema.orders.status, "APPROVED")));
  }

  async findLatestPdfAttachment(orderId: string) {
    const res = await this.db
      .select()
      .from(schema.orderAttachments)
      .where(
        and(
          eq(schema.orderAttachments.orderId, orderId),
          eq(schema.orderAttachments.fileType, "PDF"),
        ),
      )
      .orderBy(desc(schema.orderAttachments.uploadedAt))
      .limit(1);
    return res[0] || null;
  }

  async findActiveContactsByPartnerId(partnerId: string) {
    return findActiveContactsByPartnerId(this.db, partnerId, "purchase_order");
  }

  // CSV用全件データ取得
  async findExportOrdersWithDetails() {
    return await this.db
      .select()
      .from(schema.orders)
      .leftJoin(schema.orderItems, eq(schema.orders.id, schema.orderItems.orderId))
      .orderBy(asc(schema.orders.id), asc(schema.orderItems.sortOrder));
  }

  // 発注ヘッダー Upsert (CSVインポート用)
  async upsertOrderFromCsv(data: any) {
    await this.db
      .insert(schema.orders)
      .values(data)
      .onConflictDoUpdate({
        target: schema.orders.id,
        set: {
          title: data.title,
          partnerId: data.partnerId,
          requestId: data.requestId,
          orderDate: data.orderDate,
          status: data.status,
          projectId: data.projectId,
          totalAmount: data.totalAmount,
          taxAmount: data.taxAmount,
          memo: data.memo,
          companyName: data.companyName,
          companyDepartment: data.companyDepartment,
          companyAddress: data.companyAddress,
          companyTel: data.companyTel,
          companyFax: data.companyFax,
          deliveryDate: data.deliveryDate,
          deliveryPlace: data.deliveryPlace,
          paymentTerms: data.paymentTerms,
          purchasePersonEmployeeNumber: data.purchasePersonEmployeeNumber,
          inputPersonEmployeeNumber: data.inputPersonEmployeeNumber,
          isPaid: data.isPaid,
          paidAt: data.paidAt,
          updatedBy: data.updatedBy,
          updatedAt: data.updatedAt,
        },
      });
  }

  // 購買申請からの発注作成用: 購買申請ヘッダー・明細の取得(読み取り専用、purchase_requestsスキーマを直接参照)
  async findRequisitionForOrderCreation(requestId: string) {
    const res = await this.db
      .select()
      .from(schema.purchaseRequests)
      .where(eq(schema.purchaseRequests.id, requestId))
      .limit(1);
    return res[0] || null;
  }

  async findRequisitionItemsForOrderCreation(requestId: string) {
    return await this.db
      .select()
      .from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, requestId))
      .orderBy(asc(schema.purchaseRequestItems.sortOrder));
  }
}
