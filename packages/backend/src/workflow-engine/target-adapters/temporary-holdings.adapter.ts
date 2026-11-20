/**
 * REQ-011(2): targetType = "inventory_temporary_holdings"(一時保管の受入・払出・調整。動き1件ごと)用の TargetAdapter。
 * 承認で動きを確定し、台帳の数量・状態を確定の動きの合計で計算し直す。差戻し・取下げで差戻し(台帳の数量は変えない)。
 * 金額は 0(金額の範囲が 0 を含む承認フローが使われる)。台帳を読み直して書くため、承認の書き込みはその場で行う。
 */
import { TemporaryHoldingsRepository } from "../../routes/inventory/temporary-holdings/temporary-holdings.repository";
import { confirmHoldingMovement } from "../../routes/inventory/temporary-holdings/temporary-holdings.ledger";
import { resolveEmployeeNumberByUserId } from "../../platform/repository/fallback-operator";
import type {
  TargetAdapter,
  ApplyApprovedParams,
  TaskPreviewParams,
  TaskPreviewResult,
  HistoryPreviewParams,
  HistoryPreviewResult,
} from "./registry";

async function loadPreview(db: any, movementId: string) {
  const repo = TemporaryHoldingsRepository.fromDb(db);
  const movement = await repo.findMovementById(movementId);
  if (!movement) return null;
  const holding = await repo.findById(movement.holdingId);
  return {
    targetName: `一時保管[${movement.holdingId}] ${holding?.itemName ?? ""}`.trim(),
    data: {
      ...movement,
      category: holding?.category ?? null,
      itemName: holding?.itemName ?? null,
      spec: holding?.spec ?? null,
      unitName: holding?.unitName ?? null,
      warehouseId: holding?.warehouseId ?? null,
      locationId: holding?.locationId ?? null,
      partnerId: holding?.partnerId ?? null,
      holdingSourceType: holding?.sourceType ?? null,
      holdingSourceId: holding?.sourceId ?? null,
      currentQuantity: holding?.quantity ?? null,
    },
  };
}

export const temporaryHoldingsAdapter: TargetAdapter = {
  requiresImmediateWrites: true,
  async resolveAmount() {
    return 0;
  },
  async applyApproved({ db, reqParent, userId, now }: ApplyApprovedParams) {
    const operator = await resolveEmployeeNumberByUserId(db, userId);
    await confirmHoldingMovement(TemporaryHoldingsRepository.fromDb(db), reqParent.targetId, operator, now);
  },
  async applyRemanded({ db, reqParent, now }: ApplyApprovedParams) {
    const repo = TemporaryHoldingsRepository.fromDb(db);
    if (!(await repo.findMovementById(reqParent.targetId))) return;
    await repo.updateMovement(reqParent.targetId, { approvalStatus: "REMANDED", updatedAt: now });
  },
  async getTaskPreview({ db, targetId }: TaskPreviewParams): Promise<TaskPreviewResult> {
    const live = await loadPreview(db, targetId);
    return live ? { targetName: live.targetName, previewData: live.data } : { targetName: "不明な一時保管", previewData: null };
  },
  async getHistoryPreview({ db, targetId }: HistoryPreviewParams): Promise<HistoryPreviewResult> {
    const live = await loadPreview(db, targetId);
    return { targetName: live?.targetName ?? "不明な一時保管", snapshotNew: live?.data ?? null, snapshotOld: null };
  },
  async resolveEditPath() {
    return "/inventory/audit";
  },
};
