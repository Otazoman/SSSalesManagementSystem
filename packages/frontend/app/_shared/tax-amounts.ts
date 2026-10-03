// BUG-042: 消費税の端数処理(画面の表示用)。Backend の platform/tax/compute-tax-amounts.ts と同じ計算にする
// (保存する金額は Backend で計算し直すため、ここがずれると画面と保存後の金額が食い違う)。
// 端数処理は「1つの伝票につき、税率ごとの合計に1回」。方法は会社設定(tax_rounding_mode)で選ぶ。

export type TaxRoundingMode = "floor" | "round" | "ceil";

export const DEFAULT_TAX_ROUNDING_MODE: TaxRoundingMode = "floor";

export const TAX_ROUNDING_MODE_OPTIONS: { value: TaxRoundingMode; label: string }[] = [
  { value: "floor", label: "切り捨て" },
  { value: "round", label: "四捨五入" },
  { value: "ceil", label: "切り上げ" },
];

export function toTaxRoundingMode(value: unknown): TaxRoundingMode {
  return TAX_ROUNDING_MODE_OPTIONS.some((o) => o.value === value)
    ? (value as TaxRoundingMode)
    : DEFAULT_TAX_ROUNDING_MODE;
}

/**
 * 税抜金額×税率を、指定の方法で円に丸める。
 * 浮動小数の誤差(例: 1010 * 0.1 = 101.00000000000001)を先に取り除き、マイナスは絶対値で丸めて符号を戻す。
 */
export function roundTaxAmount(excl: number, rate: number, mode: TaxRoundingMode): number {
  const raw = Math.round(excl * rate * 1e6) / 1e6;
  const sign = raw < 0 ? -1 : 1;
  const abs = Math.abs(raw);
  const rounded = mode === "floor" ? Math.floor(abs) : mode === "ceil" ? Math.ceil(abs) : Math.round(abs);
  return sign * rounded || 0;
}
