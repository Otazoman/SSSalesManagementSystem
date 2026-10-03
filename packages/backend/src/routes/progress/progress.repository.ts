import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import * as schema from "../../db/schema";
import { ProgressQuery, ProgressRootKind } from "./progress.schema";
import { resolveOperatorEmployeeNumber } from "../../platform/repository/fallback-operator";
import { fetchInChunks } from "../../platform/repository/chunked-fetch";
import { containsText } from "../../platform/repository/text-search";
import { findPartnerNames, findUserNames } from "../../platform/repository/common-queries";
import type { Context } from "hono";
import type { Env } from "../../types/env";

function jstStartTimestamp(date: string) {
  return Math.floor(new Date(`${date}T00:00:00+09:00`).getTime() / 1000);
}

export interface ProgressRoot {
  kind: ProgressRootKind;
  id: string;
}

// Item12-1: 進捗一覧(見積〜支払の一気通貫ビュー)用の読み取り専用リポジトリ。
// 書き込みは一切行わない。D1読み取り行数節約のため、起点伝票をページング取得したうえで、
// その1ページ分の関連伝票のみをIN句(分割)でまとめて取得する
export class ProgressRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  private async inChunks<T>(ids: string[], fetchChunk: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
    return fetchInChunks(ids, fetchChunk);
  }

  // 「案件」の起点となる伝票の一覧。1案件=1行にするため、下流に含まれる上流伝票は起点にしない:
  //  - 受注(見積があれば同じ行に載せる)
  //  - 受注化されていない見積
  //  - 受注に紐づかない購買申請(受注紐付け=purchase_request_items.sales_order_item_idで判定)
  //  - 購買申請を持たない発注
  // 起点の列名は rk(種別)/rid(伝票番号)にしている(伝票番号の検索用サブクエリ内で、各テーブルのid列と
  // 取り違えないため)。
  private buildRootsQuery(params: ProgressQuery) {
    const kindFilter = params.rootKind ? sql`rk = ${params.rootKind}` : sql`1 = 1`;
    const keywordFilter = params.keyword ? containsText(sql`rid`, params.keyword) : sql`1 = 1`;
    const partnerFilter = params.partnerName
      ? sql`partner_id IN (SELECT id FROM partners WHERE ${containsText(sql`name`, params.partnerName)})`
      : sql`1 = 1`;
    const person = params.person || null;
    const personFilter = person
      ? sql`(p1 IN (SELECT employee_number FROM users WHERE ${containsText(sql`name`, person)} OR ${containsText(sql`employee_number`, person)})
          OR p2 IN (SELECT employee_number FROM users WHERE ${containsText(sql`name`, person)} OR ${containsText(sql`employee_number`, person)}))`
      : sql`1 = 1`;
    const exactPersonFilter = params.personEmployeeNumber
      ? sql`(p1 = ${params.personEmployeeNumber} OR p2 = ${params.personEmployeeNumber})`
      : sql`1 = 1`;
    const startFilter = params.startDate ? sql`d >= ${jstStartTimestamp(params.startDate)}` : sql`1 = 1`;
    let endFilter = sql`1 = 1`;
    if (params.endDate) {
      const end = new Date(`${params.endDate}T00:00:00+09:00`);
      end.setDate(end.getDate() + 1);
      endFilter = sql`d < ${Math.floor(end.getTime() / 1000)}`;
    }
    // 追加要望M-2-d/e: 複合条件検索
    const titleFilter = params.title ? containsText(sql`title`, params.title) : sql`1 = 1`;
    const projectFilter = params.projectName
      ? sql`project_id IN (SELECT id FROM projects WHERE ${containsText(sql`name`, params.projectName)})`
      : sql`1 = 1`;
    const docFilter = params.docNumber ? this.docNumberCondition(params.docNumber) : sql`1 = 1`;
    const keywordAnyFilter = params.q
      ? sql`(${containsText(sql`rid`, params.q)}
          OR ${containsText(sql`title`, params.q)}
          OR partner_id IN (SELECT id FROM partners WHERE ${containsText(sql`name`, params.q)})
          OR project_id IN (SELECT id FROM projects WHERE ${containsText(sql`name`, params.q)})
          OR ${this.docNumberCondition(params.q)})`
      : sql`1 = 1`;
    const fromQuoteFilter = params.fromQuote === "true" ? sql`quote_link = 1` : sql`1 = 1`;

    return sql`
      SELECT rk, rid, d FROM (
        SELECT 'sales_order' AS rk, id AS rid, order_date AS d, partner_id, title, project_id,
          sales_person_employee_number AS p1, input_person_employee_number AS p2,
          CASE WHEN source_quote_id IS NOT NULL THEN 1 ELSE 0 END AS quote_link
          FROM sales_orders
        UNION ALL
        SELECT 'quote', id, quote_date, partner_id, title, project_id,
          sales_person_employee_number, input_person_employee_number, 1
          FROM quotes
          WHERE id NOT IN (SELECT source_quote_id FROM sales_orders WHERE source_quote_id IS NOT NULL)
        UNION ALL
        SELECT 'purchase_request', pr.id, pr.created_at, pr.partner_id, pr.title, pr.project_id,
          pr.input_person_employee_number, pr.applicant_id, 0
          FROM purchase_requests pr
          WHERE NOT EXISTS (
            SELECT 1 FROM purchase_request_items i
            WHERE i.request_id = pr.id AND i.sales_order_item_id IS NOT NULL
          )
        UNION ALL
        SELECT 'purchase_order', o.id, o.order_date, o.partner_id, o.title, o.project_id,
          o.purchase_person_employee_number, o.input_person_employee_number, 0
          FROM orders o WHERE o.request_id IS NULL
      ) WHERE ${kindFilter} AND ${keywordFilter} AND ${partnerFilter} AND ${personFilter} AND ${exactPersonFilter}
        AND ${startFilter} AND ${endFilter} AND ${titleFilter} AND ${projectFilter} AND ${docFilter}
        AND ${keywordAnyFilter} AND ${fromQuoteFilter}
    `;
  }

  // 案件内のどの伝票番号にも部分一致するか(起点+見積+出荷指示/出庫+売上+請求+購買申請+発注+入荷指示/入庫+仕入+支払)。
  // 販売起点は受注明細に紐づく購買申請以降(progress.service.tsの案件の連結と同じ)も対象にする
  private docNumberCondition(keyword: string) {
    const orderSubtree = sql`(${containsText(sql`o.id`, keyword)}
      OR EXISTS (SELECT 1 FROM item_receipt_headers rh WHERE rh.order_id = o.id
                 AND (${containsText(sql`rh.id`, keyword)} OR ${containsText(sql`rh.receipt_instruction_id`, keyword)}))
      OR EXISTS (SELECT 1 FROM purchase_recognitions pr2 WHERE pr2.order_id = o.id
                 AND (${containsText(sql`pr2.id`, keyword)} OR EXISTS (
                   SELECT 1 FROM payment_header_items phi
                   WHERE phi.purchase_recognition_id = pr2.id AND ${containsText(sql`phi.payment_header_id`, keyword)})))
      OR EXISTS (SELECT 1 FROM item_receipt_headers rh2
                 JOIN payment_header_items phi2 ON phi2.item_receipt_id = rh2.id
                 WHERE rh2.order_id = o.id AND ${containsText(sql`phi2.payment_header_id`, keyword)}))`;
    return sql`(${containsText(sql`rid`, keyword)}
      OR (rk = 'sales_order' AND (
        EXISTS (SELECT 1 FROM sales_orders so WHERE so.id = rid AND ${containsText(sql`so.source_quote_id`, keyword)})
        OR EXISTS (SELECT 1 FROM item_shipment_headers sh WHERE sh.sales_order_id = rid AND ${containsText(sql`sh.id`, keyword)})
        OR EXISTS (SELECT 1 FROM item_shipment_instructions si WHERE si.sales_order_id = rid AND ${containsText(sql`si.id`, keyword)})
        OR EXISTS (SELECT 1 FROM sales_invoices inv WHERE inv.sales_order_id = rid AND (
             ${containsText(sql`inv.id`, keyword)}
             OR EXISTS (SELECT 1 FROM billing_items bi WHERE bi.sales_invoice_id = inv.id AND ${containsText(sql`bi.billing_header_id`, keyword)})))
        OR EXISTS (SELECT 1 FROM purchase_request_items pri
                   JOIN sales_order_items soi ON soi.id = pri.sales_order_item_id
                   WHERE soi.sales_order_id = rid AND (
                     ${containsText(sql`pri.request_id`, keyword)}
                     OR EXISTS (SELECT 1 FROM orders o WHERE o.request_id = pri.request_id AND ${orderSubtree})))))
      OR (rk = 'purchase_request' AND EXISTS (SELECT 1 FROM orders o WHERE o.request_id = rid AND ${orderSubtree}))
      OR (rk = 'purchase_order' AND EXISTS (SELECT 1 FROM orders o WHERE o.id = rid AND ${orderSubtree})))`;
  }

  async findRoots(params: ProgressQuery, limit: number, offset: number): Promise<ProgressRoot[]> {
    const rows = await this.db.all<{ rk: ProgressRootKind; rid: string }>(
      sql`${this.buildRootsQuery(params)} ORDER BY d DESC, rid DESC LIMIT ${limit} OFFSET ${offset}`,
    );
    return rows.map((r) => ({ kind: r.rk, id: r.rid }));
  }

  async countRoots(params: ProgressQuery): Promise<number> {
    const rows = await this.db.all<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM (${this.buildRootsQuery(params)})`,
    );
    return Number(rows[0]?.total ?? 0);
  }

  // ---- 担当設定(Item12-2/12-4) ----
  getOperatorEmployeeNumber(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  findStageOwners() {
    return this.db.select().from(schema.progressStageOwners);
  }

  findCaseAssignments(rootIds: string[]) {
    return this.inChunks(rootIds, (chunk) =>
      this.db
        .select()
        .from(schema.progressCaseAssignments)
        .where(inArray(schema.progressCaseAssignments.rootId, chunk)),
    );
  }

  async replaceStageOwners(
    owners: { stageKey: string; assigneeType: string; assigneeRef: string }[],
    operator: string,
  ) {
    const now = new Date();
    const statements = [
      this.db.delete(schema.progressStageOwners),
      ...owners.map((o) =>
        this.db.insert(schema.progressStageOwners).values({
          stageKey: o.stageKey,
          assigneeType: o.assigneeType,
          assigneeRef: o.assigneeRef,
          createdBy: operator,
          createdAt: now,
          updatedBy: operator,
          updatedAt: now,
        }),
      ),
    ];
    await this.db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
  }

  async upsertCaseAssignment(
    a: { rootKind: string; rootId: string; stageKey: string; employeeNumber: string },
    operator: string,
  ) {
    const now = new Date();
    await this.db
      .insert(schema.progressCaseAssignments)
      .values({
        id: crypto.randomUUID(),
        rootKind: a.rootKind,
        rootId: a.rootId,
        stageKey: a.stageKey,
        employeeNumber: a.employeeNumber,
        createdBy: operator,
        createdAt: now,
        updatedBy: operator,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.progressCaseAssignments.rootKind,
          schema.progressCaseAssignments.rootId,
          schema.progressCaseAssignments.stageKey,
        ],
        set: { employeeNumber: a.employeeNumber, updatedBy: operator, updatedAt: now },
      });
  }

  async deleteCaseAssignment(a: { rootKind: string; rootId: string; stageKey: string }) {
    await this.db
      .delete(schema.progressCaseAssignments)
      .where(
        and(
          eq(schema.progressCaseAssignments.rootKind, a.rootKind),
          eq(schema.progressCaseAssignments.rootId, a.rootId),
          eq(schema.progressCaseAssignments.stageKey, a.stageKey),
        ),
      );
  }

  async userExists(employeeNumber: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.employeeNumber, employeeNumber), eq(schema.users.isActive, true)))
      .limit(1);
    return rows.length > 0;
  }

  async roleExists(roleId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.id, roleId))
      .limit(1);
    return rows.length > 0;
  }

  // ---- 完了判定・手動上書き・件名(追加要望M-2) ----
  // 受注明細に対する売上計上済み(APPROVED)数量。返品(RETURN)は減算。
  // sales-invoice.repository.tsのgetInvoicedQuantitiesByOrderItemIdsと同じ集計(1ページ分をまとめて取得する用)
  async findInvoicedQuantities(orderItemIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const rows = await this.inChunks(orderItemIds, (chunk) =>
      this.db
        .select({
          sourceOrderItemId: schema.salesInvoiceItems.sourceOrderItemId,
          documentType: schema.salesInvoices.documentType,
          quantity: sql<number>`SUM(${schema.salesInvoiceItems.quantity})`,
        })
        .from(schema.salesInvoiceItems)
        .innerJoin(schema.salesInvoices, eq(schema.salesInvoices.id, schema.salesInvoiceItems.salesInvoiceId))
        .where(
          and(
            inArray(schema.salesInvoiceItems.sourceOrderItemId, chunk),
            eq(schema.salesInvoices.status, "APPROVED"),
          ),
        )
        .groupBy(schema.salesInvoiceItems.sourceOrderItemId, schema.salesInvoices.documentType),
    );
    for (const row of rows) {
      if (!row.sourceOrderItemId) continue;
      const qty = Number(row.quantity || 0);
      result.set(row.sourceOrderItemId, (result.get(row.sourceOrderItemId) ?? 0) + (row.documentType === "RETURN" ? -qty : qty));
    }
    return result;
  }

  findOrderItems(orderIds: string[]) {
    return this.inChunks(orderIds, (chunk) =>
      this.db
        .select({ id: schema.orderItems.id, orderId: schema.orderItems.orderId, quantity: schema.orderItems.quantity })
        .from(schema.orderItems)
        .where(inArray(schema.orderItems.orderId, chunk)),
    );
  }

  // 発注明細に対する仕入計上済み(APPROVED)数量。返品(RETURN)は減算
  // (purchase-recognition.repository.tsのgetRecognizedQuantitiesByOrderItemIdsと同じ集計)
  async findRecognizedQuantities(orderItemIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const rows = await this.inChunks(orderItemIds, (chunk) =>
      this.db
        .select({
          sourceOrderItemId: schema.purchaseRecognitionItems.sourceOrderItemId,
          documentType: schema.purchaseRecognitions.documentType,
          quantity: sql<number>`SUM(${schema.purchaseRecognitionItems.quantity})`,
        })
        .from(schema.purchaseRecognitionItems)
        .innerJoin(
          schema.purchaseRecognitions,
          eq(schema.purchaseRecognitions.id, schema.purchaseRecognitionItems.purchaseRecognitionId),
        )
        .where(
          and(
            inArray(schema.purchaseRecognitionItems.sourceOrderItemId, chunk),
            eq(schema.purchaseRecognitions.status, "APPROVED"),
          ),
        )
        .groupBy(schema.purchaseRecognitionItems.sourceOrderItemId, schema.purchaseRecognitions.documentType),
    );
    for (const row of rows) {
      if (!row.sourceOrderItemId) continue;
      const qty = Number(row.quantity || 0);
      result.set(row.sourceOrderItemId, (result.get(row.sourceOrderItemId) ?? 0) + (row.documentType === "RETURN" ? -qty : qty));
    }
    return result;
  }

  async findProjectNames(ids: string[]): Promise<Map<string, string>> {
    const rows = await this.inChunks(ids, (chunk) =>
      this.db
        .select({ id: schema.projects.id, name: schema.projects.name })
        .from(schema.projects)
        .where(inArray(schema.projects.id, chunk)),
    );
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  // 伝票の画面で手動設定された「完了/進行中」(document_completion_overrides)。進捗確認は読み取りのみ
  findDocumentOverrides(documentIds: string[]) {
    return this.inChunks(documentIds, (chunk) =>
      this.db
        .select()
        .from(schema.documentCompletionOverrides)
        .where(inArray(schema.documentCompletionOverrides.documentId, chunk)),
    );
  }

  // 追加要望M-2-f: 「部門+ロール」の担当(assigneeRef="部門surrogateId:ロールID")の検証・表示用
  async findDepartmentNames(surrogateIds: string[]): Promise<Map<string, string>> {
    const rows = await this.inChunks(surrogateIds, (chunk) =>
      this.db
        .select({ surrogateId: schema.departments.surrogateId, name: schema.departments.name })
        .from(schema.departments)
        .where(inArray(schema.departments.surrogateId, chunk)),
    );
    return new Map(rows.map((r) => [r.surrogateId, r.name]));
  }

  async departmentExists(surrogateId: string): Promise<boolean> {
    return (await this.findDepartmentNames([surrogateId])).has(surrogateId);
  }

  // 部署の内部ID(surrogateId)→部署コード(departments.id)。CSV出力で部署コードを書くために使う
  async findDepartmentCodes(surrogateIds: string[]): Promise<Map<string, string>> {
    const rows = await this.inChunks(surrogateIds, (chunk) =>
      this.db
        .select({ surrogateId: schema.departments.surrogateId, id: schema.departments.id })
        .from(schema.departments)
        .where(inArray(schema.departments.surrogateId, chunk)),
    );
    return new Map(rows.map((r) => [r.surrogateId, r.id]));
  }

  // 部署コード(departments.id)または内部ID(surrogateId)から、部署の内部IDを解決する。
  // 部署コードは有効期間ごとに複数行あり得るため、現在有効なもののうち最新の開始日を優先し、
  // 現在有効なものが無ければこれから有効になる(未来開始の)最も早いものを使う。有効期間が終了した部署だけの場合はnull
  async resolveDepartmentSurrogateId(codeOrSurrogate: string, now: Date): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(schema.departments)
      .where(
        or(
          eq(schema.departments.surrogateId, codeOrSurrogate),
          and(
            eq(schema.departments.id, codeOrSurrogate),
            or(isNull(schema.departments.validTo), gte(schema.departments.validTo, now)),
          ),
        ),
      );
    const bySurrogate = rows.find((r) => r.surrogateId === codeOrSurrogate);
    if (bySurrogate) return bySurrogate.surrogateId;
    const byCode = rows.filter((r) => r.id === codeOrSurrogate).sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
    const current = byCode.filter((r) => r.validFrom.getTime() <= now.getTime());
    return (current.length > 0 ? current[current.length - 1] : byCode[0])?.surrogateId ?? null;
  }

  // ---- 販売側 ----
  findSalesOrders(ids: string[]) {
    return this.inChunks(ids, (chunk) =>
      this.db.select().from(schema.salesOrders).where(inArray(schema.salesOrders.id, chunk)),
    );
  }

  findQuotes(ids: string[]) {
    return this.inChunks(ids, (chunk) =>
      this.db.select().from(schema.quotes).where(inArray(schema.quotes.id, chunk)),
    );
  }

  findSalesOrderItemIds(salesOrderIds: string[]) {
    return this.inChunks(salesOrderIds, (chunk) =>
      this.db
        .select({
          id: schema.salesOrderItems.id,
          salesOrderId: schema.salesOrderItems.salesOrderId,
          quantity: schema.salesOrderItems.quantity,
        })
        .from(schema.salesOrderItems)
        .where(inArray(schema.salesOrderItems.salesOrderId, chunk)),
    );
  }

  findShipmentInstructionsBySalesOrder(salesOrderIds: string[]) {
    return this.inChunks(salesOrderIds, (chunk) =>
      this.db
        .select()
        .from(schema.itemShipmentInstructions)
        .where(inArray(schema.itemShipmentInstructions.salesOrderId, chunk)),
    );
  }

  findShipmentsBySalesOrder(salesOrderIds: string[]) {
    return this.inChunks(salesOrderIds, (chunk) =>
      this.db
        .select()
        .from(schema.itemShipmentHeaders)
        .where(inArray(schema.itemShipmentHeaders.salesOrderId, chunk)),
    );
  }

  findInvoicesBySalesOrder(salesOrderIds: string[]) {
    return this.inChunks(salesOrderIds, (chunk) =>
      this.db.select().from(schema.salesInvoices).where(inArray(schema.salesInvoices.salesOrderId, chunk)),
    );
  }

  findBillingItemsByInvoice(invoiceIds: string[]) {
    return this.inChunks(invoiceIds, (chunk) =>
      this.db
        .select({
          billingHeaderId: schema.billingItems.billingHeaderId,
          salesInvoiceId: schema.billingItems.salesInvoiceId,
        })
        .from(schema.billingItems)
        .where(inArray(schema.billingItems.salesInvoiceId, chunk)),
    );
  }

  findBillingHeaders(ids: string[]) {
    return this.inChunks(ids, (chunk) =>
      this.db.select().from(schema.billingHeaders).where(inArray(schema.billingHeaders.id, chunk)),
    );
  }

  // ---- 購買側 ----
  // 受注明細に紐づく購買申請(起票トリガー②受注紐付け)
  findPurchaseRequestLinksBySalesOrderItem(salesOrderItemIds: string[]) {
    return this.inChunks(salesOrderItemIds, (chunk) =>
      this.db
        .select({
          requestId: schema.purchaseRequestItems.requestId,
          salesOrderItemId: schema.purchaseRequestItems.salesOrderItemId,
        })
        .from(schema.purchaseRequestItems)
        .where(inArray(schema.purchaseRequestItems.salesOrderItemId, chunk)),
    );
  }

  findPurchaseRequests(ids: string[]) {
    return this.inChunks(ids, (chunk) =>
      this.db.select().from(schema.purchaseRequests).where(inArray(schema.purchaseRequests.id, chunk)),
    );
  }

  findOrdersByIds(ids: string[]) {
    return this.inChunks(ids, (chunk) =>
      this.db.select().from(schema.orders).where(inArray(schema.orders.id, chunk)),
    );
  }

  findOrdersByRequest(requestIds: string[]) {
    return this.inChunks(requestIds, (chunk) =>
      this.db.select().from(schema.orders).where(inArray(schema.orders.requestId, chunk)),
    );
  }

  findItemReceiptsByOrder(orderIds: string[]) {
    return this.inChunks(orderIds, (chunk) =>
      this.db.select().from(schema.itemReceiptHeaders).where(inArray(schema.itemReceiptHeaders.orderId, chunk)),
    );
  }

  findReceiptInstructions(ids: string[]) {
    return this.inChunks(ids, (chunk) =>
      this.db
        .select()
        .from(schema.itemReceiptInstructions)
        .where(inArray(schema.itemReceiptInstructions.id, chunk)),
    );
  }

  findRecognitionsByOrder(orderIds: string[]) {
    return this.inChunks(orderIds, (chunk) =>
      this.db
        .select()
        .from(schema.purchaseRecognitions)
        .where(inArray(schema.purchaseRecognitions.orderId, chunk)),
    );
  }

  // 支払は仕入計上(purchase_recognition_id)または入庫(item_receipt_id)を対象に起票される
  async findPaymentItemsByRecognitionOrReceipt(recognitionIds: string[], receiptIds: string[]) {
    const byRecognition = await this.inChunks(recognitionIds, (chunk) =>
      this.db
        .select({
          paymentHeaderId: schema.paymentHeaderItems.paymentHeaderId,
          purchaseRecognitionId: schema.paymentHeaderItems.purchaseRecognitionId,
          itemReceiptId: schema.paymentHeaderItems.itemReceiptId,
        })
        .from(schema.paymentHeaderItems)
        .where(inArray(schema.paymentHeaderItems.purchaseRecognitionId, chunk)),
    );
    const byReceipt = await this.inChunks(receiptIds, (chunk) =>
      this.db
        .select({
          paymentHeaderId: schema.paymentHeaderItems.paymentHeaderId,
          purchaseRecognitionId: schema.paymentHeaderItems.purchaseRecognitionId,
          itemReceiptId: schema.paymentHeaderItems.itemReceiptId,
        })
        .from(schema.paymentHeaderItems)
        .where(inArray(schema.paymentHeaderItems.itemReceiptId, chunk)),
    );
    return [...byRecognition, ...byReceipt];
  }

  findPaymentHeaders(ids: string[]) {
    return this.inChunks(ids, (chunk) =>
      this.db.select().from(schema.paymentHeaders).where(inArray(schema.paymentHeaders.id, chunk)),
    );
  }

  // ---- 共通(取引先名・担当者名・承認進捗) ----
  async findPartnerNames(ids: string[]): Promise<Map<string, string>> {
    return findPartnerNames(this.db, ids);
  }

  async findUserNamesByEmployeeNumber(employeeNumbers: string[]): Promise<Map<string, string>> {
    return findUserNames(this.db, employeeNumbers);
  }

  // 伝票ごとに「最新の承認申請」を返す(差戻し→再提出で複数回申請されうるため、作成日時の新しい順)
  async findLatestApprovalRequests(targetIds: string[]) {
    const rows = await this.inChunks(targetIds, (chunk) =>
      this.db
        .select({
          id: schema.masterApprovalRequests.id,
          targetId: schema.masterApprovalRequests.targetId,
          status: schema.masterApprovalRequests.status,
          flowId: schema.masterApprovalRequests.flowId,
          createdAt: schema.masterApprovalRequests.createdAt,
        })
        .from(schema.masterApprovalRequests)
        .where(inArray(schema.masterApprovalRequests.targetId, chunk))
        .orderBy(desc(schema.masterApprovalRequests.createdAt)),
    );
    const latestByTargetId = new Map<string, (typeof rows)[number]>();
    for (const row of [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
      if (!latestByTargetId.has(row.targetId)) latestByTargetId.set(row.targetId, row);
    }
    return latestByTargetId;
  }

  findWorkflowLogsByRequest(requestIds: string[]) {
    return this.inChunks(requestIds, (chunk) =>
      this.db
        .select({
          requestId: schema.workflowLogs.requestId,
          layer: schema.workflowLogs.layer,
          status: schema.workflowLogs.status,
          approverRoleId: schema.workflowLogs.approverRoleId,
        })
        .from(schema.workflowLogs)
        .where(inArray(schema.workflowLogs.requestId, chunk)),
    );
  }

  async countFlowSteps(flowIds: string[]): Promise<Map<string, number>> {
    const rows = await this.inChunks(flowIds, (chunk) =>
      this.db
        .select({ flowId: schema.approvalFlowSteps.flowId })
        .from(schema.approvalFlowSteps)
        .where(inArray(schema.approvalFlowSteps.flowId, chunk)),
    );
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.flowId, (counts.get(r.flowId) ?? 0) + 1);
    return counts;
  }

  async findRoleNames(ids: string[]): Promise<Map<string, string>> {
    const rows = await this.inChunks(ids, (chunk) =>
      this.db
        .select({ id: schema.roles.id, name: schema.roles.name })
        .from(schema.roles)
        .where(inArray(schema.roles.id, chunk)),
    );
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
