import { asc, desc, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/** ソート対象として許可する列のマップ。キーがクエリパラメータ`sortBy`として受け付ける値になる */
export type SortColumnMap = Record<string, AnySQLiteColumn>;

export interface SortQuery {
  sortBy?: string;
  sortOrder?: string;
}

/** sortBy/sortOrderをカンマ区切りで分解し、[キー, 方向]の組に正規化する(方向省略時はasc) */
function parseSortKeys(query: SortQuery): Array<{ key: string; desc: boolean }> {
  if (!query.sortBy) return [];
  const keys = query.sortBy
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  const dirs = (query.sortOrder ?? "").split(",").map((d) => d.trim());
  return keys.map((key, i) => ({ key, desc: dirs[i] === "desc" }));
}

/**
 * クエリパラメータ(sortBy/sortOrder)から、許可された列(columnMapのキー)に対してのみ
 * ORDER BY句の配列を組み立てる。任意の文字列をSQLに埋め込まないためのallowlist方式。
 * 追加要望J-1-a(複合ソート): sortBy/sortOrderはカンマ区切りで複数列を指定できる
 * (例: `sortBy=partnerId,quoteDate&sortOrder=asc,desc`)。単一値のみの指定は従来通り動作する。
 * 未指定・許可外のキーのみの場合はundefinedを返す(呼び出し側は既存動作=順序未指定のまま)。
 * 呼び出し側は`.orderBy(...orderBy)`のようにスプレッドして渡す(drizzleの`orderBy`は可変長引数)。
 */
export function buildOrderBy(
  query: SortQuery,
  columnMap: SortColumnMap,
): SQL[] | undefined {
  const clauses = parseSortKeys(query)
    .map(({ key, desc: isDesc }) => {
      const column = columnMap[key];
      if (!column) return undefined;
      return isDesc ? desc(column) : asc(column);
    })
    .filter((c): c is SQL => c !== undefined);
  return clauses.length > 0 ? clauses : undefined;
}

/**
 * SQLのORDER BYが使えない一覧(JS側で複数テーブルを結合・整形してから返す一覧、例: users一覧の
 * 所属・権限マトリクス結合)向けの、同じallowlist方式によるメモリ内ソート。
 * 追加要望J-1-a(複合ソート): 複数キー指定時は先頭キーを優先し、同値の場合のみ次のキーで比較する
 * (Excelの複数キーソートと同じ優先順位方式)。columnMapに無いキーのみの場合は元の配列をそのまま返す
 * (=既存動作と完全互換)。
 */
export function applyInMemorySort<T>(
  items: T[],
  query: SortQuery,
  columnMap: Record<string, (item: T) => unknown>,
): T[] {
  const accessors = parseSortKeys(query)
    .map(({ key, desc: isDesc }) => {
      const accessor = columnMap[key];
      if (!accessor) return undefined;
      return { accessor, dir: isDesc ? -1 : 1 };
    })
    .filter((a): a is { accessor: (item: T) => unknown; dir: number } => a !== undefined);
  if (accessors.length === 0) return items;

  return [...items].sort((a, b) => {
    for (const { accessor, dir } of accessors) {
      const av = accessor(a);
      const bv = accessor(b);
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
    }
    return 0;
  });
}
