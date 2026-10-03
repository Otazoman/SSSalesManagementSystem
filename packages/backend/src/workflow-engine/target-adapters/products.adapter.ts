/**
 * targetType = "master_products" 用のTargetAdapter実装(残り6マスタへの承認機能展開)。
 * 商品は登録済みidが既にDB上に"temporary"として実在する状態から申請が始まる
 * (quotesのDRAFTと同様の考え方)ため、REGISTER承認確定時は「新規作成」ではなく
 * 「既存temporary行のステータス確定」として扱う。UPDATE(既存有効データの変更申請)は
 * partnersと同じく、承認確定時に退避スナップショット(JSON)の内容を正式反映する。
 * 商品の更新処理(ProductsRepository.updateProduct)は標準売単価/仕入単価(itemPrices)や
 * 添付ファイルのクリーンアップも一括で行うため、R2バインディングが必要(Contextを使う)。
 * Contextが渡せない呼び出し元では、ステータスのみの反映にフォールバックする。
 */
import { ProductsRepository } from "../../routes/master/products/products.repository";
import { UpdateProductInput } from "../../routes/master/products/products.schema";
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
  c,
}: ApplyApprovedParams): Promise<void> {
  const repo = ProductsRepository.fromDb(db);
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

        if (c?.env?.PRODUCTS_BUCKET) {
          const updateInput: UpdateProductInput = {
            name: snapshot.name,
            isPurchased: !!snapshot.isPurchased,
            isSales: !!snapshot.isSales,
            isService: !!snapshot.isService,
            baseUnitCode: snapshot.baseUnitCode || "pcs",
            taxCategoryCode: snapshot.taxCategoryCode || "TAX_10",
            productBarcode: snapshot.productBarcode ?? null,
            accountCode: snapshot.accountCode ?? null,
            supplierId: snapshot.supplierId ?? null,
            supplierPartNumber: snapshot.supplierPartNumber ?? null,
            status: finalStatus,
            memo: snapshot.memo ?? null,
            standardSalesPrice: snapshot.standardSalesPrice || 0,
            standardPurchasePrice: snapshot.standardPurchasePrice || 0,
            attachments: snapshot.attachments || [],
          };
          await repo.updateProduct(
            reqParent.targetId,
            updateInput,
            approverEmployeeNumber,
            now,
            c.env.PRODUCTS_BUCKET,
          );
        } else {
          await repo.updateStatus(
            reqParent.targetId,
            finalStatus,
            approverEmployeeNumber,
            now,
          );
        }
        return;
      } catch (jsonErr) {
        console.error("品目マスタ変更申請の退避データのパース・反映に失敗しました:", jsonErr);
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
  const repo = ProductsRepository.fromDb(db);
  const product = await repo.findProductById(targetId);
  return { targetName: product ? product.name : "不明な品目", previewData: product };
}

async function getHistoryPreview({
  db,
  targetId,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const repo = ProductsRepository.fromDb(db);
  const product = await repo.findProductById(targetId);
  return {
    targetName: product ? product.name : "不明な品目",
    snapshotNew: product,
    snapshotOld: null,
  };
}

export const productsAdapter: TargetAdapter = {
  // BUG-049: 書き込みの結果を使う処理(書き込み直後の再集計など)や R2 の後始末を含むため、承認の書き込みとはまとめず、先に実行する
  requiresImmediateWrites: true,
  applyApproved,
  getTaskPreview,
  getHistoryPreview,
};
