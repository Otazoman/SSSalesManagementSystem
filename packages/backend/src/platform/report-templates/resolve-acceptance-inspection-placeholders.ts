// 検収書発行(Item9): resolve-purchase-order-placeholders.tsと同じ方針だが、検収書固有の列
// (orderId=発注番号、receivedDate=入荷日)に合わせて複製している
import { computeQuoteAmountBreakdown } from "./compute-quote-amount-breakdown";
import { DEFAULT_TAX_RATE, formatDate, formatYen } from "./format-values";
import type { TaxRoundingMode } from "../tax/compute-tax-amounts";

export interface AcceptanceInspectionPlaceholderItem {
  [key: string]: string;
  no: string;
  name: string;
  qty: string;
  unit: string;
  unit_price: string;
  tax_rate: string;
  amount: string;
}

export interface ResolvedAcceptanceInspectionPlaceholders {
  values: Record<string, string>;
  items: AcceptanceInspectionPlaceholderItem[];
}

interface ReceiptHeaderLike {
  id: string;
  orderId: string | null;
  receivedDate: Date | number | string | null;
  memo: string | null;
}

interface ReceiptItemLike {
  itemName: string;
  quantity: number;
  unitPrice: number | null;
  unitCode: string | null;
  taxCategoryCode: string | null;
}

export function resolveAcceptanceInspectionPlaceholders(params: {
  header: ReceiptHeaderLike;
  partnerName: string;
  items: ReceiptItemLike[];
  staffName: string;
  systemConfig: Record<string, unknown>;
  taxCategoryRates: Map<string, number>;
  taxRoundingMode: TaxRoundingMode;
  unitNames: Map<string, string>;
}): ResolvedAcceptanceInspectionPlaceholders {
  const { header, partnerName, items, staffName, systemConfig, taxCategoryRates, unitNames } = params;

  const breakdownItems = items.map((i) => ({
    amount: (i.unitPrice ?? 0) * i.quantity,
    taxCategoryCode: i.taxCategoryCode,
  }));
  const { subtotalBeforeDiscount, discountTotal, breakdown } = computeQuoteAmountBreakdown(breakdownItems, taxCategoryRates, params.taxRoundingMode);
  const taxAmount = breakdown.rate10.tax + breakdown.rate8.tax + breakdown.rate0.tax;
  const totalAmount = subtotalBeforeDiscount + discountTotal + taxAmount;

  const resolvedItems: AcceptanceInspectionPlaceholderItem[] = items.map((item, index) => {
    const rate = item.taxCategoryCode
      ? (taxCategoryRates.get(item.taxCategoryCode) ?? DEFAULT_TAX_RATE)
      : DEFAULT_TAX_RATE;
    const unitPrice = item.unitPrice ?? 0;

    return {
      no: String(index + 1),
      name: item.itemName || "",
      qty: String(item.quantity),
      unit: item.unitCode ? (unitNames.get(item.unitCode) ?? item.unitCode) : "",
      unit_price: item.unitPrice !== null ? formatYen(unitPrice) : "",
      tax_rate: `${Math.round(rate * 100)}%`,
      amount: item.unitPrice !== null ? formatYen(unitPrice * item.quantity) : "",
    };
  });

  const values: Record<string, string> = {
    acceptance_no: header.id,
    received_date: formatDate(header.receivedDate),
    purchase_order_no: header.orderId || "",
    partner_name: partnerName,
    memo: header.memo || "",
    subtotal_before_discount: formatYen(subtotalBeforeDiscount),
    discount_total: formatYen(discountTotal),
    subtotal: formatYen(totalAmount - taxAmount),
    tax_amount: formatYen(taxAmount),
    total_amount: formatYen(totalAmount),
    company_name: String(systemConfig.company_name ?? ""),
    company_zip: String(systemConfig.company_zip ?? ""),
    company_address: String(systemConfig.company_address ?? ""),
    company_tel: String(systemConfig.company_tel ?? ""),
    company_invoice_no: String(systemConfig.company_invoice_registration_no ?? ""),
    sales_person_name: staffName,
    "tax_breakdown.rate10.excl": formatYen(breakdown.rate10.excl),
    "tax_breakdown.rate10.tax": formatYen(breakdown.rate10.tax),
    "tax_breakdown.rate8.excl": formatYen(breakdown.rate8.excl),
    "tax_breakdown.rate8.tax": formatYen(breakdown.rate8.tax),
    "tax_breakdown.rate0.excl": formatYen(breakdown.rate0.excl),
    "tax_breakdown.rate0.tax": formatYen(breakdown.rate0.tax),
  };

  return { values, items: resolvedItems };
}
