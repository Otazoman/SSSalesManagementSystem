"use client";

import type { ReactNode } from "react";

/**
 * input/select/textarea共通スタイル。既存12フォームでバイト単位同一のまま重複しているクラス文字列。
 * スマホは text-base(16px未満だとiOS Safariが入力時に拡大するため)、sm以上は従来の text-xs。
 */
export const formFieldInputClass =
  "w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none transition-colors placeholder:text-slate-500 font-medium disabled:bg-slate-100 disabled:text-slate-500 disabled:opacity-70 disabled:cursor-not-allowed";

/** ラベルの共通クラス(スマホは12px、sm以上は10px。CLAUDE.md #20により slate-700)。余白は使う側で付ける */
export const formFieldLabelClass =
  "block text-xs sm:text-[10px] font-bold text-slate-700";

interface FormFieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  /** <input>/<select>/<textarea>自体はfeature側で組み立て、ここには渡すだけにする（type/value/onChange等の自由度を保つため） */
  children: ReactNode;
}

/**
 * ラベル+入力欄のペアの共通ラッパー。入力欄自体（<input>等）はfeature側に残し、
 * `formFieldInputClass`を渡して使う（`className={formFieldInputClass}`）。
 */
export function FormField({ label, required, hint, children }: FormFieldProps) {
  return (
    <div>
      <label className={`${formFieldLabelClass} mb-0.5`}>
        {label}
        {required && " *"}
      </label>
      {children}
      {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}
