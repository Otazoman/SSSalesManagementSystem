"use client";

import type { ReactNode } from "react";
import { Modal } from "./Modal";
import { MessageBanner } from "./MessageBanner";
import { useConfirmDiscard } from "./DiscardGuard";

// REQ-024: マスタ画面の「新規登録・編集・CSV取込」を入れるモーダル(マスタ画面の共通の形)。
// - 一覧の上に入力欄を開く形をやめ、一覧の上に重ねて出す(一覧はモーダルの後ろにそのまま残る)
// - 入力欄を変えた後に ✕・キャンセルで閉じる時は、破棄の確認を出す(Modal の warnOnDiscard)
// - エラーはモーダルの後ろの画面からは見えないため、モーダルの中にも出す
interface MasterFormModalProps {
  title: ReactNode;
  onClose: () => void;
  error?: string;
  /** 中身。キャンセルボタンには、引数の requestClose(破棄の確認つきで閉じる)を渡す */
  children: (requestClose: () => Promise<void>) => ReactNode;
}

function ModalBody({
  onClose,
  error,
  children,
}: Pick<MasterFormModalProps, "onClose" | "error" | "children">) {
  const confirmDiscard = useConfirmDiscard();
  const requestClose = async () => {
    if (await confirmDiscard()) onClose();
  };
  return (
    <>
      <MessageBanner error={error} />
      {/* 入力欄(左)と CSV 取込(右)の2列。狭い画面では縦に並べる */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">{children(requestClose)}</div>
    </>
  );
}

export function MasterFormModal({ title, onClose, error, children }: MasterFormModalProps) {
  return (
    <Modal title={title} size="5xl" onClose={onClose} warnOnDiscard>
      <ModalBody onClose={onClose} error={error}>
        {children}
      </ModalBody>
    </Modal>
  );
}
