// quote-item-mapper.tsと同じ方針。purchase_request_itemsへのinsert行を組み立てる共通ロジック
// (create/update/CSVインポート/adapterの承認確定時UPDATE反映の4箇所で使う)。

export interface PurchaseRequisitionItemInput {
  itemId: string;
  quantity: number;
  estimatedUnitPrice: number;
  memo?: string | null;
  // Item9 Phase4以降(受注紐付け)で使う。今回(Phase3)は常にnull
  salesOrderItemId?: string | null;
  // Phase3フォローアップ: quote_itemsと同じマスタ選択/手入力両対応。itemNameはinputType="DIRECT"時のみ使う
  itemName?: string | null;
  inputType?: "MASTER" | "DIRECT" | null;
  // Phase3フォローアップ: 見積との項目整合(勘定科目はヘッダーへ移動、代わりにunitCode/taxCategoryCode/sortOrderを追加)
  unitCode?: string | null;
  taxCategoryCode?: string | null;
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode?: string | null;
  sortOrder?: number | null;
}

export function buildPurchaseRequisitionItemInsertRow(
  item: PurchaseRequisitionItemInput,
  requestId: string,
  index = 0,
) {
  return {
    id: crypto.randomUUID(),
    requestId,
    itemId: item.itemId,
    quantity: item.quantity,
    estimatedUnitPrice: item.estimatedUnitPrice,
    memo: item.memo || null,
    salesOrderItemId: item.salesOrderItemId || null,
    itemName: item.itemName || null,
    inputType: item.inputType || "MASTER",
    unitCode: item.unitCode || null,
    taxCategoryCode: item.taxCategoryCode || null,
    accountCode: item.accountCode || null,
    sortOrder: item.sortOrder ?? index,
  };
}
