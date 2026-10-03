/**
 * targetType = "master_prices" 用のTargetAdapter実装(残り6マスタへの承認機能展開)。
 * 商品単価は登録済みidが既にDB上に"temporary"として実在する状態から申請が始まる
 * (quotesのDRAFTと同様の考え方)ため、REGISTER承認確定時は「新規作成」ではなく
 * 「既存temporary行のステータス確定」として扱う。UPDATE(既存有効データの変更申請)は
 * partnersと同じく、承認確定時に退避スナップショット(JSON)の内容を正式反映する。
 * 以前この商品単価マスタには`masterApprovalRequests`とは無関係の独自承認機構
 * (POST /approve, action:approve/reject)が存在したが、ユーザー指示によりこの標準
 * target-adapterパターンへ置き換えた(旧ルートは削除済み)。
 */
import { ProductPriceRepository } from "../../routes/master/product-prices/product-price.repository";
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
  const repo = ProductPriceRepository.fromDb(db);
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(db, userId);

  if (reqParent.requestType === "UPDATE") {
    const contextRecord = await WorkflowTasksRepository.getApprovalContext(
      db,
      reqParent.id,
    );
    if (contextRecord && contextRecord.generalMemo) {
      try {
        const snapshot = JSON.parse(contextRecord.generalMemo);
        // 💡 partners.adapter.tsと同じロジック: スナップショットの最終ステータス
        // (無効化申請ならsuspended)をそのまま反映する。temporary/未指定の場合のみ
        // activeへフォールバックする。
        const finalStatus =
          snapshot.status && snapshot.status !== "temporary"
            ? snapshot.status
            : "active";
        await repo.updatePrice(reqParent.targetId, {
          minQuantity: snapshot.minQuantity,
          unitPrice: snapshot.unitPrice,
          unitCode: snapshot.unitCode,
          status: finalStatus,
          updatedBy: approverEmployeeNumber,
          updatedAt: now,
        });
        return;
      } catch (jsonErr) {
        console.error(
          "品目単価マスタ変更申請の退避データのパース・反映に失敗しました:",
          jsonErr,
        );
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
  const repo = ProductPriceRepository.fromDb(db);
  const price = await repo.findPriceById(targetId);
  return {
    targetName: price ? `${price.itemId} / ${price.priceType}` : "不明な単価設定",
    previewData: price,
  };
}

async function getHistoryPreview({
  db,
  targetId,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const repo = ProductPriceRepository.fromDb(db);
  const price = await repo.findPriceById(targetId);
  return {
    targetName: price ? `${price.itemId} / ${price.priceType}` : "不明な単価設定",
    snapshotNew: price,
    snapshotOld: null,
  };
}

export const productPricesAdapter: TargetAdapter = {
  applyApproved,
  getTaskPreview,
  getHistoryPreview,
};
