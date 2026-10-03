/**
 * targetType = "master_locations" 用のTargetAdapter実装(Item5)。
 * locationsは登録済みidが既にDB上に"temporary"として実在する状態から申請が始まる
 * (quotesのDRAFTと同様の考え方)ため、REGISTER承認確定時は「新規作成」ではなく
 * 「既存temporary行のステータス確定」として扱う。UPDATE(既存有効データの変更申請)は
 * partnersと同じく、承認確定時に退避スナップショット(JSON)の内容を正式反映する。
 */
import { LocationsRepository } from "../../routes/master/locations/locations.repository";
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
  const repo = LocationsRepository.fromDb(db);
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
        // 💡 partners.adapter.tsと同じロジック: スナップショットの最終ステータス(例: 無効化申請
        // ならsuspended)をそのまま反映する。以前は無条件でstatus:"active"に固定していたため、
        // 無効化(suspend)申請を承認してもactiveに戻ってしまうバグ(無効化申請が効いていない)
        // になっていた。temporary/未指定の場合のみactiveへフォールバックする。
        const finalStatus =
          snapshot.status && snapshot.status !== "temporary"
            ? snapshot.status
            : "active";
        await repo.update(reqParent.targetId, {
          warehouseId: snapshot.warehouseId,
          name: snapshot.name,
          memo: snapshot.memo ?? null,
          status: finalStatus,
          updatedBy: approverEmployeeNumber,
          updatedAt: now,
        });
        return;
      } catch (jsonErr) {
        console.error(
          "ロケーションマスタ変更申請の退避データのパース・反映に失敗しました:",
          jsonErr,
        );
      }
    }
  }

  await repo.update(reqParent.targetId, {
    status: "active",
    updatedBy: approverEmployeeNumber,
    updatedAt: now,
  });
}

async function getTaskPreview({
  db,
  targetId,
}: TaskPreviewParams): Promise<TaskPreviewResult> {
  const repo = LocationsRepository.fromDb(db);
  const location = await repo.findById(targetId);
  return {
    targetName: location ? location.name : "不明なロケーション",
    previewData: location,
  };
}

async function getHistoryPreview({
  db,
  targetId,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const repo = LocationsRepository.fromDb(db);
  const location = await repo.findById(targetId);
  return {
    targetName: location ? location.name : "不明なロケーション",
    snapshotNew: location,
    snapshotOld: null,
  };
}

export const locationsAdapter: TargetAdapter = {
  applyApproved,
  getTaskPreview,
  getHistoryPreview,
};
