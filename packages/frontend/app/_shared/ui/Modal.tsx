"use client";

import type { ReactNode } from "react";
import { DiscardGuardContext, useDiscardGuard } from "./DiscardGuard";

/** パネルの最大幅(Tailwindのmax-w-〇〇と同名。既存モーダルの値をそのまま指定できる) */
const MAX_WIDTH = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
} as const;

interface ModalProps {
  title: ReactNode;
  onClose: () => void;
  size?: keyof typeof MAX_WIDTH;
  /** 下部の操作ボタン行(通常は <FormActions />)。省略すると出さない */
  footer?: ReactNode;
  /**
   * 入力・編集を行うモーダルで true にする。入力欄を変更した後に、✕・キャンセルで閉じようとすると
   * 「保存していない編集を破棄しますか？」を確認する(一覧から選ぶだけのモーダルなどでは指定しない)
   */
  warnOnDiscard?: boolean;
  children: ReactNode;
}

/**
 * モーダル共通部品(背景+パネル+タイトル行+✕)。画面ごとの差は size / footer で吸収する。
 * スマホでは余白を詰め、パネルの高さを画面内(90dvh)に収めて本文だけスクロールさせる(sm以上の見た目は従来どおり)。
 */
export function Modal({
  title,
  onClose,
  size = "md",
  footer,
  warnOnDiscard = false,
  children,
}: ModalProps) {
  const guard = useDiscardGuard();
  const requestClose = async () => {
    if (!warnOnDiscard || (await guard.confirmDiscard())) onClose();
  };
  return (
    <DiscardGuardContext.Provider
      value={warnOnDiscard ? guard.confirmDiscard : null}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-2 backdrop-blur-xs sm:p-4"
      >
        <div
          {...(warnOnDiscard ? guard.scopeProps : {})}
          className={`flex max-h-[90dvh] w-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-xl sm:p-5 ${MAX_WIDTH[size]}`}
        >
          <div className="flex shrink-0 items-center justify-between border-b pb-2">
            <h4 className="text-sm font-black text-slate-800">{title}</h4>
            <button
              type="button"
              aria-label="ダイアログを閉じる"
              onClick={requestClose}
              className="-mr-2 flex h-11 w-11 items-center justify-center font-bold text-slate-600 hover:text-slate-800 sm:h-8 sm:w-8"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pt-3 text-xs text-slate-800">
            {children}
          </div>
          {footer && <div className="shrink-0 border-t pt-3">{footer}</div>}
        </div>
      </div>
    </DiscardGuardContext.Provider>
  );
}
