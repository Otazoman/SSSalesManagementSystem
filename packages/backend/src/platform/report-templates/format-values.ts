// #14-2③: resolve-*-placeholders.ts(見積書・注文請書・発注書・検収書・請求書/売上計上書/仕入計上書)
// 5ファイルに、同じ実装(日付・金額のフォーマット、税率区分の既定値)がそれぞれ埋め込まれていたため、
// 1箇所にまとめる。

export const DEFAULT_TAX_RATE = 0.1;

export type DateLike = Date | number | string | null;

export function formatDate(value: DateLike): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
}

export function formatYen(amount: number): string {
  const rounded = Math.round(amount);
  return rounded < 0 ? `-¥${Math.abs(rounded).toLocaleString()}` : `¥${rounded.toLocaleString()}`;
}
