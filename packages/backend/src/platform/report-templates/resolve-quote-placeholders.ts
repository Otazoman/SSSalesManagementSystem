// Item4-a Stage2: quotes/quoteItemsのデータをlayout.json駆動レンダラー向けのプレースホルダー値へ変換する。
// {{subtotal}}/{{tax_amount}}/{{total_amount}}はquotes保存時点の確定値(hData.totalAmount等)を正とし、
// {{tax_breakdown.rate10.excl}}等の税率別内訳のみ明細から都度計算する(保存された値に対応する列が無いため)。
import { computeQuoteAmountBreakdown } from "./compute-quote-amount-breakdown";
import { DEFAULT_TAX_RATE, formatDate, formatYen } from "./format-values";
import type { TaxRoundingMode } from "../tax/compute-tax-amounts";

export interface QuotePlaceholderItem {
  [key: string]: string;
  no: string;
  name: string;
  qty: string;
  unit: string;
  unit_price: string;
  tax_rate: string;
  amount: string;
}

export interface ResolvedQuotePlaceholders {
  values: Record<string, string>;
  items: QuotePlaceholderItem[];
}

interface QuoteRowLike {
  id: string;
  title: string | null;
  quoteDate: Date | number | string | null;
  validUntil: Date | number | string | null;
  totalAmount: number;
  taxAmount: number;
  deliveryDate: string | null;
  paymentTerms: string | null;
  companyName: string | null;
  memo: string | null;
}

interface QuoteItemRowLike {
  itemName: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  unitCode: string | null;
  taxCategoryCode: string | null;
}

export function resolveQuotePlaceholders(params: {
  quote: QuoteRowLike;
  partnerName: string;
  items: QuoteItemRowLike[];
  staffName: string;
  systemConfig: Record<string, unknown>;
  taxCategoryRates: Map<string, number>;
  taxRoundingMode: TaxRoundingMode;
  unitNames: Map<string, string>;
}): ResolvedQuotePlaceholders {
  const {
    quote,
    partnerName,
    items,
    staffName,
    systemConfig,
    taxCategoryRates,
    unitNames,
  } = params;

  const { subtotalBeforeDiscount, discountTotal, breakdown } =
    computeQuoteAmountBreakdown(items, taxCategoryRates, params.taxRoundingMode);

  const resolvedItems: QuotePlaceholderItem[] = items.map((item, index) => {
    const rate = item.taxCategoryCode
      ? (taxCategoryRates.get(item.taxCategoryCode) ?? DEFAULT_TAX_RATE)
      : DEFAULT_TAX_RATE;

    return {
      no: String(index + 1),
      name: item.itemName || "",
      qty: String(item.quantity),
      // Item4-a: quoteItems.unitCodeはコード("KG"等)のみ保持しているため、
      // 単位マスタの日本語名称を引いて表示する(マスタに無いコードはそのままコードを表示)
      unit: item.unitCode ? (unitNames.get(item.unitCode) ?? item.unitCode) : "",
      unit_price: formatYen(item.unitPrice),
      tax_rate: `${Math.round(rate * 100)}%`,
      amount: formatYen(item.amount),
    };
  });

  const values: Record<string, string> = {
    quote_no: quote.id,
    quote_date: formatDate(quote.quoteDate),
    partner_name: partnerName,
    title: quote.title || "",
    delivery_date: quote.deliveryDate || "",
    payment_terms: quote.paymentTerms || "",
    memo: quote.memo || "",
    valid_until: formatDate(quote.validUntil),
    subtotal_before_discount: formatYen(subtotalBeforeDiscount),
    discount_total: formatYen(discountTotal),
    subtotal: formatYen(quote.totalAmount - quote.taxAmount),
    tax_amount: formatYen(quote.taxAmount),
    total_amount: formatYen(quote.totalAmount),
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
