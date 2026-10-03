import { drizzle } from "drizzle-orm/d1";
import { eq, and, inArray, sql, asc } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as journalSchema from "../../../db/journal-schema";
import { Env } from "../../../types/env";
import { Context } from "hono";
import { JournalExportQuery } from "./journal-export.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";

// Item11-1: 仕訳データ出力(CSV)専用のリポジトリ。K-6(journal-batches.repository.ts)と
// 検索条件は同じだが、あちらはページング一覧・こちらは条件に一致する全件出力という
// 目的の違いがあるため別ファイルに分離する(既存のK-6画面・APIは変更しない)。
export class JournalExportRepository {
  private db; // main DB(部門解決・プロジェクト名は既にjournal_batchesへスナップショット済みのため未使用)
  private journalDb; // DB_JOURNAL

  constructor(d1: D1Database, journalD1: D1Database) {
    this.db = drizzle(d1, { schema });
    this.journalDb = drizzle(journalD1, { schema: journalSchema });
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildConditions(params: JournalExportQuery) {
    const conditions = [];
    if (params.sourceType)
      conditions.push(eq(journalSchema.journalBatches.sourceType, params.sourceType));
    if (params.eventType)
      conditions.push(eq(journalSchema.journalBatches.eventType, params.eventType));
    if (params.onlyOriginal === "true") {
      conditions.push(sql`${journalSchema.journalBatches.reversalOfBatchId} IS NULL`);
      conditions.push(sql`${journalSchema.journalBatches.correctionOfBatchId} IS NULL`);
    }
    if (params.startDate) {
      const startTimestamp = Math.floor(
        new Date(`${params.startDate}T00:00:00+09:00`).getTime() / 1000,
      );
      conditions.push(sql`${journalSchema.journalBatches.entryDate} >= ${startTimestamp}`);
    }
    if (params.endDate) {
      const end = new Date(`${params.endDate}T00:00:00+09:00`);
      end.setDate(end.getDate() + 1);
      const endTimestamp = Math.floor(end.getTime() / 1000);
      conditions.push(sql`${journalSchema.journalBatches.entryDate} < ${endTimestamp}`);
    }
    return conditions;
  }

  async findBatchesForExport(params: JournalExportQuery) {
    return await this.journalDb
      .select()
      .from(journalSchema.journalBatches)
      .where(combineConditions(this.buildConditions(params)))
      .orderBy(asc(journalSchema.journalBatches.entryDate));
  }

  async findLinesByBatchIds(batchIds: string[]) {
    if (batchIds.length === 0) return [];
    return await this.journalDb
      .select()
      .from(journalSchema.journalLines)
      .where(inArray(journalSchema.journalLines.batchId, batchIds))
      .orderBy(asc(journalSchema.journalLines.lineNo));
  }

  // 部門はプロジェクト・勘定科目と異なり転記時点でスナップショットされていない(伝票種別によって
  // 持ち方が不統一なため、まずはベストエフォートで解決する方針。2026-09-19ユーザー確認済み)。
  // 承認機能有効時はmaster_approval_requestsの申請部門を優先し、それが無い場合(承認無効、または
  // 購買申請を介さない単独発注等)は購買申請の部門へフォールバックする
  async resolveDepartmentNames(
    batches: { sourceType: string; sourceRefId: string }[],
  ): Promise<Map<string, string>> {
    const baseIdBySourceType = new Map<string, Set<string>>();
    const keyOf = (sourceType: string, baseId: string) => `${sourceType}::${baseId}`;
    for (const b of batches) {
      const baseId = b.sourceRefId.split("#")[0];
      if (!baseIdBySourceType.has(b.sourceType)) baseIdBySourceType.set(b.sourceType, new Set());
      baseIdBySourceType.get(b.sourceType)!.add(baseId);
    }

    const salesOrderIds = [...(baseIdBySourceType.get("sales_order") ?? [])];
    const salesInvoiceIds = [...(baseIdBySourceType.get("sales_invoice") ?? [])];
    const purchaseOrderIds = [...(baseIdBySourceType.get("purchase_order") ?? [])];
    const purchaseRecognitionIds = [...(baseIdBySourceType.get("purchase_recognition") ?? [])];

    // 1. 承認申請テーブルからの部門解決(承認機能が有効な伝票のみ記録がある)
    const approvalTargets: { targetType: string; targetId: string }[] = [];
    if (salesOrderIds.length > 0)
      salesOrderIds.forEach((id) => approvalTargets.push({ targetType: "sales_orders", targetId: id }));
    if (salesInvoiceIds.length > 0)
      salesInvoiceIds.forEach((id) => approvalTargets.push({ targetType: "sales_invoices", targetId: id }));
    if (purchaseOrderIds.length > 0)
      purchaseOrderIds.forEach((id) => approvalTargets.push({ targetType: "purchase_orders", targetId: id }));
    if (purchaseRecognitionIds.length > 0)
      purchaseRecognitionIds.forEach((id) =>
        approvalTargets.push({ targetType: "purchase_recognitions", targetId: id }),
      );

    const surrogateIdByKey = new Map<string, string>();

    if (approvalTargets.length > 0) {
      const allTargetIds = [...new Set(approvalTargets.map((t) => t.targetId))];
      const rows = await this.db
        .select({
          targetType: schema.masterApprovalRequests.targetType,
          targetId: schema.masterApprovalRequests.targetId,
          applicantDepartmentSurrogateId: schema.masterApprovalRequests.applicantDepartmentSurrogateId,
        })
        .from(schema.masterApprovalRequests)
        .where(inArray(schema.masterApprovalRequests.targetId, allTargetIds));

      const targetTypeToSourceType: Record<string, string> = {
        sales_orders: "sales_order",
        sales_invoices: "sales_invoice",
        purchase_orders: "purchase_order",
        purchase_recognitions: "purchase_recognition",
      };
      for (const row of rows) {
        if (!row.applicantDepartmentSurrogateId) continue;
        const sourceType = targetTypeToSourceType[row.targetType];
        if (!sourceType) continue;
        surrogateIdByKey.set(keyOf(sourceType, row.targetId), row.applicantDepartmentSurrogateId);
      }
    }

    // 2. 購入側フォールバック: 承認申請から取れなかった発注・仕入について、
    //    購買申請(purchase_requests.departmentSurrogateId)を経由して解決する
    const unresolvedPurchaseOrderIds = purchaseOrderIds.filter(
      (id) => !surrogateIdByKey.has(keyOf("purchase_order", id)),
    );
    const unresolvedPurchaseRecognitionIds = purchaseRecognitionIds.filter(
      (id) => !surrogateIdByKey.has(keyOf("purchase_recognition", id)),
    );

    if (unresolvedPurchaseOrderIds.length > 0 || unresolvedPurchaseRecognitionIds.length > 0) {
      let recognitionOrderIdById = new Map<string, string | null>();
      if (unresolvedPurchaseRecognitionIds.length > 0) {
        const recognitionRows = await this.db
          .select({ id: schema.purchaseRecognitions.id, orderId: schema.purchaseRecognitions.orderId })
          .from(schema.purchaseRecognitions)
          .where(inArray(schema.purchaseRecognitions.id, unresolvedPurchaseRecognitionIds));
        recognitionOrderIdById = new Map(recognitionRows.map((r) => [r.id, r.orderId]));
      }

      const orderIdsNeedingRequestId = [
        ...new Set([
          ...unresolvedPurchaseOrderIds,
          ...[...recognitionOrderIdById.values()].filter((id): id is string => !!id),
        ]),
      ];

      if (orderIdsNeedingRequestId.length > 0) {
        const orderRows = await this.db
          .select({ id: schema.orders.id, requestId: schema.orders.requestId })
          .from(schema.orders)
          .where(inArray(schema.orders.id, orderIdsNeedingRequestId));
        const requestIdByOrderId = new Map(orderRows.map((o) => [o.id, o.requestId]));

        const requestIds = [...new Set([...requestIdByOrderId.values()].filter((id): id is string => !!id))];
        if (requestIds.length > 0) {
          const requestRows = await this.db
            .select({
              id: schema.purchaseRequests.id,
              departmentSurrogateId: schema.purchaseRequests.departmentSurrogateId,
            })
            .from(schema.purchaseRequests)
            .where(inArray(schema.purchaseRequests.id, requestIds));
          const surrogateIdByRequestId = new Map(
            requestRows.map((r) => [r.id, r.departmentSurrogateId]),
          );

          for (const orderId of unresolvedPurchaseOrderIds) {
            const requestId = requestIdByOrderId.get(orderId);
            const surrogateId = requestId ? surrogateIdByRequestId.get(requestId) : null;
            if (surrogateId) surrogateIdByKey.set(keyOf("purchase_order", orderId), surrogateId);
          }
          for (const recognitionId of unresolvedPurchaseRecognitionIds) {
            const orderId = recognitionOrderIdById.get(recognitionId);
            const requestId = orderId ? requestIdByOrderId.get(orderId) : null;
            const surrogateId = requestId ? surrogateIdByRequestId.get(requestId) : null;
            if (surrogateId) surrogateIdByKey.set(keyOf("purchase_recognition", recognitionId), surrogateId);
          }
        }
      }
    }

    // 3. 部門surrogateId → 部門名
    const result = new Map<string, string>();
    const surrogateIds = [...new Set(surrogateIdByKey.values())];
    if (surrogateIds.length === 0) return result;

    const departmentRows = await this.db
      .select({ surrogateId: schema.departments.surrogateId, name: schema.departments.name })
      .from(schema.departments)
      .where(inArray(schema.departments.surrogateId, surrogateIds));
    const nameBySurrogateId = new Map(departmentRows.map((d) => [d.surrogateId, d.name]));

    for (const [key, surrogateId] of surrogateIdByKey) {
      const name = nameBySurrogateId.get(surrogateId);
      if (name) result.set(key, name);
    }
    return result;
  }
}
