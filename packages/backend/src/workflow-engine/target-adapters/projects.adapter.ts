/**
 * BUG-097: targetType = "master_projects" 用の TargetAdapter(手本は units.adapter.ts)。
 * 新規登録は、会社設定の承認が ON の時に仮登録(temporary)として保存された行から申請が始まるため、
 * REGISTER の承認は「仮登録の行を有効(active)にする」。
 * UPDATE(有効なプロジェクトの変更申請)は、申請の前に今の行を temporary にロックし、変更後の内容は申請の退避データ(JSON)に持つ。
 * 承認の時に退避データの内容を反映する。
 */
import { ProjectsRepository } from "../../routes/master/projects/projects.repository";
import { WorkflowTasksRepository } from "../../routes/workflow/workflow-tasks/workflow-tasks.repository";
import { resolveEmployeeNumberByUserId } from "../../platform/repository/fallback-operator";
import { resolveMasterPreview } from "./master-pending-change";
import type {
  TargetAdapter,
  ApplyApprovedParams,
  TaskPreviewParams,
  TaskPreviewResult,
  HistoryPreviewParams,
  HistoryPreviewResult,
} from "./registry";

const toDateOrNull = (value: unknown): Date | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

async function applyApproved({ db, reqParent, userId, now }: ApplyApprovedParams): Promise<void> {
  const repo = ProjectsRepository.fromDb(db);
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(db, userId);

  if (reqParent.requestType === "UPDATE") {
    const contextRecord = await WorkflowTasksRepository.getApprovalContext(db, reqParent.id);
    if (contextRecord && contextRecord.generalMemo) {
      try {
        const snapshot = JSON.parse(contextRecord.generalMemo);
        // units.adapter.ts と同じ: 退避データの最終の状態を反映する。temporary・未指定なら active
        const finalStatus = snapshot.status && snapshot.status !== "temporary" ? snapshot.status : "active";
        await repo.update(reqParent.targetId, {
          name: snapshot.name,
          memo: snapshot.memo ?? null,
          startDate: toDateOrNull(snapshot.startDate),
          endDate: toDateOrNull(snapshot.endDate),
          status: finalStatus,
          updatedBy: approverEmployeeNumber,
          updatedAt: now,
        });
        return;
      } catch (jsonErr) {
        console.error("プロジェクトマスタ変更申請の退避データのパース・反映に失敗しました:", jsonErr);
      }
    }
  }

  // REGISTER(または退避データ異常時のフォールバック): 内容は仮登録の行として既にあるため、状態だけ有効にする
  await repo.update(reqParent.targetId, { status: "active", updatedBy: approverEmployeeNumber, updatedAt: now });
}

async function getTaskPreview({ db, requestId, targetId }: TaskPreviewParams): Promise<TaskPreviewResult> {
  const project = await ProjectsRepository.fromDb(db).findById(targetId);
  return {
    targetName: project ? project.name : "不明なプロジェクト",
    previewData: (await resolveMasterPreview(db, requestId, project)).newData,
  };
}

async function getHistoryPreview({
  db,
  requestId,
  targetId,
  requestType,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const project = await ProjectsRepository.fromDb(db).findById(targetId);
  // BUG-089: 変更申請は、退避した変更後の内容を新しい内容、今の行を変更前の内容として出す
  const pending = await resolveMasterPreview(db, requestId, project);
  return {
    targetName: project ? project.name : "不明なプロジェクト",
    snapshotNew: pending.newData,
    snapshotOld: requestType === "UPDATE" ? pending.oldData : null,
  };
}

export const projectsAdapter: TargetAdapter = {
  applyApproved,
  getTaskPreview,
  getHistoryPreview,
};
