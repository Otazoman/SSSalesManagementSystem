/**
 * targetType = "purchase_requisitions" 用のTargetAdapter実装(quotes.adapter.tsと同型。
 * admin/approval-flows画面の「対象業務」選択肢がscreens.tsのresource値をそのまま使う仕様のため、
 * それに合わせている)。対象の購買申請(purchase_requests)行はDRAFTとして既にDB上に実在している
 * 状態から申請が始まるため、REGISTER(初回承認申請)でも「新規作成」ではなく
 * 「既存DRAFT行のステータス確定」として扱う。
 */
import { PurchaseRequisitionRepository } from "../../routes/purchase/requisitions/purchase-requisition.repository";
import { PurchaseRequisitionService } from "../../routes/purchase/requisitions/purchase-requisition.service";
import {
  buildPurchaseRequisitionItemInsertRow,
  PurchaseRequisitionItemInput,
} from "../../routes/purchase/requisitions/purchase-requisition-item-mapper";
import { WorkflowTasksRepository } from "../../routes/workflow/workflow-tasks/workflow-tasks.repository";
import { NotFoundError } from "../../platform/http/http-error";
import { resolveEmployeeNumberByUserId } from "../../platform/repository/fallback-operator";
import type {
  TargetAdapter,
  ResolveAmountParams,
  ApplyApprovedParams,
  TaskPreviewParams,
  TaskPreviewResult,
  HistoryPreviewParams,
  HistoryPreviewResult,
} from "./registry";
import { recalculateDocumentTotals } from "../../platform/tax/recalculate-document-totals";

interface PurchaseRequisitionUpdateSnapshot {
  header?: Record<string, any>;
  items?: Array<Record<string, any>>;
}

async function resolveAmount({
  db,
  targetId,
  payload,
}: ResolveAmountParams): Promise<number> {
  if (payload.totalAmount !== undefined) {
    return Number(payload.totalAmount) || 0;
  }

  const repo = PurchaseRequisitionRepository.fromDb(db);
  const requisition = await repo.findRequisitionById(targetId);
  if (!requisition) {
    throw new NotFoundError("対象の購買申請レコードが存在しません");
  }
  return Number(requisition.totalAmount || 0);
}

// 最終承認確定時: purchase_requests.status を "APPROVED" にする。UPDATE(承認済み購買申請の
// 編集申請)の場合は退避スナップショット(header/items)を正式反映してからAPPROVEDにする。
// DELETE(削除申請)の場合は既存のPurchaseRequisitionService.performRequisitionDeletion()
// (R2添付削除込み)をそのまま呼び出す。
async function applyApproved({
  db,
  reqParent,
  userId,
  now,
  c,
}: ApplyApprovedParams): Promise<void> {
  const repo = PurchaseRequisitionRepository.fromDb(db);
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(db, userId);

  if (reqParent.requestType === "DELETE") {
    if (!c) {
      console.error(
        "購買申請の削除承認確定にはContext(R2バインディング)が必要ですが渡されていません",
      );
      return;
    }
    const service = new PurchaseRequisitionService(new PurchaseRequisitionRepository(c.env.DB));
    await service.performRequisitionDeletion(c, reqParent.targetId);
    return;
  }

  if (reqParent.requestType === "REGISTER") {
    await repo.updateRequisition(reqParent.targetId, {
      status: "APPROVED",
      updatedBy: approverEmployeeNumber,
      updatedAt: now,
    });
    return;
  }

  // UPDATE: 承認済み購買申請の編集申請。退避スナップショットを正式反映する
  const contextRecord = await WorkflowTasksRepository.getApprovalContext(db, reqParent.id);

  if (!contextRecord || !contextRecord.generalMemo) {
    await repo.updateRequisition(reqParent.targetId, {
      status: "APPROVED",
      updatedBy: approverEmployeeNumber,
      updatedAt: now,
    });
    return;
  }

  // BUG-048: 読み取りに失敗した申請内容は、内容を変えずに承認済みにする(従来どおり)。
  // 反映の書き込みは repo.applyApprovedUpdate の1回の batch で行い、失敗した場合はエラーを返す(明細が消えたまま承認済みにしない)
  let snapshot: PurchaseRequisitionUpdateSnapshot;
  try {
    snapshot = JSON.parse(contextRecord.generalMemo) as PurchaseRequisitionUpdateSnapshot;
  } catch (jsonErr) {
    console.error("購買申請編集申請の退避データを読み取れないため、内容は変えずに承認済みにします:", jsonErr);
    await repo.updateRequisition(reqParent.targetId, {
      status: "APPROVED",
      updatedBy: approverEmployeeNumber,
      updatedAt: now,
    });
    return;
  }
  const header = snapshot.header || {};

  // BUG-042: 反映する合計・消費税は、申請内容の明細から計算し直す(会社設定の端数処理)。Context が無い場合は申請時の値
  const totals = c
    ? await recalculateDocumentTotals(
        c.env.COMPANY_SETTINGS,
        { items: (snapshot.items as any[] | undefined)?.map((i) => ({ ...i, unitPrice: i.estimatedUnitPrice })), totalAmount: header.totalAmount, taxAmount: header.taxAmount },
        await repo.findTaxCategoryRates(),
      )
    : header;
  const headerData = {
    title: header.title ?? undefined,
    departmentSurrogateId: header.departmentSurrogateId ?? undefined,
    requestType: header.requestType ?? undefined,
    partnerId: header.partnerId ?? null,
    partnerName: header.partnerName ?? null,
    partnerInputType: header.partnerInputType ?? "MASTER",
    projectId: header.projectId ?? null,
    applicantId: header.applicantId ?? undefined,
    inputPersonEmployeeNumber: header.inputPersonEmployeeNumber ?? undefined,
    totalAmount: totals.totalAmount || 0,
    taxAmount: totals.taxAmount || 0,
    memo: header.memo ?? null,
    status: "APPROVED",
    updatedBy: approverEmployeeNumber,
    updatedAt: now,
  };

  const itemRows = Array.isArray(snapshot.items)
    ? snapshot.items.map((item, index) => buildPurchaseRequisitionItemInsertRow( item as PurchaseRequisitionItemInput, reqParent.targetId, index, ))
    : null;

  await repo.applyApprovedUpdate(reqParent.targetId, headerData, itemRows);
}

// 差戻し確定時: REGISTER/UPDATE(承認申請中)はDRAFTへ戻す。DELETE(削除申請)の差戻しは、
// 削除申請時にPENDING_DELETIONへ変更した状態をAPPROVEDへ戻す。
async function applyRemanded({
  db,
  reqParent,
  now,
}: ApplyApprovedParams): Promise<void> {
  const repo = PurchaseRequisitionRepository.fromDb(db);
  const revertStatus = reqParent.requestType === "DELETE" ? "APPROVED" : "DRAFT";

  await repo.updateRequisition(reqParent.targetId, {
    status: revertStatus,
    updatedAt: now,
  });
}

async function buildPreviewFromLive(
  repo: PurchaseRequisitionRepository,
  targetId: string,
): Promise<{ targetName: string; data: unknown } | null> {
  const requisition = await repo.findRequisitionById(targetId);
  if (!requisition) return null;
  const items = await repo.findRequisitionItems(targetId);
  return {
    targetName: requisition.title || requisition.id,
    data: { header: requisition, items },
  };
}

async function getTaskPreview({
  db,
  requestId,
  targetId,
}: TaskPreviewParams): Promise<TaskPreviewResult> {
  const repo = PurchaseRequisitionRepository.fromDb(db);
  const savedContext = await WorkflowTasksRepository.getApprovalContext(db, requestId);

  if (savedContext && savedContext.generalMemo) {
    try {
      const snapshot = JSON.parse(savedContext.generalMemo);
      const header = snapshot.header || snapshot;
      return {
        targetName: header.title || targetId,
        previewData: snapshot,
      };
    } catch (_) {
      // フォールスルーして現在のDB内容を使う
    }
  }

  const live = await buildPreviewFromLive(repo, targetId);
  if (live) return { targetName: live.targetName, previewData: live.data };
  return { targetName: "不明な購買申請", previewData: null };
}

async function getHistoryPreview({
  db,
  requestId,
  targetId,
  requestType,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const repo = PurchaseRequisitionRepository.fromDb(db);
  const savedContext = await WorkflowTasksRepository.getApprovalContext(db, requestId);

  let targetName = "不明な購買申請";
  let snapshotNew: unknown = null;
  let snapshotOld: unknown = null;

  if (savedContext && savedContext.generalMemo) {
    try {
      const snapshot = JSON.parse(savedContext.generalMemo);
      snapshotNew = snapshot;
      const header = snapshot.header || snapshot;
      targetName = header.title || targetId;
    } catch (_) {
      targetName = "データパースエラー";
    }
  }

  if (requestType === "UPDATE" || requestType === "DELETE") {
    const live = await buildPreviewFromLive(repo, targetId);
    if (live) {
      snapshotOld = live.data;
      if (targetName === "不明な購買申請") targetName = live.targetName;
    }
  } else if (!snapshotNew) {
    const live = await buildPreviewFromLive(repo, targetId);
    if (live) {
      snapshotNew = live.data;
      targetName = live.targetName;
    }
  }

  return { targetName, snapshotNew, snapshotOld };
}

export const purchaseRequisitionsAdapter: TargetAdapter = {
  resolveAmount,
  applyApproved,
  applyRemanded,
  getTaskPreview,
  getHistoryPreview,
};
