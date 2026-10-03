/**
 * targetType = "master_warehouses" 用のTargetAdapter実装(残り6マスタへの承認機能展開)。
 * unitsと同じく、warehousesは登録済みidが既にDB上に"temporary"として実在する状態から
 * 申請が始まるため、REGISTER承認確定時は「新規作成」ではなく「既存temporary行の
 * ステータス確定」として扱う。UPDATE(既存有効データの変更申請)は、事前にlive行を
 * temporaryへロックしてから承認申請が行われる前提で、承認確定時に退避スナップショット
 * (JSON)の内容を正式反映する。
 */
import { WarehousesRepository } from "../../routes/master/warehouses/warehouses.repository";
import { WorkflowTasksRepository } from "../../routes/workflow/workflow-tasks/workflow-tasks.repository";
import { resolveEmployeeNumberByUserId } from "../../platform/repository/fallback-operator";
import type {
  TargetAdapter,
  ApplyApprovedParams,
  TaskPreviewParams,
  TaskPreviewResult,
  HistoryPreviewParams,
  HistoryPreviewResult,
} from "./registry";

async function applyApproved({
  db,
  reqParent,
  userId,
  now,
}: ApplyApprovedParams): Promise<void> {
  const repo = WarehousesRepository.fromDb(db);
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(
    db,
    userId,
  );

  if (reqParent.requestType === "UPDATE") {
    const contextRecord = await WorkflowTasksRepository.getApprovalContext(
      db,
      reqParent.id,
    );
    if (contextRecord && contextRecord.generalMemo) {
      try {
        const snapshot = JSON.parse(contextRecord.generalMemo);
        const finalStatus =
          snapshot.status && snapshot.status !== "temporary"
            ? snapshot.status
            : "active";
        await repo.updateWarehouse(
          reqParent.targetId,
          {
            id: reqParent.targetId,
            name: snapshot.name,
            postalCode: snapshot.postalCode ?? null,
            address: snapshot.address ?? null,
            phoneNumber: snapshot.phoneNumber ?? null,
            faxNumber: snapshot.faxNumber ?? null,
            email: snapshot.email ?? null,
            businessStartTime: snapshot.businessStartTime ?? null,
            businessEndTime: snapshot.businessEndTime ?? null,
            storageRestrictions: snapshot.storageRestrictions ?? null,
            warehouseType: snapshot.warehouseType || "INTERNAL",
            status: finalStatus,
            memo: snapshot.memo ?? null,
            availableDays: snapshot.availableDays || [],
            attachments: snapshot.attachments || [],
          },
          approverEmployeeNumber,
        );
        return;
      } catch (jsonErr) {
        console.error("倉庫マスタ変更申請の退避データのパース・反映に失敗しました:", jsonErr);
      }
    }
  }

  // REGISTER(または退避データ異常時のフォールバック): 内容は既にtemporary行として
  // 実在するため、ステータスのみ確定する
  await repo.updateStatus(
    reqParent.targetId,
    "active",
    approverEmployeeNumber,
    now,
  );
}

async function getTaskPreview({
  db,
  targetId,
}: TaskPreviewParams): Promise<TaskPreviewResult> {
  const repo = WarehousesRepository.fromDb(db);
  const warehouse = await repo.findById(targetId);
  return { targetName: warehouse ? warehouse.name : "不明な倉庫", previewData: warehouse };
}

async function getHistoryPreview({
  db,
  targetId,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const repo = WarehousesRepository.fromDb(db);
  const warehouse = await repo.findById(targetId);
  return {
    targetName: warehouse ? warehouse.name : "不明な倉庫",
    snapshotNew: warehouse,
    snapshotOld: null,
  };
}

export const warehousesAdapter: TargetAdapter = {
  applyApproved,
  getTaskPreview,
  getHistoryPreview,
};
