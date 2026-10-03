import React from "react";
import { PartnerContactOption } from "../_types";
import { MailSendModal } from "../../../_shared/ui/MailSendModal";

interface PurchaseOrderMailModalProps {
  orderId: string;
  recipientEmail: string;
  setRecipientEmail: (v: string) => void;
  supplierContacts: PartnerContactOption[];
  selectedContactId: string;
  restrictToRegisteredContacts?: boolean;
  onContactSelect: (contactId: string) => void;
  onClose: () => void;
  onSend: () => void;
  isMailSending: boolean;
}

// 伝票の個別メール送信モーダル。実体は共通部品 MailSendModal(この伝票のタイトル・対象ID・案内文だけを渡す)
export function PurchaseOrderMailModal({
  orderId,
  supplierContacts,
  restrictToRegisteredContacts,
  ...rest
}: PurchaseOrderMailModalProps) {
  return (
    <MailSendModal
      title="🚀 発注書の個別メール送信"
      targetLabel="対象発注ID"
      targetId={orderId}
      contacts={supplierContacts}
      documentType="purchase_order"
      restrictToRegisteredContacts={restrictToRegisteredContacts}
      partnerWord="仕入先"
      manualHint="※取引先担当者マスタから選択、あるいは手入力で指定できます。"
      placeholder="example@supplier.com"
      {...rest}
    />
  );
}
