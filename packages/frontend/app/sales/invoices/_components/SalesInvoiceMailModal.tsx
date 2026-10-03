import React from "react";
import { PartnerContactOption } from "../_hooks/useSalesInvoiceForm";
import { MailSendModal } from "../../../_shared/ui/MailSendModal";
import { salesInvoiceContactDocumentType } from "../../../_shared/contact-document-types";

interface SalesInvoiceMailModalProps {
  invoiceId: string;
  /** 売上関連書類の内訳(SALE/RETURN/DISCOUNT/CORRECTION)。送る担当者の絞り込みに使う */
  documentType: string;
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
export function SalesInvoiceMailModal({
  invoiceId,
  documentType,
  partnerContacts,
  restrictToRegisteredContacts,
  ...rest
}: SalesInvoiceMailModalProps) {
  return (
    <MailSendModal
      title="🚀 売上計上書の個別メール送信"
      targetLabel="対象売上ID"
      targetId={invoiceId}
      contacts={partnerContacts}
      documentType={salesInvoiceContactDocumentType(documentType)}
      restrictToRegisteredContacts={restrictToRegisteredContacts}
      partnerWord="取引先"
      manualHint="※取引先担当者マスタから選択、あるいは手入力で指定できます。"
      placeholder="example@customer.com"
      {...rest}
    />
  );
}
