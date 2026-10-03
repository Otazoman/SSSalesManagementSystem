import React from "react";
import { PartnerContactOption } from "../_hooks/useQuoteForm";
import { MailSendModal } from "../../../_shared/ui/MailSendModal";

interface QuoteMailModalProps {
  quoteId: string;
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
export function QuoteMailModal({
  quoteId,
  partnerContacts,
  restrictToRegisteredContacts,
  ...rest
}: QuoteMailModalProps) {
  return (
    <MailSendModal
      title="🚀 見積書の個別メール送信"
      targetLabel="対象見積ID"
      targetId={quoteId}
      contacts={partnerContacts}
      documentType="quote"
      restrictToRegisteredContacts={restrictToRegisteredContacts}
      partnerWord="取引先"
      manualHint="※取引先担当者マスタから選択、あるいは手入力で指定できます。"
      placeholder="example@customer.com"
      {...rest}
    />
  );
}
