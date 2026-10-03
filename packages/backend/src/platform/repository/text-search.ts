import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

// 一覧の「〜を含む/〜で始まる/〜で終わる」検索の条件。
// Cloudflare D1 は LIKE のパターンを50バイトまでに制限しており、日本語(1文字3バイト)だと16文字程度で
// 「LIKE or GLOB pattern too complex」エラー(=500)になる(BUG-012)。そのため LIKE を使わず、
// 文字列関数(instr・substr)で同じ条件を表す。
// - 英字の大文字・小文字は区別しない(lower() で揃える。SQLite の LIKE と同じく ASCII のみ)
// - 検索語の「%」「_」はワイルドカードではなく、ただの文字として扱う
// - 列が NULL の行は一致しない(LIKE と同じ)

/** 列の値が keyword を含む */
export function containsText(column: SQLWrapper, keyword: string): SQL {
  return sql`instr(lower(${column}), lower(${keyword})) > 0`;
}

/** 列の値が keyword で始まる */
export function startsWithText(column: SQLWrapper, keyword: string): SQL {
  return sql`substr(lower(${column}), 1, length(${keyword})) = lower(${keyword})`;
}

/** 列の値が keyword で終わる */
export function endsWithText(column: SQLWrapper, keyword: string): SQL {
  return sql`substr(lower(${column}), -length(${keyword})) = lower(${keyword})`;
}
