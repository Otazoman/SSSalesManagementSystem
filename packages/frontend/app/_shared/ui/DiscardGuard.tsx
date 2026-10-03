"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useConfirm } from "../hooks/use-confirm";

/** 編集を途中でキャンセルするときに出す確認の文言(全画面共通) */
export const DISCARD_CONFIRM_MESSAGE = "保存していない編集を破棄しますか？";

export interface DiscardGuard {
  /** 入力欄を含む要素(フォームの枠・モーダルの本体)に展開する。利用者が入力欄を変更した時点で「未保存の編集あり」になる */
  scopeProps: { onChange: () => void };
  /**
   * キャンセル・閉じる操作の前に呼ぶ。未保存の編集が無ければ true、あれば確認を出し、
   * 「破棄する」なら true、「続ける」なら false を返す(false なら閉じない)。
   * BUG-045: 確認は画面上の表示(ConfirmDialog)で出すため、結果は Promise で返す(`await` して使う)
   */
  confirmDiscard: () => Promise<boolean>;
}

/**
 * 編集のキャンセル時の確認(未保存の編集の破棄)。入力欄の変更(input/select/textarea/checkbox)を検知するだけなので、
 * 画面側の入力状態(useState)には触れない。プログラムによる値の入れ替え(編集対象の読み込みなど)は編集として数えない。
 * @param resetKey この値が変わると「未保存の編集なし」に戻す(フォームを開閉するページは、開閉の状態を渡す)
 */
export function useDiscardGuard(resetKey: unknown = true): DiscardGuard {
  const dirty = useRef(false);
  const confirm = useConfirm();

  useEffect(() => {
    dirty.current = false;
  }, [resetKey]);

  const confirmDiscard = useCallback(async () => {
    if (!dirty.current) return true;
    if (!(await confirm(DISCARD_CONFIRM_MESSAGE, { confirmLabel: "破棄する" }))) return false;
    dirty.current = false;
    return true;
  }, [confirm]);

  return useMemo(
    () => ({
      scopeProps: {
        onChange: () => {
          dirty.current = true;
        },
      },
      confirmDiscard,
    }),
    [confirmDiscard],
  );
}

/** Modal(warnOnDiscard)が中の部品へ渡す確認処理。モーダルの外・確認が不要なモーダルでは null */
export const DiscardGuardContext = createContext<(() => Promise<boolean>) | null>(null);

const ALWAYS_OK = async () => true;

/** モーダルの中のキャンセルボタン用。確認が不要な場所では常に true(=そのまま閉じてよい)を返す */
export function useConfirmDiscard(): () => Promise<boolean> {
  return useContext(DiscardGuardContext) ?? ALWAYS_OK;
}

/**
 * モーダルの中に置く「キャンセル」ボタン(見た目は className で指定)。
 * Modal(warnOnDiscard)の中で、未保存の編集があれば確認してから onCancel を呼ぶ。
 */
export function DiscardCancelButton({
  onCancel,
  className,
  children = "キャンセル",
}: {
  onCancel: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const confirmDiscard = useConfirmDiscard();
  return (
    <button
      type="button"
      onClick={async () => {
        if (await confirmDiscard()) onCancel();
      }}
      className={className}
    >
      {children}
    </button>
  );
}
