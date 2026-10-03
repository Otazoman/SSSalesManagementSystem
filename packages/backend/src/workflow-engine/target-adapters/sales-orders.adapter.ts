/**
 * targetType = "sales_orders" 用のTargetAdapter実装。quotes.adapter.tsと同じ方針
 * (admin/approval-flows画面の「対象業務」選択肢がscreens.tsのresource値をそのまま使う仕様のため、
 * それに合わせている)。対象の受注(sales_orders)行はDRAFTとして既にDB上に実在している状態から
 * 申請が始まるため、REGISTER(初回承認申請)でも「新規作成」ではなく「既存DRAFT行のステータス確定」
 * として扱う(quotesと対称)。
 */
import { SalesOrderRepository } from "../../routes/sales/orders/sales-order.repository";
import { SalesOrderService } from "../../routes/sales/orders/sales-order.service";
import {
  buildSalesOrderItemInsertRow,
  SalesOrderItemInput,
} from "../../routes/sales/orders/sales-order-item-mapper";
import { WorkflowTasksRepository } from "../../routes/workflow/workflow-tasks/workflow-tasks.repository";
import { NotFoundError } from "../../platform/http/http-error";
import { resolveEmployeeNumberByUserId } from "../../platform/repository/fallback-operator";
import {
  WarehouseStockReservationRepository,
  releaseOrderItemsWarehouseAware,
  revertPendingUpdateReservationOutcome,
  PendingUpdateReservationOutcome,
} from "../../platform/inventory/warehouse-stock-reservation.repository";
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

interface SalesOrderUpdateSnapshot {
  header?: Record<string, any>;
  items?: Array<Record<string, any>>;
  // Item7残課題2-5フォローアップ6: 変更申請の提出時点(sales-order-crud.service.tsの
  // submitUpdateForApproval)で既に確保済みの引当結果。承認確定時はこれをそのままledgerへ
  // 反映するだけで、在庫チェックのやり直しは行わない(二重処理防止)
  reservationOutcome?: PendingUpdateReservationOutcome;
}

async function resolveAmount({
  db,
  targetId,
  payload,
}: ResolveAmountParams): Promise<number> {
  if (payload.totalAmount !== undefined) {
    return Number(payload.totalAmount) || 0;
  }

  const repo = SalesOrderRepository.fromDb(db);
  const order = await repo.findOrderById(targetId);
  if (!order) {
    throw new NotFoundError("対象の受注レコードが存在しません");
  }
  return Number(order.totalAmount || 0);
}

// 最終承認確定時: sales_orders.status を "APPROVED" にする。UPDATE(承認済み受注の編集申請)の
// 場合は退避スナップショット(header/items)を正式反映してからAPPROVEDにする。DELETE(削除申請)の
// 場合は既存のSalesOrderService.performOrderDeletion()(R2添付削除込み)をそのまま呼び出す。
async function applyApproved({
  db,
  reqParent,
  userId,
  now,
  c,
}: ApplyApprovedParams): Promise<void> {
  const repo = SalesOrderRepository.fromDb(db);
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(db, userId);

  if (reqParent.requestType === "DELETE") {
    if (!c) {
      console.error(
        "受注の削除承認確定にはContext(R2バインディング)が必要ですが渡されていません",
      );
      return;
    }
    const service = new SalesOrderService(new SalesOrderRepository(c.env.DB));
    await service.performOrderDeletion(c, reqParent.targetId);
    return;
  }

  if (reqParent.requestType === "REGISTER") {
    // Item7残課題2-5フォローアップ6: 在庫の引当は既に申請提出時点(submitForApproval)で
    // 確保済みのため、ここでは在庫チェックをやり直さない(二重引当になってしまうため)。
    // ステータスの確定のみ行う
    await repo.updateOrder(reqParent.targetId, {
      status: "APPROVED",
      updatedBy: approverEmployeeNumber,
      updatedAt: now,
    });
    return;
  }

  // UPDATE: 承認済み受注の編集申請。退避スナップショットを正式反映する
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
  let snapshot: SalesOrderUpdateSnapshot;
  try {
    snapshot = JSON.parse(contextRecord.generalMemo) as SalesOrderUpdateSnapshot;
  } catch (jsonErr) {
    console.error("受注編集申請の退避データを読み取れないため、内容は変えずに承認済みにします:", jsonErr);
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
    title: header.title ?? null,
    partnerId: header.partnerId ?? undefined,
    sourceQuoteId: header.sourceQuoteId ?? null,
    orderDate: header.orderDate ? new Date(header.orderDate) : undefined,
    status: "APPROVED",
    totalAmount: totals.totalAmount || 0,
    taxAmount: totals.taxAmount || 0,
    memo: header.memo ?? null,
    terms: header.terms ?? null,
    companyName: header.companyName ?? null,
    companyDepartment: header.companyDepartment ?? null,
    salesPersonEmployeeNumber: header.salesPersonEmployeeNumber ?? null,
    inputPersonEmployeeNumber: header.inputPersonEmployeeNumber ?? null,
    companyAddress: header.companyAddress ?? null,
    companyTel: header.companyTel ?? null,
    companyFax: header.companyFax ?? null,
    deliveryDate: header.deliveryDate ?? null,
    deliveryPlace: header.deliveryPlace ?? null,
    deliveryDestinationId: header.deliveryDestinationId ?? null,
    paymentTerms: header.paymentTerms ?? null,
    isPrepaid: header.isPrepaid ?? undefined,
    prepaidAt: header.prepaidAt ? new Date(header.prepaidAt) : undefined,
    updatedBy: approverEmployeeNumber,
    updatedAt: now,
  };

  // Item7残課題2-5フォローアップ6: 在庫の引当調整(旧明細分の解放・新明細分の確保)は
  // 既に申請提出時点(submitUpdateForApproval)で完了しカウンタに反映済みのため、ここでは
  // 在庫チェックをやり直さない(二重処理防止)。旧明細を削除する際もカウンタは触らず、
  // 新明細を作成すると同時に、提出時点の確保実績(引当の記録・入荷待ち数量)を書き込むだけ
  let itemRows: (ReturnType<typeof buildSalesOrderItemInsertRow> & { backorderedQuantity?: number })[] | null = null;
  const ledgerRows: { id: string; salesOrderItemId: string; warehouseId: string; reservedQuantity: number; createdAt: Date; updatedAt: Date }[] = [];
  if (Array.isArray(snapshot.items)) {
    itemRows = snapshot.items.map((item, index) =>
      buildSalesOrderItemInsertRow(item as SalesOrderItemInput, reqParent.targetId, index),
    );
    for (const outcomeItem of snapshot.reservationOutcome?.items ?? []) {
      const row = itemRows[outcomeItem.index];
      if (!row) continue;
      row.backorderedQuantity = outcomeItem.backorderedQuantity;
      for (const r of outcomeItem.reservations) {
        ledgerRows.push({
          id: crypto.randomUUID(),
          salesOrderItemId: row.id,
          warehouseId: r.warehouseId,
          reservedQuantity: r.quantity,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  await repo.applyApprovedUpdate(reqParent.targetId, headerData, itemRows, ledgerRows, {
    id: crypto.randomUUID(),
    salesOrderId: reqParent.targetId,
    version: 1,
    action: "UPDATE",
    snapshotData: contextRecord.generalMemo,
    changedById: approverEmployeeNumber,
    changedAt: now,
    comment: "承認により内容を反映しました",
  });
}

// 差戻し・取消確定時: REGISTER(初回承認申請中、対象は元々DRAFTのまま)はDRAFTへ戻す。
// DELETE(削除申請)の差戻しは、削除申請時にPENDING_DELETIONへ変更した状態をAPPROVEDへ戻す。
// Item7残課題2-5フォローアップ5: UPDATE(承認済み受注の変更申請)も、対象は申請中もAPPROVEDの
// ままであり(handleRequestUpdateはスナップショットを退避するのみで対象自体は書き換えない)、
// 実際の明細差し替えは最終承認確定時(applyApproved)まで一切行われない。そのため差戻し・取消時は
// ステータスとしては何も変更されておらずAPPROVEDへ戻すのが正しい(以前はquotes.adapter.tsと
// 同じ「DELETE以外は一律DRAFTへ戻す」ロジックを踏襲していたため、UPDATE差戻し時に誤って
// APPROVED→DRAFTへ格下げされていた)。
// Item7残課題2-5フォローアップ6: 在庫引当は申請提出時点(submitForApproval/submitUpdateForApproval)
// で既に確保済みのため、差戻し・取消時はステータスを戻すだけでなく、その確保も元に戻す必要がある。
// - REGISTER: 提出時に確保した分をそのまま解放する
// - UPDATE: 提出時に(旧明細解放→新明細確保)しているので、その逆(新明細分解放→旧明細分再確保)を行う
// - DELETE: 削除申請時点では在庫引当に一切手を付けていないため何もしない
async function applyRemanded({ db, reqParent, now }: ApplyApprovedParams): Promise<void> {
  const repo = SalesOrderRepository.fromDb(db);

  if (reqParent.requestType === "REGISTER") {
    const items = await repo.findOrderItems(reqParent.targetId);
    const warehouseReservationRepo = WarehouseStockReservationRepository.fromDb(db);
    await releaseOrderItemsWarehouseAware(warehouseReservationRepo, items, now);

    await repo.updateOrder(reqParent.targetId, {
      status: "DRAFT",
      updatedAt: now,
    });
    return;
  }

  if (reqParent.requestType === "UPDATE") {
    const contextRecord = await WorkflowTasksRepository.getApprovalContext(db, reqParent.id);
    if (contextRecord && contextRecord.generalMemo) {
      try {
        const snapshot = JSON.parse(contextRecord.generalMemo) as SalesOrderUpdateSnapshot;
        if (snapshot.reservationOutcome) {
          const oldItems = await repo.findOrderItems(reqParent.targetId);
          const warehouseReservationRepo = WarehouseStockReservationRepository.fromDb(db);
          await revertPendingUpdateReservationOutcome(
            warehouseReservationRepo,
            snapshot.reservationOutcome,
            oldItems.map((item) => ({ id: item.id, itemId: item.itemId })),
            now,
          );
        }
      } catch (jsonErr) {
        console.error("受注変更申請の差戻し時、退避データのパースに失敗しました:", jsonErr);
      }
    }

    await repo.updateOrder(reqParent.targetId, {
      status: "APPROVED",
      updatedAt: now,
    });
    return;
  }

  // DELETE
  await repo.updateOrder(reqParent.targetId, {
    status: "APPROVED",
    updatedAt: now,
  });
}

async function buildPreviewFromLive(
  repo: SalesOrderRepository,
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

async function getTaskPreview({
  db,
  requestId,
  targetId,
}: TaskPreviewParams): Promise<TaskPreviewResult> {
  const repo = SalesOrderRepository.fromDb(db);
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
  return { targetName: "不明な受注", previewData: null };
}

async function getHistoryPreview({
  db,
  requestId,
  targetId,
  requestType,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const repo = SalesOrderRepository.fromDb(db);
  const savedContext = await WorkflowTasksRepository.getApprovalContext(db, requestId);

  let targetName = "不明な受注";
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
      if (targetName === "不明な受注") targetName = live.targetName;
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

export const salesOrdersAdapter: TargetAdapter = {
  // BUG-049: 書き込みの結果を使う処理(書き込み直後の再集計など)や R2 の後始末を含むため、承認の書き込みとはまとめず、先に実行する
  requiresImmediateWrites: true,
  resolveAmount,
  applyApproved,
  applyRemanded,
  getTaskPreview,
  getHistoryPreview,
};
