/**
 * targetType = "inventory_audit" 用のTargetAdapter実装(Item6 Phase6-3: 棚卸)。
 * receipts/shipmentsが共有する"inventory_stock"とは別targetTypeとして独立させている
 * (screens.tsの既存"inventory_audit"リソースにそのまま対応させるため)。
 *
 * 対象の棚卸は既にUNAPPROVED行としてDB上に実在する状態から申請が始まるため、
 * REGISTER承認確定時は「新規作成」ではなく「既存UNAPPROVED行のステータス確定
 * + stocks/stock_transactionsへの反映」として扱う(inventory-stock.adapter.tsと同じ設計)。
 */
import { AuditsRepository } from "../../routes/inventory/audits/audits.repository";
import { StocksService } from "../../routes/inventory/stocks/stocks.service";
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
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(db, userId);
  const auditsRepo = AuditsRepository.fromDb(db);
  const audit = await auditsRepo.findById(reqParent.targetId);
  if (!audit) {
    console.error(
      `棚卸承認確定: targetId=${reqParent.targetId} に対応する棚卸レコードが見つかりませんでした`,
    );
    return;
  }

  const stocksService = StocksService.fromDb(db);
  await stocksService.applyAdjustment(
    {
      itemId: audit.itemId,
      warehouseId: audit.warehouseId,
      locationId: audit.locationId,
      lotNumber: audit.lotNumber,
      accountCode: audit.accountCode,
      qualityStatus: audit.qualityStatus,
      differenceQuantity: audit.differenceQuantity,
    },
    reqParent.targetId,
    approverEmployeeNumber,
    now,
  );
  await auditsRepo.updateStatus(reqParent.targetId, "APPROVED");
}

// 差戻し確定時(承認者によるREMAND)/取り下げ確定時(申請者によるCANCEL)の共通ハンドラ。
// inventory-stock.adapter.tsと同じくaction("REMAND"|"CANCEL")で区別する。
async function applyRemanded({
  db,
  reqParent,
  action,
}: ApplyApprovedParams): Promise<void> {
  const status = action === "CANCEL" ? "CANCELED" : "REMANDED";
  const auditsRepo = AuditsRepository.fromDb(db);
  await auditsRepo.updateStatus(reqParent.targetId, status);
}

async function getTaskPreview({
  db,
  targetId,
}: TaskPreviewParams): Promise<TaskPreviewResult> {
  const auditsRepo = AuditsRepository.fromDb(db);
  const audit = await auditsRepo.findById(targetId);
  if (!audit) {
    return { targetName: "不明な棚卸", previewData: null };
  }
  return { targetName: `棚卸[${targetId}]`, previewData: { audit } };
}

async function getHistoryPreview({
  db,
  targetId,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const preview = await getTaskPreview({ db, requestId: "", targetId });
  return {
    targetName: preview.targetName,
    snapshotNew: preview.previewData,
    snapshotOld: null,
  };
}

export const inventoryAuditAdapter: TargetAdapter = {
  // BUG-049: 書き込みの結果を使う処理(書き込み直後の再集計など)や R2 の後始末を含むため、承認の書き込みとはまとめず、先に実行する
  requiresImmediateWrites: true,
  applyApproved,
  applyRemanded,
  getTaskPreview,
  getHistoryPreview,
};
