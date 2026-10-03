/**
 * 担当者マスタで「メールで送る帳票」を選ぶ際の帳票種別(V-5)。
 * partner_contact_document_types / warehouse_contact_document_types の document_type の許容値。
 * DB側にCHECK制約は設けず(既存規約踏襲)、app層(このファイル)で型・valibot picklistを一元管理する。
 */
import * as v from "valibot";

// 取引先担当者(partner_contacts)向け。売上関連書類は内訳(sales_invoices.document_type)ごとに分ける
export const PARTNER_CONTACT_DOCUMENT_TYPES = [
  "quote",
  "sales_order",
  "delivery_note",
  "sales_invoice_sale",
  "sales_invoice_return",
  "sales_invoice_discount",
  "sales_invoice_correction",
  "billing",
  "purchase_order",
  "acceptance_inspection",
] as const;

export type PartnerContactDocumentType = (typeof PARTNER_CONTACT_DOCUMENT_TYPES)[number];

export const partnerContactDocumentTypeSchema = v.picklist(PARTNER_CONTACT_DOCUMENT_TYPES);

// 倉庫担当者(warehouse_contacts)向け
export const WAREHOUSE_CONTACT_DOCUMENT_TYPES = ["shipment_instruction", "receipt_instruction"] as const;

export type WarehouseContactDocumentType = (typeof WAREHOUSE_CONTACT_DOCUMENT_TYPES)[number];

export const warehouseContactDocumentTypeSchema = v.picklist(WAREHOUSE_CONTACT_DOCUMENT_TYPES);

// 重複を除き、定義順(画面・CSVの表示順)に並べる。定義にないキーは除く
export function normalizeDocumentTypes<T extends string>(all: readonly T[], selected: readonly string[]): T[] {
  const set = new Set(selected);
  return all.filter((key) => set.has(key));
}

// sales_invoices.document_type(SALE/RETURN/DISCOUNT/CORRECTION)→帳票種別。未知の値は売上(SALE)扱い
const SALES_INVOICE_DOCUMENT_TYPE_MAP: Record<string, PartnerContactDocumentType> = {
  SALE: "sales_invoice_sale",
  RETURN: "sales_invoice_return",
  DISCOUNT: "sales_invoice_discount",
  CORRECTION: "sales_invoice_correction",
};

export function salesInvoiceContactDocumentType(
  invoiceDocumentType: string | null | undefined,
): PartnerContactDocumentType {
  return SALES_INVOICE_DOCUMENT_TYPE_MAP[invoiceDocumentType ?? "SALE"] ?? "sales_invoice_sale";
}
