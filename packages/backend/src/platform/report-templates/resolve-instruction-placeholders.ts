// 出荷指示書/入荷指示書/納品書共通: generate-instruction-pdf.tsが受け取るInstructionPdfDataを
// layout.json駆動レンダラー向けのプレースホルダー値へ変換する。3帳票ともデータ構造が同一
// (InstructionPdfData)のため、resolve-quote-placeholders.tsと異なり1関数で共通化する。
import { InstructionPdfData } from "./generate-instruction-pdf";

export interface InstructionPlaceholderItem {
  [key: string]: string;
  no: string;
  item_code: string;
  item_name: string;
  lot_number: string;
  quantity: string;
  unit: string;
  remark: string;
  // Item7残課題7追加: 納品書のみ使用(受注紐づけ明細以外は空文字)
  unit_price: string;
  amount: string;
}

export interface ResolvedInstructionPlaceholders {
  values: Record<string, string>;
  items: InstructionPlaceholderItem[];
}

export function resolveInstructionPlaceholders(
  data: InstructionPdfData,
): ResolvedInstructionPlaceholders {
  const items: InstructionPlaceholderItem[] = data.items.map((item, index) => ({
    no: String(index + 1),
    item_code: item.itemId,
    item_name: item.itemName,
    lot_number: item.lotNumber,
    quantity: String(item.quantity),
    unit: item.unit || "",
    remark: item.remark || "",
    unit_price: item.unitPrice != null ? String(item.unitPrice) : "",
    amount: item.amount != null ? String(item.amount) : "",
  }));

  const values: Record<string, string> = {
    document_title: data.documentTitle,
    code: data.code,
    date: data.date,
    recipient_label: data.recipientLabel,
    recipient_name: data.recipientName,
    recipient_address: data.recipientAddress || "",
    recipient_tel: data.recipientTel || "",
    partner_label: data.partnerLabel,
    partner_name: data.partnerName,
    scheduled_date_label: data.scheduledDateLabel,
    scheduled_date: data.scheduledDate,
    company_name: data.companyName,
    company_zip: data.companyZip || "",
    company_address: data.companyAddress,
    company_tel: data.companyTel,
    company_fax: data.companyFax,
    memo: data.memo || "",
    staff_name: data.staffName || "",
    delivery_addressee: data.deliveryAddressee || "",
    delivery_location: data.deliveryLocation || "",
    delivery_phone: data.deliveryPhone || "",
    // Item7残課題7追加: 納品書のみ使用(受注紐づけの無い単独出庫では空文字)
    sales_order_id: data.salesOrderId || "",
  };

  return { values, items };
}
