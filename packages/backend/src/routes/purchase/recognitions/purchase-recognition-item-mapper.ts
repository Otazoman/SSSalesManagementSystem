// Item10: sales-invoice-item-mapper.tsと同じ方針。create/update/CSVインポート/承認確定反映の
// 複数箇所で重複しがちな明細insert行の組み立てを集約する。

export interface PurchaseRecognitionItemInput {
  itemId: string;
  itemName?: string | null;
  inputType?: string | null;
  sourceOrderItemId?: string | null;
  quantity: number;
  unitPrice: number;
  memo?: string | null;
  unitCode?: string | null;
  taxCategoryCode?: string | null;
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode?: string | null;
}

export function buildPurchaseRecognitionItemInsertRow(
  item: PurchaseRecognitionItemInput,
  purchaseRecognitionId: string,
  sortOrder: number,
) {
  return {
    id: crypto.randomUUID(),
    purchaseRecognitionId,
    sourceOrderItemId: item.sourceOrderItemId || null,
    itemId: item.itemId,
    itemName: item.itemName || null,
    inputType: item.inputType || null,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    amount: item.quantity * item.unitPrice,
    sortOrder,
    memo: item.memo || null,
    unitCode: item.unitCode || null,
    taxCategoryCode: item.taxCategoryCode || null,
    accountCode: item.accountCode || null,
  };
}
