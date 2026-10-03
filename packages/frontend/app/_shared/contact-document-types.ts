/**
 * 担当者マスタで「メールで送る帳票」を選ぶ際の帳票種別と表示名(V-5)。
 * キーはバックエンドの backend/src/constants/contact-document-types.ts と同じ。表示名は用語集(docs/glossary.md)に従う。
 */

export interface DocumentTypeOption {
  value: string;
  label: string;
}

/** 取引先担当者向け。売上関連書類は内訳(売上/返品/値引/赤伝(訂正))ごとに選べる */
export const PARTNER_CONTACT_DOCUMENT_TYPE_OPTIONS: DocumentTypeOption[] = [
  { value: "quote", label: "見積書" },
  { value: "sales_order", label: "注文請書" },
  { value: "delivery_note", label: "納品書" },
  { value: "sales_invoice_sale", label: "売上関連書類(売上)" },
  { value: "sales_invoice_return", label: "売上関連書類(返品)" },
  { value: "sales_invoice_discount", label: "売上関連書類(値引)" },
  { value: "sales_invoice_correction", label: "売上関連書類(赤伝(訂正))" },
  { value: "billing", label: "請求書" },
  { value: "purchase_order", label: "発注書" },
  { value: "acceptance_inspection", label: "検収書" },
];

/** 倉庫担当者向け */
export const WAREHOUSE_CONTACT_DOCUMENT_TYPE_OPTIONS: DocumentTypeOption[] = [
  { value: "shipment_instruction", label: "出荷指示書" },
  { value: "receipt_instruction", label: "入荷指示書" },
];

/** 売上関連書類の内訳(SALE/RETURN/DISCOUNT/CORRECTION)→帳票種別のキー */
export function salesInvoiceContactDocumentType(documentType: string): string {
  return `sales_invoice_${documentType.toLowerCase()}`;
}

/**
 * 担当者の候補を、その帳票を送る設定のものだけに絞る。
 * documentTypes が無い担当者(旧API)は、絞り込まずに候補に含める(バックエンドが最終判定する)。
 */
export function filterContactsByDocumentType<
  T extends { documentTypes?: string[] },
>(contacts: readonly T[], documentType: string): T[] {
  return contacts.filter(
    (c) => !c.documentTypes || c.documentTypes.includes(documentType),
  );
}

/** 一覧などに出す短い表示(すべて=「すべての帳票」、なし=「なし」、それ以外は表示名を「、」でつなぐ) */
export function summarizeDocumentTypes(
  selected: readonly string[] | undefined,
  options: readonly DocumentTypeOption[],
): string {
  const values = (selected ?? []).filter((v) =>
    options.some((o) => o.value === v),
  );
  if (values.length === 0) return "なし";
  if (values.length === options.length) return "すべての帳票";
  return options
    .filter((o) => values.includes(o.value))
    .map((o) => o.label)
    .join("、");
}
