// sales-order-item-mapper.ts/purchase-requisition-item-mapper.tsと同じ方針。order_itemsへの
// insert行を組み立てる共通ロジック(create/update/CSVインポート/adapterの承認確定時UPDATE反映の
// 4箇所で使う)。

export interface PurchaseOrderItemInput {
  itemId: string;
  itemName?: string | null;
  inputType?: "MASTER" | "DIRECT" | null;
  quantity: number;
  unitPrice: number;
  memo?: string | null;
  unitCode?: string | null;
  taxCategoryCode?: string | null;
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode?: string | null;
  // どの購買申請明細に由来するか(購買申請から発注を起票した場合のみ設定、表示用トレーサビリティ)
  purchaseRequestItemId?: string | null;
  // Item9: purchaseRequestItemId経由では辿れないケース(承認OFF時、購買申請を経由せず
  // 発注が直接受注に紐付けて起票される場合)のために独立して持たせる
  salesOrderItemId?: string | null;
}

export function buildPurchaseOrderItemInsertRow(
  item: PurchaseOrderItemInput,
  orderId: string,
  sortOrder: number,
) {
  return {
    id: crypto.randomUUID(),
    orderId,
    purchaseRequestItemId: item.purchaseRequestItemId || null,
    itemId: item.itemId || null,
    itemName: item.itemName || null,
    inputType: item.inputType || "MASTER",
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    memo: item.memo || null,
    salesOrderItemId: item.salesOrderItemId || null,
    unitCode: item.unitCode || null,
    taxCategoryCode: item.taxCategoryCode || null,
    accountCode: item.accountCode || null,
    sortOrder,
  };
}

// Item9 Phase5: 購買申請(purchase_request_items)の明細を発注明細の入力形へ変換する
// (購買申請からの発注作成用、sales-order-item-mapper.tsのbuildSalesOrderItemsFromQuoteと同型)。
// selections未指定(null)なら購買申請全体をコピーし、指定時はそのIDの明細のみ
// (数量は呼び出し元が上書き可)を対象にする。単価は購買申請の見積単価(estimatedUnitPrice)を
// そのまま初期値として引き継ぐ(発注確定前にユーザーが画面上で調整できる)。
export function buildPurchaseOrderItemsFromRequisition(
  requisitionItems: Array<{
    id: string;
    itemId: string | null;
    itemName: string | null;
    inputType: string | null;
    quantity: number;
    estimatedUnitPrice: number;
    memo: string | null;
    unitCode: string | null;
    taxCategoryCode: string | null;
    accountCode?: string | null;
    salesOrderItemId: string | null;
  }>,
  selections?: Array<{ requisitionItemId: string; quantity?: number }> | null,
): PurchaseOrderItemInput[] {
  const toItemInput = (
    ri: (typeof requisitionItems)[number],
    quantity: number,
  ): PurchaseOrderItemInput => ({
    itemId: ri.itemId || "",
    itemName: ri.itemName,
    inputType: ri.inputType as "MASTER" | "DIRECT" | null,
    quantity,
    unitPrice: ri.estimatedUnitPrice,
    memo: ri.memo,
    unitCode: ri.unitCode,
    taxCategoryCode: ri.taxCategoryCode,
    accountCode: ri.accountCode,
    purchaseRequestItemId: ri.id,
    salesOrderItemId: ri.salesOrderItemId,
  });

  if (!selections) {
    return requisitionItems.map((ri) => toItemInput(ri, ri.quantity));
  }

  const requisitionItemById = new Map(requisitionItems.map((ri) => [ri.id, ri]));
  const result: PurchaseOrderItemInput[] = [];
  for (const selection of selections) {
    const ri = requisitionItemById.get(selection.requisitionItemId);
    if (!ri) continue;
    result.push(toItemInput(ri, selection.quantity ?? ri.quantity));
  }
  return result;
}
