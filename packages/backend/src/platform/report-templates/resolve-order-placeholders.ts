// Item7: salesOrders/salesOrderItemsのデータをlayout.json駆動レンダラー向けのプレースホルダー値へ
// 変換する。resolve-quote-placeholders.tsと同じ方針(確定値はDBの保存値を正とし、税率別内訳のみ
// 明細から都度計算する)。見積用のcompute-quote-amount-breakdown.tsは受注固有の項目に依存しない
// 汎用実装のためそのまま流用する。
import { computeQuoteAmountBreakdown } from "./compute-quote-amount-breakdown";
import { DEFAULT_TAX_RATE, formatDate, formatYen } from "./format-values";
import type { TaxRoundingMode } from "../tax/compute-tax-amounts";

export interface OrderPlaceholderItem {
  [key: string]: string;
  no: string;
  name: string;
  qty: string;
  unit: string;
  unit_price: string;
  tax_rate: string;
  amount: string;
}

export interface ResolvedOrderPlaceholders {
  values: Record<string, string>;
  items: OrderPlaceholderItem[];
}

interface OrderRowLike {
  id: string;
  title: string | null;
  orderDate: Date | number | string | null;
  totalAmount: number;
  taxAmount: number;
  deliveryDate: string | null;
  deliveryPlace: string | null;
  paymentTerms: string | null;
  companyName: string | null;
  memo: string | null;
  sourceQuoteId: string | null;
}

interface OrderItemRowLike {
  itemName: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  unitCode: string | null;
  taxCategoryCode: string | null;
}

export function resolveOrderPlaceholders(params: {
  order: OrderRowLike;
  partnerName: string;
  items: OrderItemRowLike[];
  staffName: string;
  systemConfig: Record<string, unknown>;
  taxCategoryRates: Map<string, number>;
  taxRoundingMode: TaxRoundingMode;
  unitNames: Map<string, string>;
}): ResolvedOrderPlaceholders {
  const { order, partnerName, items, staffName, systemConfig, taxCategoryRates, unitNames } =
    params;

  const { subtotalBeforeDiscount, discountTotal, breakdown } = computeQuoteAmountBreakdown(items, taxCategoryRates, params.taxRoundingMode);

  const resolvedItems: OrderPlaceholderItem[] = items.map((item, index) => {
    const rate = item.taxCategoryCode
      ? (taxCategoryRates.get(item.taxCategoryCode) ?? DEFAULT_TAX_RATE)
      : DEFAULT_TAX_RATE;

    return {
      no: String(index + 1),
      name: item.itemName || "",
      qty: String(item.quantity),
      unit: item.unitCode ? (unitNames.get(item.unitCode) ?? item.unitCode) : "",
      unit_price: formatYen(item.unitPrice),
      tax_rate: `${Math.round(rate * 100)}%`,
      amount: formatYen(item.amount),
    };
  });

  const values: Record<string, string> = {
    order_no: order.id,
    order_date: formatDate(order.orderDate),
    source_quote_no: order.sourceQuoteId || "",
    partner_name: partnerName,
    title: order.title || "",
    delivery_date: order.deliveryDate || "",
    delivery_place: order.deliveryPlace || "",
    payment_terms: order.paymentTerms || "",
    memo: order.memo || "",
    subtotal_before_discount: formatYen(subtotalBeforeDiscount),
    discount_total: formatYen(discountTotal),
    subtotal: formatYen(order.totalAmount - order.taxAmount),
    tax_amount: formatYen(order.taxAmount),
    total_amount: formatYen(order.totalAmount),
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
