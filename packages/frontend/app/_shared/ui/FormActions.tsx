import type { ReactNode } from "react";
import { Button } from "./Button";
import { useConfirmDiscard } from "./DiscardGuard";

interface FormActionsProps {
  /** create: 新規の入力確定=「登録」 / edit: 既存の変更=「保存」 / view: 参照のみ=「閉じる」だけ */
  mode: "create" | "edit" | "view";
  /**
   * キャンセル(create/edit)・閉じる(view)を押した時。省略するとボタンを出さない。
   * 編集を確認するモーダル(Modal の warnOnDiscard)の中では、未保存の編集があれば
   * 「保存していない編集を破棄しますか？」を確認してから呼ばれる(閉じる=view では確認しない) */
  onCancel?: () => void;
  /** 送信中(ラベルが「登録中...」「保存中...」になり、押せなくなる) */
  loading?: boolean;
  submitDisabled?: boolean;
  /** 確定ボタンの文言(既定は mode に応じて「登録」「保存」)。「送信」など操作が別の時だけ指定する */
  submitLabel?: string;
  /** 確定ボタンをフォームの外(Modalのfooterなど)に置く時の、対象フォームのid */
  formId?: string;
  /** フォーム外で使う時の確定ボタンの処理(フォーム内なら不要。submitイベントで処理される) */
  onSubmit?: () => void;
  /** 左側に置く追加の操作(例: 削除ボタン) */
  extra?: ReactNode;
}

/**
 * フォーム・モーダルの下部の操作ボタン(統一の並び・文言)。
 * PC: 右寄せで[キャンセル][登録/保存](追加の操作は左端)。スマホ: 全幅で縦積みにし、確定ボタンを上に置く。
 */
export function FormActions({
  mode,
  onCancel,
  loading = false,
  submitDisabled = false,
  submitLabel,
  formId,
  onSubmit,
  extra,
}: FormActionsProps) {
  const label = submitLabel ?? (mode === "create" ? "登録" : "保存");
  const confirmDiscard = useConfirmDiscard();
  const handleCancel = async () => {
    if (mode === "view" || (await confirmDiscard())) onCancel?.();
  };
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
      {extra && <div className="sm:mr-auto">{extra}</div>}
      {onCancel && (
        <Button
          variant="secondary"
          className="w-full sm:w-auto"
          onClick={handleCancel}
        >
          {mode === "view" ? "閉じる" : "キャンセル"}
        </Button>
      )}
      {mode !== "view" && (
        <Button
          variant="primary"
          type={onSubmit ? "button" : "submit"}
          form={formId}
          onClick={onSubmit}
          disabled={loading || submitDisabled}
          className="w-full sm:w-auto"
        >
          {loading ? `${label}中...` : label}
        </Button>
      )}
    </div>
  );
}
