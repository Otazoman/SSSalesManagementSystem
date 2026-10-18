// 新規要望(2026-10-18): 発注書印字納期(自由文言の欄)が日付として読める場合に、YYYY-MM-DD へ変換する。
// 「2026-11-10」「2026/11/10」「2026/1/5」の形を受け付け、存在しない日付や「約2週間」などの文言は null を返す。
// 明細の希望納期(日付)へ自動でセットするために使う
export function parseDeliveryDateText(text: string | null | undefined): string | null {
  const match = (text || "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

// 発注書印字納期が prevText → nextText に変わった時の、明細の希望納期の更新。
// 希望納期が空欄の明細と、直前の印字納期から自動でセットされた値のままの明細だけを新しい日付に合わせる
// (明細ごとに手で入れた希望納期は上書きしない)。文言など日付として読めない値になった場合、
// 自動でセットされた値のままの明細は空欄に戻す
export function applyDeliveryDateTextToItems<T extends { requestedDeliveryDate?: string | null }>(
  items: T[],
  prevText: string,
  nextText: string,
): T[] {
  const prevDate = parseDeliveryDateText(prevText);
  const nextDate = parseDeliveryDateText(nextText);
  if (prevDate === nextDate) return items;
  return items.map((it) =>
    !it.requestedDeliveryDate || (prevDate !== null && it.requestedDeliveryDate === prevDate)
      ? { ...it, requestedDeliveryDate: nextDate }
      : it,
  );
}
