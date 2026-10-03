// 請求書(billing_invoice)・売上計上書(sales_recognition)・仕入計上書(purchase_recognition)の
// 帳票テンプレート(xlsx)向けに、伝票のデータをlayout.json駆動レンダラーへ渡すプレースホルダー値へ変換する。
// resolve-order-placeholders.ts(注文請書)と同じ方針で、3帳票は明細・金額・会社情報の差し込み項目を共通にし、
// 伝票番号・日付など帳票ごとに名前が異なる項目だけを個別に持つ。
import { computeQuoteAmountBreakdown } from "./compute-quote-amount-breakdown";
import { DEFAULT_TAX_RATE, DateLike, formatDate, formatYen } from "./format-values";
import type { TaxRoundingMode } from "../tax/compute-tax-amounts";

export interface DocumentPlaceholderItem {
  [key: string]: string;
  no: string;
  name: string;
  qty: string;
  unit: string;
  unit_price: string;
  tax_rate: string;
  amount: string;
}

export interface ResolvedDocumentPlaceholders {
  values: Record<string, string>;
  items: DocumentPlaceholderItem[];
}

export interface DocumentLineLike {
  itemName: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  unitCode?: string | null;
  taxCategoryCode: string | null;
}

export interface DocumentCompanyLike {
  name: string;
  zip: string;
  address: string;
  tel: string;
  invoiceNo: string;
}

interface CommonParams {
  partnerName: string;
  title: string | null;
  memo: string | null;
  paymentTerms: string | null;
  totalAmount: number;
  taxAmount: number;
  items: DocumentLineLike[];
  staffName: string;
  company: DocumentCompanyLike;
  taxCategoryRates: Map<string, number>;
  taxRoundingMode: TaxRoundingMode;
  unitNames: Map<string, string>;
}

// 3帳票に共通の差し込み項目(取引先・件名・支払条件・金額・税率別内訳・自社情報・担当者)と明細
function resolveCommon(params: CommonParams): ResolvedDocumentPlaceholders {
  const { items, taxCategoryRates, unitNames, company } = params;

  const { subtotalBeforeDiscount, discountTotal, breakdown } = computeQuoteAmountBreakdown(items, taxCategoryRates, params.taxRoundingMode);

  const resolvedItems: DocumentPlaceholderItem[] = items.map((item, index) => {
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
    partner_name: params.partnerName,
    title: params.title || "",
    memo: params.memo || "",
    payment_terms: params.paymentTerms || "",
    subtotal_before_discount: formatYen(subtotalBeforeDiscount),
    discount_total: formatYen(discountTotal),
    subtotal: formatYen(params.totalAmount - params.taxAmount),
    tax_amount: formatYen(params.taxAmount),
    total_amount: formatYen(params.totalAmount),
    company_name: company.name,
    company_zip: company.zip,
    company_address: company.address,
    company_tel: company.tel,
    company_invoice_no: company.invoiceNo,
    sales_person_name: params.staffName,
    "tax_breakdown.rate10.excl": formatYen(breakdown.rate10.excl),
    "tax_breakdown.rate10.tax": formatYen(breakdown.rate10.tax),
    "tax_breakdown.rate8.excl": formatYen(breakdown.rate8.excl),
    "tax_breakdown.rate8.tax": formatYen(breakdown.rate8.tax),
    "tax_breakdown.rate0.excl": formatYen(breakdown.rate0.excl),
    "tax_breakdown.rate0.tax": formatYen(breakdown.rate0.tax),
  };

  return { values, items: resolvedItems };
}

// 請求書(請求管理)。請求番号・請求日・請求期間(締め請求のみ)が固有の項目
export function resolveBillingPlaceholders(
  params: CommonParams & {
    billingNo: string;
    billingDate: DateLike;
    periodStart: DateLike;
    periodEnd: DateLike;
  },
): ResolvedDocumentPlaceholders {
  const resolved = resolveCommon(params);
  Object.assign(resolved.values, {
    billing_no: params.billingNo,
    billing_date: formatDate(params.billingDate),
    period_start: formatDate(params.periodStart),
    period_end: formatDate(params.periodEnd),
  });
  return resolved;
}

// 売上計上書(売上管理)。売上番号・計上日が固有の項目
export function resolveSalesRecognitionPlaceholders(
  params: CommonParams & { salesNo: string; salesDate: DateLike },
): ResolvedDocumentPlaceholders {
  const resolved = resolveCommon(params);
  Object.assign(resolved.values, {
    sales_no: params.salesNo,
    sales_date: formatDate(params.salesDate),
  });
  return resolved;
}

// 仕入計上書(仕入管理)。仕入番号・計上日・発注番号・納品日(=計上日)が固有の項目
export function resolvePurchaseRecognitionPlaceholders(
  params: CommonParams & {
    purchaseNo: string;
    purchaseDate: DateLike;
    purchaseOrderNo: string | null;
  },
): ResolvedDocumentPlaceholders {
  const resolved = resolveCommon(params);
  Object.assign(resolved.values, {
    purchase_no: params.purchaseNo,
    purchase_date: formatDate(params.purchaseDate),
    purchase_order_no: params.purchaseOrderNo || "",
    delivery_date: formatDate(params.purchaseDate),
  });
  return resolved;
}
