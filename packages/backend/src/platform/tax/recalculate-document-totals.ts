import { computeDocumentTotals } from "../report-templates/compute-quote-amount-breakdown";
import { getTaxRoundingMode } from "./get-tax-rounding-mode";

interface PayloadLike {
  items?: { quantity?: unknown; unitPrice?: unknown; taxCategoryCode?: string | null }[] | null;
  totalAmount?: number | null;
  taxAmount?: number | null;
}

/**
 * BUG-042: 見積・受注・売上・仕入計上の保存時に、画面から送られた合計(税込)と消費税を、明細から計算し直した値に置き換える。
 * 消費税は税率ごとに1回、会社設定の方法で端数処理する(画面の計算は表示用。保存する金額は Backend で決める)。
 * 明細が無い場合は、画面から送られた値をそのまま使う(発注・購買申請の calcAmounts と同じ方針)。
 */
export async function recalculateDocumentTotals<T extends PayloadLike>(
  kv: KVNamespace,
  body: T,
  taxCategoryRates: Map<string, number>,
): Promise<T> {
  if (!body.items || body.items.length === 0) return body;
  const roundingMode = await getTaxRoundingMode(kv);
  const totals = computeDocumentTotals(
    body.items.map((item) => ({
      amount: (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0),
      taxCategoryCode: item.taxCategoryCode || null,
    })),
    taxCategoryRates,
    roundingMode,
  );
  return { ...body, ...totals };
}
