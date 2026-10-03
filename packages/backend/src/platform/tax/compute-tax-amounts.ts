// BUG-042: 消費税の端数処理を1か所にまとめる。
// インボイス制度の要件どおり、端数処理は「1つの伝票(請求書)につき、税率ごとの合計に1回」行う。
// 端数処理の方法(切り捨て・四捨五入・切り上げ)は会社設定(tax_rounding_mode)で選ぶ。
// 画面側にも同じ計算(frontend/app/_shared/tax-amounts.ts)があり、両方の結果を一致させる。

export type TaxRoundingMode = "floor" | "round" | "ceil";

export const TAX_ROUNDING_MODES: readonly TaxRoundingMode[] = ["floor", "round", "ceil"];

// 初期値は切り捨て(2026-09-29 ユーザー決定。それまでの見積・受注・売上・仕入計上の画面と同じ)
export const DEFAULT_TAX_ROUNDING_MODE: TaxRoundingMode = "floor";

export function toTaxRoundingMode(value: unknown): TaxRoundingMode {
  return TAX_ROUNDING_MODES.includes(value as TaxRoundingMode)
    ? (value as TaxRoundingMode)
    : DEFAULT_TAX_ROUNDING_MODE;
}

/**
 * 税抜金額×税率を、指定の方法で円に丸める。
 * - 浮動小数の誤差(例: 1010 * 0.1 = 101.00000000000001)で切り上げが1円ずれないよう、先に小数第6位で丸める
 * - マイナス(値引・返品の明細)は絶対値で丸めて符号を戻す(切り捨ては0に近づける)
 */
export function roundTaxAmount(excl: number, rate: number, mode: TaxRoundingMode): number {
  const raw = Math.round(excl * rate * 1e6) / 1e6;
  const sign = raw < 0 ? -1 : 1;
  const abs = Math.abs(raw);
  const rounded = mode === "floor" ? Math.floor(abs) : mode === "ceil" ? Math.ceil(abs) : Math.round(abs);
  return sign * rounded || 0;
}

export interface TaxLineLike {
  amount: number;
  rate: number;
}

/**
 * 伝票の消費税(税率ごとに1回の端数処理)を、明細ごとに割り振る(仕訳の明細ごとの消費税に使う)。
 * 明細の消費税の合計は、税率ごとに必ず伝票の消費税と一致する(端数は、切り捨てた端数の大きい明細から1円ずつ配る)。
 */
export function allocateTaxToLines(lines: TaxLineLike[], mode: TaxRoundingMode): number[] {
  const result = lines.map(() => 0);
  const rateKeys = [...new Set(lines.map((l) => l.rate))];
  for (const rate of rateKeys) {
    const indexes = lines.map((l, i) => (l.rate === rate ? i : -1)).filter((i) => i >= 0);
    const excl = indexes.reduce((s, i) => s + lines[i].amount, 0);
    const total = roundTaxAmount(excl, rate, mode);
    const raws = indexes.map((i) => Math.round(lines[i].amount * rate * 1e6) / 1e6);
    const bases = raws.map((r) => Math.trunc(r));
    let rest = total - bases.reduce((s, b) => s + b, 0);
    const step = rest < 0 ? -1 : 1;
    // 端数(切り捨てた分)の大きい順に1円ずつ配る。同じなら明細の順
    const order = raws
      .map((r, k) => ({ k, frac: Math.abs(r - bases[k]) }))
      .sort((a, b) => b.frac - a.frac || a.k - b.k);
    for (let n = 0; rest !== 0 && order.length > 0; n++) {
      bases[order[n % order.length].k] += step;
      rest -= step;
    }
    indexes.forEach((i, k) => (result[i] = bases[k]));
  }
  return result;
}

/**
 * 仕訳用: allocateTaxToLines で割り振った上で、明細の消費税の合計を、伝票に保存されている消費税に必ず合わせる
 * (端数処理の方法を変える前に保存した伝票でも、仕訳の金額が伝票と食い違わないようにする)。
 * 差は、金額の絶対値が最も大きい明細で調整する。
 */
export function allocateDocumentTaxToLines(
  lines: TaxLineLike[],
  mode: TaxRoundingMode,
  documentTaxAmount: number,
): number[] {
  const result = allocateTaxToLines(lines, mode);
  const diff = documentTaxAmount - result.reduce((s, t) => s + t, 0);
  if (diff !== 0 && lines.length > 0) {
    let largest = 0;
    lines.forEach((l, i) => {
      if (Math.abs(l.amount) > Math.abs(lines[largest].amount)) largest = i;
    });
    result[largest] += diff;
  }
  return result;
}
