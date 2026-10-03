import { createContext, useContext } from "react";

export interface ConfirmOptions {
  /** 実行する側のボタンの文言(既定は「OK」) */
  confirmLabel?: string;
}

export type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

/** ConfirmProvider(_shared/ui/ConfirmDialog.tsx)が値を入れる */
export const ConfirmContext = createContext<ConfirmFn | null>(null);

// ConfirmProvider の外(単体のテストなど)では、ブラウザの確認を使う
const browserConfirm: ConfirmFn = async (message) => window.confirm(message);

/**
 * BUG-045: 削除などの確認を、ブラウザの confirm ではなく画面上の表示で出す。
 * `const confirm = useConfirm();` として `if (!(await confirm("削除しますか？"))) return;` のように使う。
 */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext) ?? browserConfirm;
}
