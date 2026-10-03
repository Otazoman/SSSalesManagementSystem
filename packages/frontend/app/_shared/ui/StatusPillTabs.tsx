"use client";

export interface StatusPillOption<T extends string> {
  value: T;
  label: string;
}

interface StatusPillTabsProps<T extends string> {
  options: StatusPillOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * 状態切替用のピルボタン列(枠なしで個々のボタンを並べるスタイル)。
 * sales/quotesの一覧画面ステータスタブと同一の見た目パターンを共通化したもの。
 * `StatusTabs`(枠付きセグメントコントロール、マスタ系一覧で使用)とは視覚パターンが異なるため
 * 別コンポーネントとして提供する(伝票系一覧はこちらを使う)。
 */
export function StatusPillTabs<T extends string>({
  options,
  value,
  onChange,
}: StatusPillTabsProps<T>) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer transition-colors whitespace-nowrap ${
            value === opt.value
              ? "bg-indigo-600 text-white shadow-sm"
              : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
