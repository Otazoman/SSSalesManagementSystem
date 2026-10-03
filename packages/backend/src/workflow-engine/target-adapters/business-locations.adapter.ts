/**
 * targetType = "master_business_locations" 用のTargetAdapter実装(2026-09-23新設)。
 * warehouses.adapter.tsと同じ方針: 登録済みidが既にDB上に"temporary"として実在する状態から
 * 申請が始まるため、REGISTER承認確定時は「新規作成」ではなく「既存temporary行のステータス確定」
 * として扱う。UPDATE(既存有効データの変更申請)は、事前にlive行をtemporaryへロックしてから
 * 承認申請が行われる前提で、承認確定時に退避スナップショット(JSON)の内容を正式反映する。
 */
import { BusinessLocationsRepository } from "../../routes/master/business-locations/business-locations.repository";
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
  const repo = BusinessLocationsRepository.fromDb(db);
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
        await repo.updateBusinessLocation(
          reqParent.targetId,
          {
            id: reqParent.targetId,
            name: snapshot.name,
            postalCode: snapshot.postalCode ?? null,
            address: snapshot.address ?? null,
            phoneNumber: snapshot.phoneNumber ?? null,
            status: finalStatus,
            memo: snapshot.memo ?? null,
          },
          approverEmployeeNumber,
        );
        return;
      } catch (jsonErr) {
        console.error("営業拠点マスタ変更申請の退避データのパース・反映に失敗しました:", jsonErr);
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
  const repo = BusinessLocationsRepository.fromDb(db);
  const businessLocation = await repo.findById(targetId);
  return {
    targetName: businessLocation ? businessLocation.name : "不明な営業拠点",
    previewData: businessLocation,
  };
}

async function getHistoryPreview({
  db,
  targetId,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const repo = BusinessLocationsRepository.fromDb(db);
  const businessLocation = await repo.findById(targetId);
  return {
    targetName: businessLocation ? businessLocation.name : "不明な営業拠点",
    snapshotNew: businessLocation,
    snapshotOld: null,
  };
}

export const businessLocationsAdapter: TargetAdapter = {
  applyApproved,
  getTaskPreview,
  getHistoryPreview,
};
