"use client";

import type { FormEventHandler, ReactNode } from "react";
import { buttonClass } from "./Button";

/** 公開画面の入力欄。スマホは16px(iOSの自動拡大防止)、sm以上はtext-xs */
export const publicInputClass =
  "w-full border border-slate-300 p-2.5 rounded-xl text-base sm:text-xs bg-white text-slate-900 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed";

/** 公開画面のボタン(共通 Button と同じ見た目の全幅版。<a> など button 以外にも使える) */
export const publicButtonClass = {
  primary: buttonClass({ variant: "primary", fullWidth: true }),
  success: buttonClass({ variant: "success", fullWidth: true }),
  text: buttonClass({ variant: "text", fullWidth: true }),
} as const;

interface PublicCardProps {
  title: ReactNode;
  description?: ReactNode;
  /** タイトルの上に出す小さな目印(ロゴ・ラベル等) */
  badge?: ReactNode;
  /** 指定すると <form> になる(未指定は <div>) */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
}

/** 公開画面のカード(タイトル+説明+本文)。スマホでは余白を詰め、sm以上は従来の余白 */
export function PublicCard({
  title,
  description,
  badge,
  onSubmit,
  children,
}: PublicCardProps) {
  const className =
    "w-full max-w-md bg-white p-5 sm:p-8 rounded-2xl shadow-xl border border-slate-200/60 space-y-5";
  const content = (
    <>
      <div className="text-center">
        {badge}
        <h1 className="text-lg font-black text-slate-900">{title}</h1>
        {description && (
          <p className="text-xs text-slate-600 mt-1.5 font-medium">
            {description}
          </p>
        )}
      </div>
      {children}
    </>
  );
  return onSubmit ? (
    <form onSubmit={onSubmit} className={className}>
      {content}
    </form>
  ) : (
    <div className={className}>{content}</div>
  );
}

/** ラベル+入力欄 */
export function PublicField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-700 mb-1 px-1">
        {label}
      </label>
      {children}
    </div>
  );
}
