// BUG-043: 日本時間の日付(YYYY-MM-DD)。Worker は UTC で動くため、`new Date().toISOString().slice(0, 10)` や
// `getDate()` などは、日本時間の 0時〜9時に前日の日付になる。「今日」や日時からの日付は必ずこの関数で作る。
// 画面側にも同じ関数がある(frontend/app/_shared/jst-date.ts)。

const JST_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// 日時を、日本時間の日付(YYYY-MM-DD)にする
export function formatJstDate(date: Date): string {
  const parts = Object.fromEntries(JST_DATE_FORMAT.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// 日本時間の今日(YYYY-MM-DD)
export function todayJst(): string {
  return formatJstDate(new Date());
}
