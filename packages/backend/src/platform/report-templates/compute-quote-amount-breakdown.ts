// Item4-b: quoteItemsから値引き合計・税率別内訳(10%/8%/0%)を算出する純粋関数。
// resolve-quote-placeholders.ts(カスタムテンプレート用)とpdfGenerator.ts(標準レイアウト用)の
// 両方から共通で使う(重複実装を避けるため)。
// BUG-042: 消費税は、伝票ごと・税率ごとに1回、会社設定の方法(切り捨て・四捨五入・切り上げ)で端数処理する
import { roundTaxAmount, type TaxRoundingMode } from "../tax/compute-tax-amounts";

const DEFAULT_TAX_RATE = 0.1;

export interface QuoteAmountItemLike {
  amount: number;
  taxCategoryCode: string | null;
}

export interface QuoteAmountBreakdown {
  subtotalBeforeDiscount: number;
  discountTotal: number;
  breakdown: {
    rate10: { excl: number; tax: number };
    rate8: { excl: number; tax: number };
    rate0: { excl: number; tax: number };
  };
}

function classifyRateBucket(rate: number): "rate10" | "rate8" | "rate0" {
  if (Math.abs(rate - 0.1) < 1e-9) return "rate10";
  if (Math.abs(rate - 0.08) < 1e-9) return "rate8";
  return "rate0";
}

export function computeQuoteAmountBreakdown(
  items: QuoteAmountItemLike[],
  taxCategoryRates: Map<string, number>,
  roundingMode: TaxRoundingMode,
): QuoteAmountBreakdown {
  const breakdown = {
    rate10: { excl: 0, tax: 0 },
    rate8: { excl: 0, tax: 0 },
    rate0: { excl: 0, tax: 0 },
  };
  let discountTotal = 0;
  let subtotalBeforeDiscount = 0;

  for (const item of items) {
    const rate = item.taxCategoryCode
      ? (taxCategoryRates.get(item.taxCategoryCode) ?? DEFAULT_TAX_RATE)
      : DEFAULT_TAX_RATE;
    const bucket = classifyRateBucket(rate);
    breakdown[bucket].excl += item.amount;

    if (item.amount < 0) {
      discountTotal += item.amount;
    } else {
      subtotalBeforeDiscount += item.amount;
    }
  }

  breakdown.rate10.tax = roundTaxAmount(breakdown.rate10.excl, 0.1, roundingMode);
  breakdown.rate8.tax = roundTaxAmount(breakdown.rate8.excl, 0.08, roundingMode);
  breakdown.rate0.tax = 0;

  return { subtotalBeforeDiscount, discountTotal, breakdown };
}

/**
 * BUG-042: 伝票に保存する合計(税込)と消費税を、明細から計算する(発注・購買申請・見積・受注・売上・仕入計上・支払で共通)。
 * 消費税は税率ごとに1回、会社設定の方法で端数処理する(computeQuoteAmountBreakdown と同じ計算)。
 */
export function computeDocumentTotals(
  items: QuoteAmountItemLike[],
  taxCategoryRates: Map<string, number>,
  roundingMode: TaxRoundingMode,
): { totalAmount: number; taxAmount: number } {
  const { subtotalBeforeDiscount, discountTotal, breakdown } = computeQuoteAmountBreakdown(
    items,
    taxCategoryRates,
    roundingMode,
  );
  const taxAmount = breakdown.rate10.tax + breakdown.rate8.tax + breakdown.rate0.tax;
  return { totalAmount: subtotalBeforeDiscount + discountTotal + taxAmount, taxAmount };
}
