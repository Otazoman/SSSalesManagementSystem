// Item7: salesOrderItemsへのinsert行を組み立てる共通ロジック。
// quote-item-mapper.tsと同じ理由(createOrder/updateOrder・bulkImportCsv・
// sales-orders.adapter.tsの3箇所での重複を防ぐ)で集約する。

export interface SalesOrderItemInput {
  // CSV取込で明細ID(lineId)を指定した場合はその値を明細のIDにする(空なら自動採番)
  lineId?: string | null;
  itemId: string;
  itemName?: string | null;
  inputType?: string | null;
  quantity: number;
  unitPrice: number;
  costPrice?: number | null;
  memo?: string | null;
  unitCode?: string | null;
  taxCategoryCode?: string | null;
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode?: string | null;
  sourceQuoteItemId?: string | null;
  // Item7残課題2-5: 倉庫×数量の内訳リクエスト(JSON配列、フロントから文字列で受け取る)。
  // 未指定なら引当実行時に自動でFIFO割当する
  warehouseAllocationRequest?: string | null;
}

export function buildSalesOrderItemInsertRow(
  item: SalesOrderItemInput,
  salesOrderId: string,
  sortOrder: number,
) {
  return {
    id: item.lineId || crypto.randomUUID(),
    salesOrderId,
    sourceQuoteItemId: item.sourceQuoteItemId || null,
    itemId: item.itemId,
    itemName: item.itemName || null,
    inputType: item.inputType || null,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    costPrice: item.costPrice || null,
    amount: item.quantity * item.unitPrice,
    sortOrder,
    memo: item.memo || null,
    unitCode: item.unitCode || null,
    taxCategoryCode: item.taxCategoryCode || null,
    accountCode: item.accountCode || null,
    warehouseAllocationRequest: item.warehouseAllocationRequest || null,
  };
}

// Item7: 見積(quoteItems)の明細を受注明細の入力形へ変換する(見積からの受注作成用)。
// selectedIds未指定(null)なら見積全体をコピーし(伝票分割「上位伝票単位」)、
// 指定時はそのIDの明細のみ(数量は呼び出し元が上書き可)を対象にする(「明細単位・一部数量」)。
// いずれの場合も金額・単価は見積明細のスナップショットをそのまま引き継ぐ(値引き等も含む)。
export function buildSalesOrderItemsFromQuote(
  quoteItems: Array<{
    id: string;
    itemId: string | null;
    itemName: string | null;
    inputType: string | null;
    quantity: number;
    unitPrice: number;
    costPrice: number | null;
    memo: string | null;
    unitCode: string | null;
    taxCategoryCode: string | null;
  }>,
  selections?: Array<{ quoteItemId: string; quantity?: number }> | null,
): SalesOrderItemInput[] {
  if (!selections) {
    return quoteItems.map((qi) => ({
      itemId: qi.itemId || "",
      itemName: qi.itemName,
      inputType: qi.inputType,
      quantity: qi.quantity,
      unitPrice: qi.unitPrice,
      costPrice: qi.costPrice,
      memo: qi.memo,
      unitCode: qi.unitCode,
      taxCategoryCode: qi.taxCategoryCode,
      sourceQuoteItemId: qi.id,
    }));
  }

  const quoteItemById = new Map(quoteItems.map((qi) => [qi.id, qi]));
  const result: SalesOrderItemInput[] = [];
  for (const selection of selections) {
    const qi = quoteItemById.get(selection.quoteItemId);
    if (!qi) continue;
    result.push({
      itemId: qi.itemId || "",
      itemName: qi.itemName,
      inputType: qi.inputType,
      quantity: selection.quantity ?? qi.quantity,
      unitPrice: qi.unitPrice,
      costPrice: qi.costPrice,
      memo: qi.memo,
      unitCode: qi.unitCode,
      taxCategoryCode: qi.taxCategoryCode,
      sourceQuoteItemId: qi.id,
    });
  }
  return result;
}
