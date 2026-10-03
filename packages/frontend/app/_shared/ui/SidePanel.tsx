"use client";

import type { ReactNode } from "react";
import { Button } from "./Button";

interface SidePanelProps {
  /** タイトルの上に出す小さな識別子(伝票番号など) */
  eyebrow?: string;
  title: string;
  onClose: () => void;
  /** 下部の閉じるボタンの文言(参照画面の文言は「閉じる」に統一) */
  closeLabel?: string;
  /** ダイアログの名前(読み上げ・テスト用)。省略すると title */
  ariaLabel?: string;
  /** 右上の✕の名前(既定は「閉じる」) */
  closeAriaLabel?: string;
  children: ReactNode;
}

/**
 * 右側にスライドして出す参照用パネル(伝票のプレビュー)。PCは幅384px、スマホは画面幅いっぱい。
 * 本文だけがスクロールし、上のタイトル行と下の閉じるボタンは常に見える。
 */
export function SidePanel({
  eyebrow,
  title,
  onClose,
  closeLabel = "閉じる",
  ariaLabel,
  closeAriaLabel = "閉じる",
  children,
}: SidePanelProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
      className="fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l border-slate-200 bg-white p-4 text-slate-900 shadow-2xl animate-in slide-in-from-right duration-200 sm:w-96 sm:p-5"
    >
      <div className="flex shrink-0 items-center justify-between border-b pb-3">
        <div className="min-w-0">
          {eyebrow && (
            <h3 className="truncate font-mono text-xs font-bold uppercase text-slate-600">
              {eyebrow}
            </h3>
          )}
          <h2 className="mt-0.5 text-sm font-black text-slate-900">{title}</h2>
        </div>
        <button
          type="button"
          aria-label={closeAriaLabel}
          onClick={onClose}
          className="-mr-2 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center text-sm font-bold text-slate-600 hover:text-slate-800 sm:h-8 sm:w-8"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4 text-xs">
        {children}
      </div>

      <div className="flex shrink-0 justify-end border-t bg-slate-50 p-3">
        <Button
          variant="secondary"
          className="w-full sm:w-auto"
          onClick={onClose}
        >
          {closeLabel}
        </Button>
      </div>
    </div>
  );
}
