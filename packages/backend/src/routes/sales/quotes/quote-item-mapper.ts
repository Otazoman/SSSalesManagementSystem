// Item4-f: quoteItemsへのinsert行を組み立てる共通ロジック。
// createQuote/updateQuote(quote-crud.service.ts)・bulkImportCsv(quote-csv.service.ts)・
// quotes.adapter.ts(承認確定時のUPDATE反映)の4箇所でほぼ同一の項目一覧が重複していたため集約。

export interface QuoteItemInput {
  itemId: string;
  itemName?: string | null;
  inputType?: string | null;
  quantity: number;
  unitPrice: number;
  costPrice?: number | null;
  memo?: string | null;
  unitCode?: string | null;
  taxCategoryCode?: string | null;
}

export function buildQuoteItemInsertRow(
  item: QuoteItemInput,
  quoteId: string,
  sortOrder: number,
) {
  return {
    id: crypto.randomUUID(),
    quoteId,
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
  };
}
