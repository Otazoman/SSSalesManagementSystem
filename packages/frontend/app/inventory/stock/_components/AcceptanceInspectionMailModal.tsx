import React from "react";
import { MailSendModal } from "../../../_shared/ui/MailSendModal";

export interface AcceptanceInspectionContactOption {
  id: string;
  name: string;
  email?: string;
}

interface AcceptanceInspectionMailModalProps {
  receiptId: string;
  recipientEmail: string;
  setRecipientEmail: (v: string) => void;
  partnerContacts: AcceptanceInspectionContactOption[];
  selectedContactId: string;
  onContactSelect: (contactId: string) => void;
  onClose: () => void;
  onSend: () => void;
  isMailSending: boolean;
}

// 伝票の個別メール送信モーダル。実体は共通部品 MailSendModal(この伝票のタイトル・対象ID・案内文だけを渡す)
export function AcceptanceInspectionMailModal({
  receiptId,
  partnerContacts,
  ...rest
}: AcceptanceInspectionMailModalProps) {
  return (
    <MailSendModal
      title="✉️ 検収書の個別メール送信"
      targetLabel="対象入庫伝票番号"
      targetId={receiptId}
      contacts={partnerContacts}
      documentType="acceptance_inspection"
      partnerWord="仕入先"
      manualHint="※取引先担当者マスタから選択、あるいは手入力で指定できます。"
      placeholder="example@supplier.com"
      {...rest}
    />
  );
}
