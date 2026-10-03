import React from "react";
import { MailSendModal } from "../../../_shared/ui/MailSendModal";

export interface DeliveryNoteContactOption {
  id: string;
  name: string;
  email?: string;
}

interface DeliveryNoteMailModalProps {
  shipmentHeaderId: string;
  recipientEmail: string;
  setRecipientEmail: (v: string) => void;
  partnerContacts: DeliveryNoteContactOption[];
  selectedContactId: string;
  onContactSelect: (contactId: string) => void;
  onClose: () => void;
  onSend: () => void;
  isMailSending: boolean;
}

// 伝票の個別メール送信モーダル。実体は共通部品 MailSendModal(この伝票のタイトル・対象ID・案内文だけを渡す)
export function DeliveryNoteMailModal({
  shipmentHeaderId,
  partnerContacts,
  ...rest
}: DeliveryNoteMailModalProps) {
  return (
    <MailSendModal
      title="✉️ 納品書の個別メール送信"
      targetLabel="対象出庫伝票番号"
      targetId={shipmentHeaderId}
      contacts={partnerContacts}
      documentType="delivery_note"
      partnerWord="取引先"
      manualHint="※取引先担当者マスタから選択、あるいは手入力で指定できます。"
      placeholder="example@customer.com"
      {...rest}
    />
  );
}
