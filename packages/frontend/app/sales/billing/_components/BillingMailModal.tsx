import React from "react";
import { PartnerContactOption } from "../_hooks/useBillingActions";
import { MailSendModal } from "../../../_shared/ui/MailSendModal";

interface BillingMailModalProps {
  billingHeaderId: string;
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
export function BillingMailModal({
  billingHeaderId,
  partnerContacts,
  restrictToRegisteredContacts,
  ...rest
}: BillingMailModalProps) {
  return (
    <MailSendModal
      title="📧 請求書の送信"
      targetLabel="対象請求ID"
      targetId={billingHeaderId}
      contacts={partnerContacts}
      documentType="billing"
      restrictToRegisteredContacts={restrictToRegisteredContacts}
      partnerWord="取引先"
      manualHint="※取引先担当者マスタから選択、あるいは手入力で指定できます。"
      placeholder="example@customer.com"
      {...rest}
    />
  );
}
