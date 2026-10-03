/**
 * 「スマホでは1行=1枚のカード、md以上は通常の表」にするためのクラス集(参照・承認系の一覧向け)。
 * 表の構造(<table><thead><tbody><tr><td>)はそのままに、CSSだけで切り替えるので、行の中身や操作ボタンを二重に書かなくて済む。
 *
 * 使い方: 各クラスを対応する要素に付け、<td> には data-label="列名" を付ける
 * (スマホでは、その列名がセルの上に小さく表示される。md以上では表示されない)。
 *   <table className={stackedTable.table}>
 *     <thead className={stackedTable.thead}>…</thead>
 *     <tbody className={stackedTable.tbody}>
 *       <tr className={stackedTable.tr}><td className={stackedTable.td} data-label="申請者">…</td></tr>
 */
export const stackedTable = {
  table: "block w-full text-left text-xs md:table",
  thead: "hidden md:table-header-group",
  tbody: "block md:table-row-group",
  tr: "mb-3 block rounded-lg border border-slate-200 bg-white p-3 md:mb-0 md:table-row md:rounded-none md:border-0 md:bg-transparent md:p-0",
  td: "block py-1.5 before:mb-0.5 before:block before:text-[10px] before:font-bold before:text-slate-600 before:content-[attr(data-label)] md:table-cell md:px-4 md:py-3 md:before:hidden",
  /** 列見出しが無い(colSpanで全幅に使う)行・セル用 */
  trBare: "block md:table-row",
  tdBare: "block md:table-cell",
} as const;
