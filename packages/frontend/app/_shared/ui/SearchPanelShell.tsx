"use client";

import type { ReactNode } from "react";

interface SearchPanelShellProps {
  title?: string;
  onClearSearch?: () => void;
  /** lg幅でのカラム数（検索項目数に応じて調整。デフォルト3） */
  columns?: 2 | 3 | 4;
  /** 検索項目のgridはfeature側で組み立てる */
  children: ReactNode;
}

const LG_COLS_CLASS: Record<
  NonNullable<SearchPanelShellProps["columns"]>,
  string
> = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

/** 検索パネルの外枠（カード・タイトル・条件リセットボタン）の共通化。中身の検索項目はfeature側に残す */
export function SearchPanelShell({
  title = "🔍 条件指定検索",
  onClearSearch,
  columns = 3,
  children,
}: SearchPanelShellProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between border-b pb-2 border-slate-100">
        <h2 className="text-xs font-bold text-slate-700">{title}</h2>
        {onClearSearch && (
          <button
            type="button"
            onClick={onClearSearch}
            className="text-xs text-slate-600 font-bold hover:text-slate-800 transition-colors cursor-pointer"
          >
            条件をクリア
          </button>
        )}
      </div>

      <div
        className={`grid grid-cols-1 md:grid-cols-2 ${LG_COLS_CLASS[columns]} gap-3`}
      >
        {children}
      </div>
    </div>
  );
}
