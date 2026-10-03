"use client";

interface PaginationProps {
  /** 会社設定`is_pagination_enabled`がfalseの間は何も描画しない */
  paginationEnabled: boolean;
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  limitOptions?: number[];
}

/**
 * ページ送り＋件数切替（20/50/100件等）UI。1ページあたりの件数は会社設定では固定せず、
 * ここで機能ごとに選択可能にする（`use-paginated-list.ts`とセットで使う）。
 */
export function Pagination({
  paginationEnabled,
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  onLimitChange,
  limitOptions = [20, 50, 100],
}: PaginationProps) {
  if (!paginationEnabled) return null;

  return (
    <div className="flex flex-col sm:flex-row justify-between items-center gap-3 px-1 py-2 text-xs text-slate-700">
      <div className="flex items-center gap-2">
        <span>
          全<span className="font-bold text-slate-700">{total}</span>件中{" "}
          {total === 0 ? 0 : (page - 1) * limit + 1}〜
          {Math.min(page * limit, total)}件を表示
        </span>
        <select
          value={limit}
          onChange={(e) => onLimitChange(Number(e.target.value))}
          className="border border-slate-300 rounded px-1.5 py-1 text-base sm:text-xs bg-white text-slate-900 cursor-pointer focus:outline-none focus:border-indigo-500"
        >
          {limitOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}件表示
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-800 font-bold disabled:text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-slate-50 enabled:cursor-pointer"
        >
          前へ
        </button>
        <span className="px-2 font-bold text-slate-700">
          {page} / {Math.max(totalPages, 1)}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-800 font-bold disabled:text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-slate-50 enabled:cursor-pointer"
        >
          次へ
        </button>
      </div>
    </div>
  );
}
