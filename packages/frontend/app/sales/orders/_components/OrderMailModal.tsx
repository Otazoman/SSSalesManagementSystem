import React from "react";
import { PartnerContactOption } from "../_hooks/useOrderForm";
import { MailSendModal } from "../../../_shared/ui/MailSendModal";

interface OrderMailModalProps {
  orderId: string;
  recipientEmail: string;
  setRecipientEmail: (v: string) => void;
  partnerContacts: PartnerContactOption[];
  selectedContactId: string;
  restrictToRegisteredContacts?: boolean;
  onContactSelect: (contactId: string) => void;
  onClose: () => void;
  onSend: () => void;
  isMailSending: boolean;
}

// 伝票の個別メール送信モーダル。実体は共通部品 MailSendModal(この伝票のタイトル・対象ID・案内文だけを渡す)
export function OrderMailModal({
  orderId,
  partnerContacts,
  restrictToRegisteredContacts,
  ...rest
}: OrderMailModalProps) {
  return (
    <MailSendModal
      title="🚀 注文請書の個別メール送信"
      targetLabel="対象受注ID"
      targetId={orderId}
      contacts={partnerContacts}
      documentType="sales_order"
      restrictToRegisteredContacts={restrictToRegisteredContacts}
      partnerWord="取引先"
      manualHint="※取引先担当者マスタから選択、あるいは手入力で指定できます。"
      placeholder="example@customer.com"
      {...rest}
    />
  );
}
