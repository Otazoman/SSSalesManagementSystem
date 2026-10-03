/**
 * targetType = "purchase_orders" 用のTargetAdapter実装(purchase-requisitions.adapter.tsと同型)。
 * 対象の発注(orders)行はDRAFTとして既にDB上に実在している状態から申請が始まるため、
 * REGISTER(初回承認申請)でも「新規作成」ではなく「既存DRAFT行のステータス確定」として扱う。
 */
import { PurchaseOrderRepository } from "../../routes/purchase/orders/purchase-order.repository";
import { PurchaseOrderService } from "../../routes/purchase/orders/purchase-order.service";
import {
  buildPurchaseOrderItemInsertRow,
  PurchaseOrderItemInput,
} from "../../routes/purchase/orders/purchase-order-item-mapper";
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

interface PurchaseOrderUpdateSnapshot {
  header?: Record<string, any>;
  items?: Array<Record<string, any>>;
}

async function resolveAmount({ db, targetId, payload }: ResolveAmountParams): Promise<number> {
  if (payload.totalAmount !== undefined) {
    return Number(payload.totalAmount) || 0;
  }

  const repo = PurchaseOrderRepository.fromDb(db);
  const order = await repo.findOrderById(targetId);
  if (!order) {
    throw new NotFoundError("対象の発注レコードが存在しません");
  }
  return Number(order.totalAmount || 0);
}

// 最終承認確定時: orders.status を "APPROVED" にする。UPDATE(承認済み発注の編集申請)の場合は
// 退避スナップショット(header/items)を正式反映してからAPPROVEDにする。DELETE(削除申請)の場合は
// 既存のPurchaseOrderService.performOrderDeletion()(R2添付削除込み)をそのまま呼び出す。
async function applyApproved({ db, reqParent, userId, now, c }: ApplyApprovedParams): Promise<void> {
  const repo = PurchaseOrderRepository.fromDb(db);
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(db, userId);

  if (reqParent.requestType === "DELETE") {
    if (!c) {
      console.error("発注の削除承認確定にはContext(R2バインディング)が必要ですが渡されていません");
      return;
    }
    const service = new PurchaseOrderService(new PurchaseOrderRepository(c.env.DB), c.env.DB);
    await service.performOrderDeletion(c, reqParent.targetId);
    return;
  }

  if (reqParent.requestType === "REGISTER") {
    await repo.updateOrder(reqParent.targetId, {
      status: "APPROVED",
      updatedBy: approverEmployeeNumber,
      updatedAt: now,
    });
    return;
  }

  // UPDATE: 承認済み発注の編集申請。退避スナップショットを正式反映する
  const contextRecord = await WorkflowTasksRepository.getApprovalContext(db, reqParent.id);

  if (!contextRecord || !contextRecord.generalMemo) {
    await repo.updateOrder(reqParent.targetId, {
      status: "APPROVED",
      updatedBy: approverEmployeeNumber,
      updatedAt: now,
    });
    return;
  }

  // BUG-048: 読み取りに失敗した申請内容は、内容を変えずに承認済みにする(従来どおり)。
  // 反映の書き込みは repo.applyApprovedUpdate の1回の batch で行い、失敗した場合はエラーを返す(明細が消えたまま承認済みにしない)
  let snapshot: PurchaseOrderUpdateSnapshot;
  try {
    snapshot = JSON.parse(contextRecord.generalMemo) as PurchaseOrderUpdateSnapshot;
  } catch (jsonErr) {
    console.error("発注編集申請の退避データを読み取れないため、内容は変えずに承認済みにします:", jsonErr);
    await repo.updateOrder(reqParent.targetId, {
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
        { items: snapshot.items as any[] | undefined, totalAmount: header.totalAmount, taxAmount: header.taxAmount },
        await repo.findTaxCategoryRates(),
      )
    : header;
  const headerData = {
    title: header.title ?? undefined,
    partnerId: header.partnerId ?? undefined,
    requestId: header.requestId ?? undefined,
    accountCode: header.accountCode ?? null,
    purchasePersonEmployeeNumber: header.purchasePersonEmployeeNumber ?? undefined,
    inputPersonEmployeeNumber: header.inputPersonEmployeeNumber ?? undefined,
    companyName: header.companyName ?? null,
    companyDepartment: header.companyDepartment ?? null,
    companyAddress: header.companyAddress ?? null,
    companyTel: header.companyTel ?? null,
    companyFax: header.companyFax ?? null,
    deliveryDate: header.deliveryDate ?? null,
    deliveryPlace: header.deliveryPlace ?? null,
    deliveryLocationId: header.deliveryLocationId ?? null,
    deliveryWarehouseId: header.deliveryWarehouseId ?? null,
    paymentTerms: header.paymentTerms ?? null,
    isPaid: header.isPaid ?? undefined,
    paidAt: header.paidAt ? new Date(header.paidAt) : undefined,
    totalAmount: totals.totalAmount || 0,
    taxAmount: totals.taxAmount || 0,
    memo: header.memo ?? null,
    status: "APPROVED",
    updatedBy: approverEmployeeNumber,
    updatedAt: now,
  };

  const itemRows = Array.isArray(snapshot.items)
    ? snapshot.items.map((item, index) => buildPurchaseOrderItemInsertRow( item as PurchaseOrderItemInput, reqParent.targetId, index, ))
    : null;

  await repo.applyApprovedUpdate(reqParent.targetId, headerData, itemRows);
}

// 差戻し確定時: REGISTER/UPDATE(承認申請中)はDRAFTへ戻す。DELETE(削除申請)の差戻しは、
// 削除申請時にPENDING_DELETIONへ変更した状態をAPPROVEDへ戻す。
async function applyRemanded({ db, reqParent, now }: ApplyApprovedParams): Promise<void> {
  const repo = PurchaseOrderRepository.fromDb(db);
  const revertStatus = reqParent.requestType === "DELETE" ? "APPROVED" : "DRAFT";

  await repo.updateOrder(reqParent.targetId, {
    status: revertStatus,
    updatedAt: now,
  });
}

async function buildPreviewFromLive(
  repo: PurchaseOrderRepository,
  targetId: string,
): Promise<{ targetName: string; data: unknown } | null> {
  const order = await repo.findOrderById(targetId);
  if (!order) return null;
  const items = await repo.findOrderItems(targetId);
  return {
    targetName: order.title || order.id,
    data: { header: order, items },
  };
}

async function getTaskPreview({ db, requestId, targetId }: TaskPreviewParams): Promise<TaskPreviewResult> {
  const repo = PurchaseOrderRepository.fromDb(db);
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
  return { targetName: "不明な発注", previewData: null };
}

async function getHistoryPreview({
  db,
  requestId,
  targetId,
  requestType,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const repo = PurchaseOrderRepository.fromDb(db);
  const savedContext = await WorkflowTasksRepository.getApprovalContext(db, requestId);

  let targetName = "不明な発注";
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
      if (targetName === "不明な発注") targetName = live.targetName;
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

export const purchaseOrdersAdapter: TargetAdapter = {
  resolveAmount,
  applyApproved,
  applyRemanded,
  getTaskPreview,
  getHistoryPreview,
};
