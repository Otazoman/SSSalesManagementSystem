import type { Context } from "hono";
import type { Env } from "../../types/env";
import { ProgressRepository, ProgressRoot } from "./progress.repository";
import { computeNextStages } from "./progress-next-step";
import { logAuditEvent } from "../../platform/audit/log-audit-event";
import { BadRequestError } from "../../platform/http/http-error";
import { buildCsvContent, csvField, withBom } from "../../platform/csv/csv-writer";
import { computeCaseState, computeStageStatus, isFullyFulfilled } from "./progress-completion";
import {
  PROGRESS_STAGE_KEYS,
  ProgressApproval,
  ProgressQuery,
  ProgressRow,
  ProgressStageDoc,
  ProgressStageKey,
  ProgressStageStatus,
  CaseAssignmentPayload,
  StageOwnersPayload,
} from "./progress.schema";

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 50;
// 進行中/完了の絞り込みは完了判定が必要なため、起点をこの件数ずつ走査して組み立てる。
// 1リクエストで走査する上限(D1の読み取り節約)を超えたらnextOffsetを返して続きを読み込ませる
const SCAN_BATCH_SIZE = 30;
const MAX_SCAN = 300;
// CSVエクスポートの上限(走査する起点の件数)
const CSV_MAX_SCAN = 2000;
const CSV_MAX_ROWS = 1000;

const ROOT_KIND_LABELS: Record<string, string> = {
  sales_order: "受注起点",
  quote: "見積起点(受注化前)",
  purchase_request: "購買申請起点",
  purchase_order: "発注起点",
};
const STAGE_LABELS: Record<ProgressStageKey, string> = {
  quote: "見積",
  sales_order: "受注",
  purchase_request: "購買申請",
  purchase_order: "発注",
  receipt_instruction: "入荷指示",
  item_receipt: "入荷",
  purchase_recognition: "仕入",
  shipment_instruction: "出荷指示",
  item_shipment: "出荷",
  sales_invoice: "売上",
  billing: "請求",
  payment: "支払",
};
const STATE_LABELS = { NONE: "", COMPLETED: "完了", IN_PROGRESS: "進行中" } as const;

interface RawDoc {
  id: string;
  status: string;
  // 担当者(社員番号)。伝票に担当者列が無い工程はnull
  assigneeEmployeeNumber: string | null;
  // 追加要望M-2-a: この伝票自体の完了判定(自動)
  completed: boolean;
}

// 部門+ロールの担当は assigneeRef="部門surrogateId:ロールID"
function splitDeptRole(ref: string): { deptId: string; roleId: string } {
  const index = ref.indexOf(":");
  return index < 0 ? { deptId: ref, roleId: "" } : { deptId: ref.slice(0, index), roleId: ref.slice(index + 1) };
}

function emptyStages(): Record<ProgressStageKey, RawDoc[]> {
  return Object.fromEntries(PROGRESS_STAGE_KEYS.map((k) => [k, [] as RawDoc[]])) as Record<
    ProgressStageKey,
    RawDoc[]
  >;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string | null | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

// Item12-1/12-3: 見積→受注→購買申請→発注→入荷→入庫→仕入→出荷→出庫→売上→請求→支払を
// 案件(1行)単位で横断表示するためのサービス。読み取り専用。
// 受注を軸に、受注明細に紐づく購買申請(受注紐付け)以降の購買側も同じ行に載せる。
// 受注に紐づかない購買は購買申請/発注を起点とする単独行にする
// 伝票の手動設定(COMPLETED/IN_PROGRESS)があればそれを完了状態とし、無ければ自動判定のまま
function applyCompletionOverride(forced: string | undefined, autoCompleted: boolean) {
  return forced ? { completed: forced === "COMPLETED", manual: true } : { completed: autoCompleted, manual: false };
}

export class ProgressService {
  private repo: ProgressRepository;

  constructor(repo: ProgressRepository) {
    this.repo = repo;
  }

  private parsePageSize(query: ProgressQuery) {
    return Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number.parseInt(query.pageSize ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
    );
  }

  // state=all: 従来どおりのページング(総件数あり)。
  // state=in_progress(既定)/completed: 起点を日付降順に走査し、案件を組み立てて完了判定した結果で絞り込む。
  //  総件数は求められないためtotal=null。続きがある場合はnextOffset(次の走査開始位置)を返す
  async getProgress(query: ProgressQuery) {
    const pageSize = this.parsePageSize(query);
    const state = query.state ?? "in_progress";

    if (state === "all") {
      const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
      const [roots, total] = await Promise.all([
        this.repo.findRoots(query, pageSize, (page - 1) * pageSize),
        this.repo.countRoots(query),
      ]);
      if (roots.length === 0) return { items: [], total, page, pageSize, nextOffset: null };
      return { items: await this.buildRows(roots), total, page, pageSize, nextOffset: null };
    }

    const offset = Math.max(0, Number.parseInt(query.offset ?? "0", 10) || 0);
    const { items, nextOffset } = await this.scanRows(query, state, offset, pageSize, MAX_SCAN);
    return { items, total: null, page: 1, pageSize, nextOffset };
  }

  private async scanRows(
    query: ProgressQuery,
    state: "in_progress" | "completed" | "all",
    startOffset: number,
    limit: number,
    maxScan: number,
  ): Promise<{ items: ProgressRow[]; nextOffset: number | null }> {
    const items: ProgressRow[] = [];
    let offset = startOffset;
    while (offset - startOffset < maxScan) {
      const batchSize = Math.min(SCAN_BATCH_SIZE, startOffset + maxScan - offset);
      const roots = await this.repo.findRoots(query, batchSize, offset);
      if (roots.length === 0) return { items, nextOffset: null };
      const rows = await this.buildRows(roots);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (state !== "all" && (state === "completed") !== (row.caseState === "COMPLETED")) continue;
        items.push(row);
        if (items.length >= limit) {
          const consumed = offset + i + 1;
          const isEnd = i === rows.length - 1 && roots.length < batchSize;
          return { items, nextOffset: isEnd ? null : consumed };
        }
      }
      offset += roots.length;
      if (roots.length < batchSize) return { items, nextOffset: null };
    }
    return { items, nextOffset: offset };
  }

  // 追加要望M-2-c: 検索結果のCSVエクスポート(インポートは提供しない)
  async exportCsv(c: Context<{ Bindings: Env }>, query: ProgressQuery) {
    const state = query.state ?? "in_progress";
    const { items } = await this.scanRows(query, state, 0, CSV_MAX_ROWS, CSV_MAX_SCAN);
    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_PROGRESS_CSV", "progress_overview", "ALL_RECORDS", null, { recordCount: items.length }),
    );
    const headers = [
      "起点種別",
      "起点伝票番号",
      "取引先",
      "件名",
      "プロジェクト",
      "案件状態",
      ...PROGRESS_STAGE_KEYS.flatMap((k) => [`${STAGE_LABELS[k]}伝票`, `${STAGE_LABELS[k]}状態`]),
      "次工程",
      "次工程担当",
    ];
    const lines = items.map((row) =>
      [
        csvField(ROOT_KIND_LABELS[row.rootKind] ?? row.rootKind),
        csvField(row.rootId),
        csvField(row.partnerName),
        csvField(row.title),
        csvField(row.projectName),
        csvField(row.caseState === "COMPLETED" ? "完了" : "進行中"),
        ...PROGRESS_STAGE_KEYS.flatMap((k) => {
          const status = row.stageStatuses[k];
          const label = STATE_LABELS[status.state] + (status.manual && status.state !== "NONE" ? "(手動)" : "");
          return [csvField(row.stages[k].map((d) => d.id).join(" ")), csvField(label)];
        }),
        csvField(row.nextSteps.map((n) => STAGE_LABELS[n.stageKey]).join(" / ")),
        csvField(row.nextSteps.map((n) => n.assigneeName ?? "").join(" / ")),
      ].join(","),
    );
    return withBom(buildCsvContent(headers, lines));
  }

  private async buildRows(roots: ProgressRoot[]): Promise<ProgressRow[]> {
    const rootIdsOf = (kind: ProgressRoot["kind"]) => roots.filter((r) => r.kind === kind).map((r) => r.id);
    const salesOrderRootIds = rootIdsOf("sales_order");
    const quoteRootIds = rootIdsOf("quote");
    const requestRootIds = rootIdsOf("purchase_request");
    const orderRootIds = rootIdsOf("purchase_order");

    // ---- 販売側 ----
    const salesOrders = await this.repo.findSalesOrders(salesOrderRootIds);
    const quotes = await this.repo.findQuotes([
      ...quoteRootIds,
      ...salesOrders.map((o) => o.sourceQuoteId).filter((id): id is string => !!id),
    ]);
    const quoteById = new Map(quotes.map((q) => [q.id, q]));
    const salesOrderById = new Map(salesOrders.map((o) => [o.id, o]));

    const soItems = await this.repo.findSalesOrderItemIds(salesOrderRootIds);
    const salesOrderIdByItemId = new Map(soItems.map((i) => [i.id, i.salesOrderId]));
    const invoicedQtyByItem = await this.repo.findInvoicedQuantities(soItems.map((i) => i.id));
    const soItemsBySo = groupBy(soItems, (i) => i.salesOrderId);
    const prLinks = await this.repo.findPurchaseRequestLinksBySalesOrderItem(soItems.map((i) => i.id));

    const shipmentInstructionsBySo = groupBy(
      await this.repo.findShipmentInstructionsBySalesOrder(salesOrderRootIds),
      (s) => s.salesOrderId,
    );
    const shipmentsBySo = groupBy(await this.repo.findShipmentsBySalesOrder(salesOrderRootIds), (s) => s.salesOrderId);
    const invoices = await this.repo.findInvoicesBySalesOrder(salesOrderRootIds);
    const invoicesBySo = groupBy(invoices, (i) => i.salesOrderId);
    const billingItems = await this.repo.findBillingItemsByInvoice(invoices.map((i) => i.id));
    const billingHeaders = await this.repo.findBillingHeaders(billingItems.map((b) => b.billingHeaderId));
    const billingHeaderById = new Map(billingHeaders.map((h) => [h.id, h]));
    const billingIdsByInvoice = groupBy(billingItems, (b) => b.salesInvoiceId);

    // ---- 購買側 ----
    const requestIdsBySo = new Map<string, Set<string>>();
    for (const link of prLinks) {
      const soId = link.salesOrderItemId ? salesOrderIdByItemId.get(link.salesOrderItemId) : undefined;
      if (!soId) continue;
      if (!requestIdsBySo.has(soId)) requestIdsBySo.set(soId, new Set());
      requestIdsBySo.get(soId)!.add(link.requestId);
    }
    const allRequestIds = [...new Set([...prLinks.map((l) => l.requestId), ...requestRootIds])];
    const purchaseRequests = await this.repo.findPurchaseRequests(allRequestIds);
    const requestById = new Map(purchaseRequests.map((r) => [r.id, r]));

    const ordersByRequest = await this.repo.findOrdersByRequest(allRequestIds);
    const rootOrders = await this.repo.findOrdersByIds(orderRootIds);
    const orderById = new Map([...ordersByRequest, ...rootOrders].map((o) => [o.id, o]));
    const allOrderIds = [...orderById.keys()];
    const ordersByRequestId = groupBy(ordersByRequest, (o) => o.requestId);
    const orderItems = await this.repo.findOrderItems(allOrderIds);
    const recognizedQtyByItem = await this.repo.findRecognizedQuantities(orderItems.map((i) => i.id));
    const orderItemsByOrder = groupBy(orderItems, (i) => i.orderId);

    const receiptsByOrder = groupBy(await this.repo.findItemReceiptsByOrder(allOrderIds), (r) => r.orderId);
    const allReceipts = [...receiptsByOrder.values()].flat();
    const receiptInstructions = await this.repo.findReceiptInstructions(
      allReceipts.map((r) => r.receiptInstructionId).filter((id): id is string => !!id),
    );
    const receiptInstructionById = new Map(receiptInstructions.map((i) => [i.id, i]));
    const recognitionsByOrder = groupBy(await this.repo.findRecognitionsByOrder(allOrderIds), (r) => r.orderId);
    const allRecognitions = [...recognitionsByOrder.values()].flat();

    const paymentItems = await this.repo.findPaymentItemsByRecognitionOrReceipt(
      allRecognitions.map((r) => r.id),
      allReceipts.map((r) => r.id),
    );
    const paymentHeaders = await this.repo.findPaymentHeaders(paymentItems.map((p) => p.paymentHeaderId));
    const paymentHeaderById = new Map(paymentHeaders.map((h) => [h.id, h]));
    const paymentHeaderIdsByRecognition = groupBy(paymentItems, (p) => p.purchaseRecognitionId);
    const paymentHeaderIdsByReceipt = groupBy(paymentItems, (p) => p.itemReceiptId);

    // ---- 行の組み立て ----
    const uniqueById = (docs: RawDoc[]): RawDoc[] => [...new Map(docs.map((d) => [d.id, d])).values()];

    const addPurchaseSide = (stages: Record<ProgressStageKey, RawDoc[]>, requestIds: string[], directOrderIds: string[]) => {
      for (const requestId of requestIds) {
        const req = requestById.get(requestId);
        if (req) {
          stages.purchase_request.push({
            id: req.id,
            status: req.status,
            assigneeEmployeeNumber: req.inputPersonEmployeeNumber ?? req.applicantId,
            // 発注化済み
            completed: (ordersByRequestId.get(req.id) ?? []).length > 0,
          });
        }
      }
      const orderIds = [
        ...requestIds.flatMap((rid) => (ordersByRequestId.get(rid) ?? []).map((o) => o.id)),
        ...directOrderIds,
      ];
      for (const orderId of new Set(orderIds)) {
        const order = orderById.get(orderId);
        if (!order) continue;
        stages.purchase_order.push({
          id: order.id,
          status: order.status,
          assigneeEmployeeNumber: order.purchasePersonEmployeeNumber ?? order.inputPersonEmployeeNumber,
          // 追加注残なし(全明細の仕入計上数量が発注数量以上)
          completed:
            order.status === "APPROVED" &&
            isFullyFulfilled(orderItemsByOrder.get(orderId) ?? [], recognizedQtyByItem),
        });
        for (const receipt of receiptsByOrder.get(orderId) ?? []) {
          stages.item_receipt.push({
            id: receipt.id,
            status: receipt.status,
            assigneeEmployeeNumber: null,
            completed: receipt.status === "APPROVED",
          });
          const instruction = receipt.receiptInstructionId
            ? receiptInstructionById.get(receipt.receiptInstructionId)
            : undefined;
          if (instruction) {
            stages.receipt_instruction.push({
              id: instruction.id,
              status: instruction.status,
              assigneeEmployeeNumber: null,
              completed: instruction.status === "FULFILLED",
            });
          }
          for (const p of paymentHeaderIdsByReceipt.get(receipt.id) ?? []) {
            const header = paymentHeaderById.get(p.paymentHeaderId);
            if (header) {
              stages.payment.push({
                id: header.id,
                status: header.status,
                assigneeEmployeeNumber: null,
                completed: header.reconciliationStatus === "RECONCILED",
              });
            }
          }
        }
        for (const rec of recognitionsByOrder.get(orderId) ?? []) {
          stages.purchase_recognition.push({
            id: rec.id,
            status: rec.status,
            assigneeEmployeeNumber: rec.purchasePersonEmployeeNumber ?? rec.inputPersonEmployeeNumber,
            completed: rec.status === "APPROVED" && rec.paymentStatus === "PAID",
          });
          for (const p of paymentHeaderIdsByRecognition.get(rec.id) ?? []) {
            const header = paymentHeaderById.get(p.paymentHeaderId);
            if (header) {
              stages.payment.push({
                id: header.id,
                status: header.status,
                assigneeEmployeeNumber: null,
                completed: header.reconciliationStatus === "RECONCILED",
              });
            }
          }
        }
      }
    };

    const rawRows: {
      root: ProgressRoot;
      partnerId: string | null;
      title: string | null;
      projectId: string | null;
      stages: Record<ProgressStageKey, RawDoc[]>;
    }[] = [];

    for (const root of roots) {
      const stages = emptyStages();
      let partnerId: string | null = null;
      let title: string | null = null;
      let projectId: string | null = null;

      if (root.kind === "quote") {
        const quote = quoteById.get(root.id);
        partnerId = quote?.partnerId ?? null;
        title = quote?.title ?? null;
        projectId = quote?.projectId ?? null;
        if (quote) {
          stages.quote.push({
            id: quote.id,
            status: quote.status,
            assigneeEmployeeNumber: quote.salesPersonEmployeeNumber ?? quote.inputPersonEmployeeNumber,
            completed: false, // 受注化されていない(受注化済みの見積は受注起点の行に載る)
          });
        }
      } else if (root.kind === "sales_order") {
        const so = salesOrderById.get(root.id);
        partnerId = so?.partnerId ?? null;
        title = so?.title ?? null;
        projectId = so?.projectId ?? null;
        const quote = so?.sourceQuoteId ? quoteById.get(so.sourceQuoteId) : undefined;
        if (quote) {
          stages.quote.push({
            id: quote.id,
            status: quote.status,
            assigneeEmployeeNumber: quote.salesPersonEmployeeNumber ?? quote.inputPersonEmployeeNumber,
            completed: true, // 受注化済み
          });
        }
        if (so) {
          stages.sales_order.push({
            id: so.id,
            status: so.status,
            assigneeEmployeeNumber: so.salesPersonEmployeeNumber ?? so.inputPersonEmployeeNumber,
            // 追加注残なし(全明細の売上計上数量が受注数量以上)
            completed: so.status === "APPROVED" && isFullyFulfilled(soItemsBySo.get(so.id) ?? [], invoicedQtyByItem),
          });
        }
        for (const s of shipmentInstructionsBySo.get(root.id) ?? []) {
          stages.shipment_instruction.push({
            id: s.id,
            status: s.status,
            assigneeEmployeeNumber: null,
            completed: s.status === "FULFILLED",
          });
        }
        for (const s of shipmentsBySo.get(root.id) ?? []) {
          stages.item_shipment.push({
            id: s.id,
            status: s.status,
            assigneeEmployeeNumber: null,
            completed: s.status === "APPROVED",
          });
        }
        for (const inv of invoicesBySo.get(root.id) ?? []) {
          stages.sales_invoice.push({
            id: inv.id,
            status: inv.status,
            assigneeEmployeeNumber: inv.salesPersonEmployeeNumber ?? inv.inputPersonEmployeeNumber,
            completed: inv.status === "APPROVED" && inv.billingStatus === "BILLED",
          });
          for (const item of billingIdsByInvoice.get(inv.id) ?? []) {
            const header = billingHeaderById.get(item.billingHeaderId);
            if (header) {
              stages.billing.push({
                id: header.id,
                status: header.status,
                assigneeEmployeeNumber: null,
                completed: header.reconciliationStatus === "RECONCILED",
              });
            }
          }
        }
        addPurchaseSide(stages, [...(requestIdsBySo.get(root.id) ?? [])], []);
      } else if (root.kind === "purchase_request") {
        const req = requestById.get(root.id);
        partnerId = req?.partnerId ?? null;
        title = req?.title ?? null;
        projectId = req?.projectId ?? null;
        addPurchaseSide(stages, [root.id], []);
      } else {
        const order = orderById.get(root.id);
        partnerId = order?.partnerId ?? null;
        title = order?.title ?? null;
        projectId = order?.projectId ?? null;
        addPurchaseSide(stages, [], [root.id]);
      }

      for (const key of PROGRESS_STAGE_KEYS) stages[key] = uniqueById(stages[key]);
      rawRows.push({ root, partnerId, title, projectId, stages });
    }

    // ---- 担当者名・取引先名・承認進捗・担当設定の解決(1ページ分をまとめて) ----
    const allDocs = rawRows.flatMap((r) => PROGRESS_STAGE_KEYS.flatMap((k) => r.stages[k]));
    const [owners, caseAssignments, overrides] = await Promise.all([
      this.repo.findStageOwners(),
      this.repo.findCaseAssignments(rawRows.map((r) => r.root.id)),
      this.repo.findDocumentOverrides(allDocs.map((d) => d.id)),
    ]);
    const deptRoleOwners = owners.filter((o) => o.assigneeType === "DEPT_ROLE").map((o) => splitDeptRole(o.assigneeRef));
    const [partnerNames, userNames, approvalById, roleNames, projectNames, deptNames] = await Promise.all([
      this.repo.findPartnerNames(rawRows.map((r) => r.partnerId).filter((id): id is string => !!id)),
      this.repo.findUserNamesByEmployeeNumber([
        ...allDocs.map((d) => d.assigneeEmployeeNumber).filter((n): n is string => !!n),
        ...caseAssignments.map((a) => a.employeeNumber),
        ...owners.filter((o) => o.assigneeType === "USER").map((o) => o.assigneeRef),
      ]),
      this.resolveApprovals(allDocs.map((d) => d.id)),
      this.repo.findRoleNames([
        ...owners.filter((o) => o.assigneeType === "ROLE").map((o) => o.assigneeRef),
        ...deptRoleOwners.map((d) => d.roleId),
      ]),
      this.repo.findProjectNames(rawRows.map((r) => r.projectId).filter((id): id is string => !!id)),
      this.repo.findDepartmentNames(deptRoleOwners.map((d) => d.deptId)),
    ]);
    // 伝票の画面で手動設定された完了/進行中(工程キー+伝票ID)。進捗確認は表示のみで、設定は各伝票の画面から行う
    const docOverride = new Map(overrides.map((o) => [`${o.stageKey}::${o.documentId}`, o.forcedState]));

    // 担当の解決順: 案件×工程の個別割当 > 工程の既定担当(個人 or ロール)
    const ownerByStage = new Map(owners.map((o) => [o.stageKey, o]));
    const caseKey = (kind: string, id: string, stage: string) => `${kind}::${id}::${stage}`;
    const caseEmployee = new Map(
      caseAssignments.map((a) => [caseKey(a.rootKind, a.rootId, a.stageKey), a.employeeNumber]),
    );
    const nameOf = (employeeNumber: string) => userNames.get(employeeNumber) ?? employeeNumber;
    const resolveAssignee = (
      kind: string,
      id: string,
      stage: ProgressStageKey,
    ): { name: string; source: "case" | "stage" } | null => {
      const individual = caseEmployee.get(caseKey(kind, id, stage));
      if (individual) return { name: nameOf(individual), source: "case" };
      const owner = ownerByStage.get(stage);
      if (!owner) return null;
      let name: string;
      if (owner.assigneeType === "USER") {
        name = nameOf(owner.assigneeRef);
      } else if (owner.assigneeType === "DEPT_ROLE") {
        const { deptId, roleId } = splitDeptRole(owner.assigneeRef);
        name = `部署/ロール: ${deptNames.get(deptId) ?? deptId} / ${roleNames.get(roleId) ?? roleId}`;
      } else {
        name = `ロール: ${roleNames.get(owner.assigneeRef) ?? owner.assigneeRef}`;
      }
      return { name, source: "stage" };
    };

    return rawRows.map(({ root, partnerId, title, projectId, stages }): ProgressRow => {
      const resolved = Object.fromEntries(
        PROGRESS_STAGE_KEYS.map((key) => [
          key,
          stages[key].map(
            (d): ProgressStageDoc => ({
              id: d.id,
              status: d.status,
              // 伝票自身の担当者列がある工程はそれを優先し、無い工程は個別割当/工程の既定担当で補う
              assigneeName: d.assigneeEmployeeNumber
                ? nameOf(d.assigneeEmployeeNumber)
                : (resolveAssignee(root.kind, root.id, key)?.name ?? null),
              approval: approvalById.get(d.id) ?? null,
              ...applyCompletionOverride(docOverride.get(`${key}::${d.id}`), d.completed),
            }),
          ),
        ]),
      ) as Record<ProgressStageKey, ProgressStageDoc[]>;

      const stageStatuses = Object.fromEntries(
        PROGRESS_STAGE_KEYS.map((key) => [
          key,
          computeStageStatus(resolved[key]),
        ]),
      ) as Record<ProgressStageKey, ProgressStageStatus>;

      const nextSteps = computeNextStages(root.kind, (key) => stages[key].length > 0).map((next) => {
        const assignee = resolveAssignee(root.kind, root.id, next.stageKey);
        return { ...next, assigneeName: assignee?.name ?? null, source: assignee?.source ?? null };
      });

      const assignments: ProgressRow["assignments"] = {};
      for (const a of caseAssignments) {
        if (a.rootKind === root.kind && a.rootId === root.id) {
          assignments[a.stageKey as ProgressStageKey] = { employeeNumber: a.employeeNumber, name: nameOf(a.employeeNumber) };
        }
      }

      return {
        rootKind: root.kind,
        rootId: root.id,
        partnerName: partnerId ? (partnerNames.get(partnerId) ?? null) : null,
        title,
        projectName: projectId ? (projectNames.get(projectId) ?? null) : null,
        stages: resolved,
        stageStatuses,
        caseState: computeCaseState(stageStatuses),
        nextSteps,
        assignments,
      };
    });
  }

  // ---- 担当設定(Item12-2/12-4) ----
  // CSVの部署コード⇔内部IDの変換(担当設定は内部IDで保存するが、CSVは部署コードで指定・出力する)
  resolveDepartmentSurrogateId(codeOrSurrogate: string) {
    return this.repo.resolveDepartmentSurrogateId(codeOrSurrogate, new Date());
  }

  getDepartmentCodes(surrogateIds: string[]) {
    return this.repo.findDepartmentCodes(surrogateIds);
  }

  async getStageOwners() {
    const owners = await this.repo.findStageOwners();
    const deptRoles = owners.filter((o) => o.assigneeType === "DEPT_ROLE").map((o) => splitDeptRole(o.assigneeRef));
    const [userNames, roleNames, deptNames] = await Promise.all([
      this.repo.findUserNamesByEmployeeNumber(owners.filter((o) => o.assigneeType === "USER").map((o) => o.assigneeRef)),
      this.repo.findRoleNames([
        ...owners.filter((o) => o.assigneeType === "ROLE").map((o) => o.assigneeRef),
        ...deptRoles.map((d) => d.roleId),
      ]),
      this.repo.findDepartmentNames(deptRoles.map((d) => d.deptId)),
    ]);
    return owners.map((o) => {
      let assigneeName: string;
      if (o.assigneeType === "USER") {
        assigneeName = userNames.get(o.assigneeRef) ?? o.assigneeRef;
      } else if (o.assigneeType === "DEPT_ROLE") {
        const { deptId, roleId } = splitDeptRole(o.assigneeRef);
        assigneeName = `${deptNames.get(deptId) ?? deptId} / ${roleNames.get(roleId) ?? roleId}`;
      } else {
        assigneeName = roleNames.get(o.assigneeRef) ?? o.assigneeRef;
      }
      return { stageKey: o.stageKey, assigneeType: o.assigneeType, assigneeRef: o.assigneeRef, assigneeName };
    });
  }

  // 工程ごとの既定担当を一括保存する(payloadに無い工程は未設定になる)
  async saveStageOwners(c: Context<{ Bindings: Env }>, payload: StageOwnersPayload) {
    const stageKeys = payload.owners.map((o) => o.stageKey);
    if (new Set(stageKeys).size !== stageKeys.length) {
      throw new BadRequestError("同じ工程を複数回指定することはできません");
    }
    for (const owner of payload.owners) {
      if (owner.assigneeType === "DEPT_ROLE") {
        const { deptId, roleId } = splitDeptRole(owner.assigneeRef);
        if (!deptId || !roleId) {
          throw new BadRequestError("部署+ロールは「部署ID:ロールID」の形式で指定してください");
        }
        if (!(await this.repo.departmentExists(deptId))) {
          throw new BadRequestError(`部署が見つかりません: ${deptId}`);
        }
        if (!(await this.repo.roleExists(roleId))) {
          throw new BadRequestError(`ロールが見つかりません: ${roleId}`);
        }
        continue;
      }
      const exists =
        owner.assigneeType === "USER"
          ? await this.repo.userExists(owner.assigneeRef)
          : await this.repo.roleExists(owner.assigneeRef);
      if (!exists) {
        throw new BadRequestError(
          `${owner.assigneeType === "USER" ? "ユーザー" : "ロール"}が見つかりません: ${owner.assigneeRef}`,
        );
      }
    }
    const before = await this.repo.findStageOwners();
    await this.repo.replaceStageOwners(payload.owners, await this.repo.getOperatorEmployeeNumber(c));
    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_PROGRESS_STAGE_OWNERS", "admin_progress_stage_owners", "GLOBAL_CONFIG", before, payload),
    );
    return { success: true };
  }

  // 案件×工程の個別割当(employeeNumberがnullなら解除)
  async saveCaseAssignment(c: Context<{ Bindings: Env }>, payload: CaseAssignmentPayload) {
    if (payload.employeeNumber === null) {
      await this.repo.deleteCaseAssignment(payload);
    } else {
      if (!(await this.repo.userExists(payload.employeeNumber))) {
        throw new BadRequestError(`ユーザーが見つかりません: ${payload.employeeNumber}`);
      }
      await this.repo.upsertCaseAssignment(
        { ...payload, employeeNumber: payload.employeeNumber },
        await this.repo.getOperatorEmployeeNumber(c),
      );
    }
    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_PROGRESS_CASE_ASSIGNMENT", "progress_overview", `${payload.rootKind}:${payload.rootId}`, null, payload),
    );
    return { success: true };
  }

  // 伝票ごとの最新の承認申請から、承認ステップの進み具合と現在の承認待ちロールを求める。
  // ワークフローログは「通過済みステップ=APPROVED」「現在のステップ=PENDING」の1行ずつが
  // 順次追加される方式のため、APPROVED件数=完了ステップ数、PENDING行のロール=承認待ちロールとなる
  private async resolveApprovals(targetIds: string[]): Promise<Map<string, ProgressApproval>> {
    const latest = await this.repo.findLatestApprovalRequests(targetIds);
    const result = new Map<string, ProgressApproval>();
    if (latest.size === 0) return result;

    const requests = [...latest.values()];
    const logs = await this.repo.findWorkflowLogsByRequest(requests.map((r) => r.id));
    const logsByRequest = groupBy(logs, (l) => l.requestId);
    const stepCounts = await this.repo.countFlowSteps(requests.map((r) => r.flowId).filter((id): id is string => !!id));
    const roleNames = await this.repo.findRoleNames(
      logs.filter((l) => l.status === "PENDING").map((l) => l.approverRoleId),
    );

    for (const [targetId, request] of latest) {
      const requestLogs = logsByRequest.get(request.id) ?? [];
      const approvedLayers = requestLogs.filter((l) => l.status === "APPROVED").length;
      const pending = requestLogs.find((l) => l.status === "PENDING");
      const totalLayers = Math.max(
        request.flowId ? (stepCounts.get(request.flowId) ?? 0) : 0,
        ...requestLogs.map((l) => l.layer),
      );
      result.set(targetId, {
        requestStatus: request.status,
        approvedLayers,
        totalLayers,
        pendingRoleName: pending ? (roleNames.get(pending.approverRoleId) ?? null) : null,
      });
    }
    return result;
  }
}
