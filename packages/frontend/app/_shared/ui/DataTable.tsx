"use client";

import type { ReactNode } from "react";
import { TableScroll } from "./TableScroll";

export interface DataTableColumn {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
  className?: string;
  /** trueの場合、ヘッダクリックでソート可能にする(sortKey/sortDirection/onSortChangeと併用) */
  sortable?: boolean;
}

interface DataTableProps<T> {
  columns: DataTableColumn[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  /**
   * 行1件分の<tr key=...>...</tr>を丸ごと返す（rowのonClick・条件付きclassName等、
   * featureごとに大きく異なる部分を自由に実装できるようにするため、<tr>自体をfeature側に委ねる）
   */
  renderRow: (item: T, index: number) => ReactNode;
  /**
   * table-layout。既定の"auto"はセルのwidthを「最小値」としてしか扱わず、テーブル全体の
   * 余った横幅を各列(特に最後の列)へ強制的に分配してしまうため、columns[].classNameで
   * 指定した幅が意図通りに機能しない(商品マスタ一覧「操作」列の余白崩れの原因)。
   * 列ごとに明示的な幅を指定して厳密に守らせたい場合は"fixed"を指定する
   * (この場合、幅未指定の列が残りの横幅を吸収する)。
   */
  tableLayout?: "auto" | "fixed";
  /** 表の最小幅(px)。これより狭い画面では表の枠内で横スクロールになる(既定500) */
  minWidth?: number;
  /** 現在ソート中の列key(columns[].keyと対応)。指定列がsortable:trueの場合のみ矢印を表示する */
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  /**
   * 追加要望J-1-a(複合ソート): 複数キーを指定している場合の一覧。指定すると、2番目以降のキーにも
   * 矢印に加えて優先順位の番号(②③...)を表示する。未指定の場合はsortBy/sortDirectionの単一キー表示のみ
   * (既存の呼び出し元との後方互換)。
   */
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  /**
   * sortable:true の列見出しクリック時に呼ばれる(そのcolumn.keyを渡す)。
   * 第2引数additiveがtrueの場合(Shift+クリック)は既存のソートキーに追加する指示として扱う
   * (`_shared/hooks/use-paginated-list.ts`の`setSort(key, additive)`をそのまま渡せる形)。
   */
  onSortChange?: (key: string, additive?: boolean) => void;
}

const ALIGN_CLASS: Record<NonNullable<DataTableColumn["align"]>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/**
 * テーブル外枠・空状態行・ローディング行の共通部分のみを担う骨格コンポーネント。
 * 行の中身（操作ボタン等）は機能ごとに大きく異なるため、`renderRow`でfeature側に委譲する。
 */
export function DataTable<T>({
  columns,
  data,
  loading = false,
  emptyMessage = "該当するデータが存在しません。",
  renderRow,
  tableLayout = "auto",
  minWidth = 500,
  sortBy = null,
  sortDirection = "asc",
  sortKeys,
  onSortChange,
}: DataTableProps<T>) {
  // K-1(2026-09-14): Shift+クリックでの複合ソートがツールチップ(ホバー時のみ表示)だけでは
  // 気づかれにくいと判明したため、ソート可能な列がある場合は常時表示のヒントを添える
  const hasSortableColumn = columns.some((c) => c.sortable) && !!onSortChange;
  return (
    <TableScroll minWidth={minWidth} className="overflow-y-auto max-h-[600px]">
      {hasSortableColumn && (
        <div className="px-3 py-1 text-[10px] text-slate-600 border-b border-slate-100 bg-slate-50 sticky top-0 z-10">
          💡 列見出しクリックでソート /
          Shift+クリックで複数列を優先順位付きソート
        </div>
      )}
      <table
        className={`w-full text-left text-xs ${tableLayout === "fixed" ? "table-fixed" : "table-auto"}`}
      >
        <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold uppercase sticky top-0 z-10 shadow-sm">
          <tr>
            {columns.map((col) => {
              const isSortable = col.sortable && !!onSortChange;
              // sortKeysが渡されていれば複数キー対応の表示、無ければ従来通りsortBy/sortDirectionのみを見る
              const multiIndex = sortKeys?.findIndex((s) => s.key === col.key);
              const activeSortKey =
                sortKeys && multiIndex !== undefined && multiIndex >= 0
                  ? sortKeys[multiIndex]
                  : isSortable && sortBy === col.key
                    ? { key: col.key, direction: sortDirection }
                    : undefined;
              const isActiveSort = isSortable && !!activeSortKey;
              const priority =
                sortKeys &&
                sortKeys.length > 1 &&
                multiIndex !== undefined &&
                multiIndex >= 0
                  ? multiIndex + 1
                  : undefined;
              return (
                <th
                  key={col.key}
                  className={`px-4 py-3 bg-slate-100 ${col.align ? ALIGN_CLASS[col.align] : ""} ${isSortable ? "cursor-pointer select-none hover:bg-slate-200" : ""} ${col.className ?? ""}`}
                  onClick={
                    isSortable
                      ? (e) => onSortChange!(col.key, e.shiftKey)
                      : undefined
                  }
                  title={
                    isSortable
                      ? "クリック: ソート / Shift+クリック: 複合ソートに追加"
                      : undefined
                  }
                  aria-sort={
                    isActiveSort
                      ? activeSortKey!.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {col.label}
                  {isSortable && (
                    <span className="ml-1 inline-block w-4 text-slate-600">
                      {isActiveSort
                        ? `${priority ?? ""}${activeSortKey!.direction === "asc" ? "▲" : "▼"}`
                        : ""}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 text-slate-700">
          {loading ? (
            <tr>
              <td
                colSpan={columns.length}
                className="text-center py-8 text-slate-600 bg-slate-50"
              >
                読み込み中...
              </td>
            </tr>
          ) : data.length > 0 ? (
            data.map((item, index) => renderRow(item, index))
          ) : (
            <tr>
              <td
                colSpan={columns.length}
                className="text-center py-8 text-slate-600 italic bg-slate-50"
              >
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </TableScroll>
  );
}
