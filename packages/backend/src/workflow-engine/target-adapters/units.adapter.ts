/**
 * targetType = "master_units" 用のTargetAdapter実装(Item5)。
 * unitsは登録済みcodeが既にDB上に"temporary"として実在する状態から申請が始まる
 * (quotesのDRAFTと同様の考え方)ため、REGISTER承認確定時は「新規作成」ではなく
 * 「既存temporary行のステータス確定」として扱う。UPDATE(既存有効データの変更申請)は
 * partnersと同じく、事前にlive行をtemporaryへロックしてから承認申請が行われる前提で、
 * 承認確定時に退避スナップショット(JSON)の内容を正式反映する。
 */
import { UnitsRepository } from "../../routes/master/units/units.repository";
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
  const repo = UnitsRepository.fromDb(db);
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
        await repo.updateUnit(
          reqParent.targetId,
          { name: snapshot.name, status: finalStatus },
          approverEmployeeNumber,
          now,
        );
        return;
      } catch (jsonErr) {
        console.error("単位マスタ変更申請の退避データのパース・反映に失敗しました:", jsonErr);
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
  const repo = UnitsRepository.fromDb(db);
  const unit = await repo.findUnitByCode(targetId);
  return { targetName: unit ? unit.name : "不明な単位", previewData: unit };
}

async function getHistoryPreview({
  db,
  targetId,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const repo = UnitsRepository.fromDb(db);
  const unit = await repo.findUnitByCode(targetId);
  return {
    targetName: unit ? unit.name : "不明な単位",
    snapshotNew: unit,
    snapshotOld: null,
  };
}

export const unitsAdapter: TargetAdapter = {
  applyApproved,
  getTaskPreview,
  getHistoryPreview,
};
