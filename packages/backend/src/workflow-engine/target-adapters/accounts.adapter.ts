/**
 * targetType = "master_accounts" 用のTargetAdapter実装(残り6マスタへの承認機能展開)。
 * unitsと同じく、accountsは登録済みcodeが既にDB上に"temporary"として実在する状態から
 * 申請が始まるため、REGISTER承認確定時は「新規作成」ではなく「既存temporary行の
 * ステータス確定」として扱う。UPDATE(既存有効データの変更申請)は、事前にlive行を
 * temporaryへロックしてから承認申請が行われる前提で、承認確定時に退避スナップショット
 * (JSON)の内容を正式反映する。
 */
import { AccountsRepository } from "../../routes/master/accounts/accounts.repository";
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
  const repo = AccountsRepository.fromDb(db);
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
        await repo.update(reqParent.targetId, {
          name: snapshot.name,
          externalMappingCode: snapshot.externalMappingCode ?? null,
          memo: snapshot.memo ?? null,
          status: finalStatus,
          updatedBy: approverEmployeeNumber,
          updatedAt: now,
        });
        return;
      } catch (jsonErr) {
        console.error("勘定科目マスタ変更申請の退避データのパース・反映に失敗しました:", jsonErr);
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
  const repo = AccountsRepository.fromDb(db);
  const account = await repo.findByCode(targetId);
  return { targetName: account ? account.name : "不明な科目", previewData: account };
}

async function getHistoryPreview({
  db,
  targetId,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const repo = AccountsRepository.fromDb(db);
  const account = await repo.findByCode(targetId);
  return {
    targetName: account ? account.name : "不明な科目",
    snapshotNew: account,
    snapshotOld: null,
  };
}

export const accountsAdapter: TargetAdapter = {
  applyApproved,
  getTaskPreview,
  getHistoryPreview,
};
