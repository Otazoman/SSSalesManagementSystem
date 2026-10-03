import { signedAmount } from "../../../platform/documents/red-slip";

// BUG-042: 請求書(適格請求書)の消費税は「請求書ごと・税率ごとに1回」の端数処理にする(2026-09-29 ユーザー決定)。
// そのため、請求の合計・消費税(billing-crud.service.ts)と請求書 PDF の税率別の内訳(billing-pdf.service.ts)は、
// どちらもこの関数で作った明細(対象の売上の明細+手入力の明細)から計算する。
// 返品・値引・赤伝(訂正)の売上の明細は、金額が正で保存されているため、ここでマイナスにする。
export function buildBillingTaxLines(
  invoices: { id: string; documentType: string | null }[],
  invoiceItems: { salesInvoiceId: string; amount: number; taxCategoryCode: string | null }[],
  manualItems: { amount: number; taxCategoryCode?: string | null }[],
): { amount: number; taxCategoryCode: string | null }[] {
  const documentTypeOf = new Map(invoices.map((inv) => [inv.id, inv.documentType]));
  return [
    ...invoiceItems.map((item) => ({
      amount: signedAmount(documentTypeOf.get(item.salesInvoiceId), item.amount),
      taxCategoryCode: item.taxCategoryCode,
    })),
    ...manualItems.map((item) => ({ amount: item.amount, taxCategoryCode: item.taxCategoryCode ?? null })),
  ];
}
