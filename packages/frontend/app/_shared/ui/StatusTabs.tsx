"use client";

export interface StatusTabOption<T extends string> {
  value: T;
  label: string;
}

interface StatusTabsProps<T extends string> {
  options: StatusTabOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * 状態切替用のタブUI（例: 全件/有効のみ/無効のみ）。ログイン画面のメール/従業員番号切替
 * タブと同一の見た目パターンを共通化したもの。
 */
export function StatusTabs<T extends string>({
  options,
  value,
  onChange,
}: StatusTabsProps<T>) {
  return (
    <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1 text-[11px] font-bold">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 px-2 py-1.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
            value === opt.value
              ? "bg-white text-indigo-600 shadow-sm"
              : "text-slate-600 hover:text-slate-800"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
