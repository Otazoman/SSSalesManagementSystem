/**
 * targetType = "master_structures" 用のTargetAdapter実装(Phase6: 商品構成マスタへの承認機能展開)。
 * 商品単価/単位等と同じく、品目構成は登録済みidが既にDB上に"temporary"として実在する状態から
 * 申請が始まる(quotesのDRAFTと同様の考え方)ため、REGISTER承認確定時は「新規作成」ではなく
 * 「既存temporary行のステータス確定」として扱う。UPDATE(既存有効データの変更申請)は
 * partnersと同じく、承認確定時に退避スナップショット(JSON)の内容を正式反映する。
 */
import { ItemStructuresRepository } from "../../routes/master/item-structures/item-structures.repository";
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
  const repo = ItemStructuresRepository.fromDb(db);
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(db, userId);

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
        await repo.update(reqParent.targetId, {
          quantityRequired: snapshot.quantityRequired,
          validFrom: snapshot.validFrom ? new Date(snapshot.validFrom) : undefined,
          validTo: snapshot.validTo ? new Date(snapshot.validTo) : null,
          memo: snapshot.memo ?? null,
          status: finalStatus,
          updatedBy: approverEmployeeNumber,
          updatedAt: now,
        });
        return;
      } catch (jsonErr) {
        console.error("品目構成マスタ変更申請の退避データのパース・反映に失敗しました:", jsonErr);
      }
    }
  }

  // REGISTER(または退避データ異常時のフォールバック): 内容は既にtemporary行として
  // 実在するため、ステータスのみ確定する
  await repo.updateStatus(reqParent.targetId, "active", approverEmployeeNumber, now);
}

async function getTaskPreview({
  db,
  targetId,
}: TaskPreviewParams): Promise<TaskPreviewResult> {
  const repo = ItemStructuresRepository.fromDb(db);
  const structure = await repo.findById(targetId);
  return {
    targetName: structure
      ? `${structure.parentItemId} → ${structure.childItemId} (REV ${structure.revision})`
      : "不明な品目構成",
    previewData: structure,
  };
}

async function getHistoryPreview({
  db,
  targetId,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const repo = ItemStructuresRepository.fromDb(db);
  const structure = await repo.findById(targetId);
  return {
    targetName: structure
      ? `${structure.parentItemId} → ${structure.childItemId} (REV ${structure.revision})`
      : "不明な品目構成",
    snapshotNew: structure,
    snapshotOld: null,
  };
}

export const itemStructuresAdapter: TargetAdapter = {
  applyApproved,
  getTaskPreview,
  getHistoryPreview,
};
