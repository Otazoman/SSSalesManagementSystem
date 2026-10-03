"use client";

import type { DocumentTypeOption } from "../contact-document-types";

interface DocumentTypeChecklistProps {
  /** 見出し。例: "メールで送る帳票" */
  legend: string;
  options: readonly DocumentTypeOption[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** チェックボックスのid接頭辞(同じ画面に複数置く場合に重複させない) */
  idPrefix?: string;
}

/**
 * 担当者ごとに「メールで送る帳票」を複数選ぶチェック群(V-5。取引先担当者・倉庫担当者で共通)。
 * 1つも選ばない場合、その担当者へは帳票のメールを送らない。
 */
export function DocumentTypeChecklist({
  legend,
  options,
  value,
  onChange,
  disabled = false,
  idPrefix = "document-type",
}: DocumentTypeChecklistProps) {
  const toggle = (key: string, checked: boolean) => {
    const next = new Set(value);
    if (checked) next.add(key);
    else next.delete(key);
    onChange(options.map((o) => o.value).filter((v) => next.has(v)));
  };

  return (
    <fieldset disabled={disabled} className="space-y-2 min-w-0">
      <legend className="text-xs sm:text-[10px] font-bold text-slate-700">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange(options.map((o) => o.value))}
          className="px-2 py-1 text-xs font-bold rounded border border-slate-300 bg-white text-slate-800 cursor-pointer hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          すべて選ぶ
        </button>
        <button
          type="button"
          onClick={() => onChange([])}
          className="px-2 py-1 text-xs font-bold rounded border border-slate-300 bg-white text-slate-800 cursor-pointer hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          すべて外す
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {options.map((option) => {
          const id = `${idPrefix}-${option.value}`;
          return (
            <div key={option.value} className="flex items-center space-x-2">
              <input
                type="checkbox"
                id={id}
                checked={value.includes(option.value)}
                onChange={(e) => toggle(option.value, e.target.checked)}
                className="w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
              />
              <label
                htmlFor={id}
                className="text-xs font-bold text-slate-800 cursor-pointer"
              >
                {option.label}
              </label>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-slate-600">
        1つも選ばない場合、この担当者には帳票のメールを送りません。
      </p>
    </fieldset>
  );
}
