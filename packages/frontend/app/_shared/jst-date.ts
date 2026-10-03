// BUG-043: 日本時間の日付(YYYY-MM-DD)。`new Date().toISOString().slice(0, 10)` は UTC の日付のため、
// 日本時間の 0時〜9時に前日になる。画面で「今日」や「今日から n か月後」を作る時は必ずこの関数を使う。
// Backend にも同じ関数がある(backend/src/platform/date/format-jst-date.ts)。

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

// 日付(YYYY-MM-DD)の n か月後(月末を越える日は、Date と同じく翌月へ繰り越す。例: 1/31 の1か月後は 3/3 か 3/2)
export function addMonthsToDate(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}
