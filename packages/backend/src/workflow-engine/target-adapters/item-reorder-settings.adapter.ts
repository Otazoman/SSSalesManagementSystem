/**
 * BUG-098: targetType = "master_item_reorder_settings" 用の TargetAdapter(手本は units.adapter.ts)。
 * 新規登録は、会社設定の承認が ON の時に仮登録(temporary)として保存された行から申請が始まるため、
 * REGISTER の承認は「仮登録の行を有効(active)にする」。仮登録の行は承認されるまで発注点の提案に使わない。
 * UPDATE(有効な設定の変更申請)は、申請の前に今の行を temporary にロックし、変更後の内容は申請の退避データ(JSON)に持つ。
 * 承認の時に退避データの内容を反映する。
 */
import { ItemReorderSettingsRepository } from "../../routes/master/item-reorder-settings/item-reorder-settings.repository";
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

async function applyApproved({ db, reqParent, userId, now }: ApplyApprovedParams): Promise<void> {
  const repo = ItemReorderSettingsRepository.fromDb(db);
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(db, userId);

  if (reqParent.requestType === "UPDATE") {
    const contextRecord = await WorkflowTasksRepository.getApprovalContext(db, reqParent.id);
    const current = await repo.findById(reqParent.targetId);
    if (contextRecord && contextRecord.generalMemo && current) {
      try {
        const snapshot = JSON.parse(contextRecord.generalMemo);
        const finalStatus = snapshot.status && snapshot.status !== "temporary" ? snapshot.status : "active";
        await repo.update(
          reqParent.targetId,
          {
            itemId: snapshot.itemId ?? current.itemId,
            warehouseId: snapshot.warehouseId ?? current.warehouseId,
            reorderPoint: Number(snapshot.reorderPoint ?? current.reorderPoint),
            safetyStock: Number(snapshot.safetyStock ?? current.safetyStock),
            memo: snapshot.memo ?? null,
            status: finalStatus,
          },
          approverEmployeeNumber,
          now,
        );
        return;
      } catch (err) {
        console.error("発注点/安全在庫マスタ変更申請の退避データのパース・反映に失敗しました:", err);
      }
    }
  }

  // REGISTER(または退避データ異常時のフォールバック): 内容は仮登録の行として既にあるため、状態だけ有効にする
  await repo.updateStatus(reqParent.targetId, "active", approverEmployeeNumber, now);
}

async function loadTarget(db: any, targetId: string) {
  const found = await ItemReorderSettingsRepository.fromDb(db).findWithNamesById(targetId);
  if (!found) return { name: "不明な発注点/安全在庫設定", row: null };
  const item = found.itemName ?? found.setting.itemId;
  const warehouse = found.warehouseName ?? found.setting.warehouseId;
  return { name: `${item} / ${warehouse}`, row: found.setting };
}

async function getTaskPreview({ db, requestId, targetId }: TaskPreviewParams): Promise<TaskPreviewResult> {
  const { name, row } = await loadTarget(db, targetId);
  return { targetName: name, previewData: (await resolveMasterPreview(db, requestId, row)).newData };
}

async function getHistoryPreview({
  db,
  requestId,
  targetId,
  requestType,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const { name, row } = await loadTarget(db, targetId);
  // BUG-089: 変更申請は、退避した変更後の内容を新しい内容、今の行を変更前の内容として出す
  const pending = await resolveMasterPreview(db, requestId, row);
  return {
    targetName: name,
    snapshotNew: pending.newData,
    snapshotOld: requestType === "UPDATE" ? pending.oldData : null,
  };
}

export const itemReorderSettingsAdapter: TargetAdapter = {
  applyApproved,
  getTaskPreview,
  getHistoryPreview,
};
