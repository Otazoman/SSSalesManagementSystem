"use client";

import { useCallback, useState, type ReactNode } from "react";
import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from "../hooks/use-confirm";
import { Modal } from "./Modal";
import { Button } from "./Button";

interface PendingConfirm {
  message: string;
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

/**
 * BUG-045: 確認の表示(ブラウザの confirm の代わり)。アプリ全体を囲み、表示を1つだけ持つ(app/layout.tsx)。
 * 画面・hook からは useConfirm()(_shared/hooks/use-confirm.ts)で使う。
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (message, options = {}) =>
      new Promise<boolean>((resolve) => {
        setPending({ message, options, resolve });
      }),
    [],
  );

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Modal
          title="確認"
          size="sm"
          onClose={() => close(false)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => close(false)}>
                キャンセル
              </Button>
              <Button autoFocus onClick={() => close(true)}>
                {pending.options.confirmLabel ?? "OK"}
              </Button>
            </div>
          }
        >
          <p className="whitespace-pre-line break-words text-sm font-medium text-slate-800">{pending.message}</p>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
