"use client";

import { useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { MailSendModal, type MailContactOption } from "../../../_shared/ui/MailSendModal";
import { apiFetch, apiFetchShared } from "../../../_shared/hooks/use-api-fetch";

// REQ-012: 入荷指示書・出荷指示書の「メール送信」。以前は PDF の発行と同時に倉庫の連絡先へ自動で送っていた。
// 納品書と同じく、宛先(倉庫の登録済み連絡先から選ぶか手入力)を確かめてから送る。BUG-113: 宛先の制限は見積・受注・発注と同じ会社設定に従う
const CONFIG = {
  receipt: { title: "✉️ 入荷指示書の個別メール送信", api: "/api/receipt-instructions", documentType: "receipt_instruction" },
  shipment: { title: "✉️ 出荷指示書の個別メール送信", api: "/api/shipment-instructions", documentType: "shipment_instruction" },
} as const;

interface InstructionMailButtonProps {
  kind: "receipt" | "shipment";
  instructionId: string;
  warehouseId: string;
  onResult: (result: { message?: string; error?: string }) => void;
}

export function InstructionMailButton({ kind, instructionId, warehouseId, onResult }: InstructionMailButtonProps) {
  const config = CONFIG[kind];
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<MailContactOption[]>([]);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [sending, setSending] = useState(false);

  // BUG-113: 見積・受注・発注と同じく、会社設定「ダウンロードの宛先を登録済みの担当者に限る」が ON の時は、倉庫マスタの担当者からだけ選ぶ
  const [restrictToRegisteredContacts, setRestrictToRegisteredContacts] = useState(false);

  const handleOpen = async () => {
    setRecipientEmail("");
    setSelectedContactId("");
    setContacts([]);
    setOpen(true);
    apiFetchShared<{ is_otp_download_restricted_to_contacts?: boolean }>("/api/company-settings")
      .then((data) => setRestrictToRegisteredContacts(data.is_otp_download_restricted_to_contacts === true))
      .catch(() => setRestrictToRegisteredContacts(false));
    try {
      const data = await apiFetch<MailContactOption[] | { data: MailContactOption[] }>(
        `/api/warehouse-contacts?warehouseId=${encodeURIComponent(warehouseId)}`,
      );
      setContacts(Array.isArray(data) ? data : data.data || []);
    } catch (err) {
      console.error("倉庫の連絡先の取得に失敗しました", err);
    }
  };

  const handleContactSelect = (contactId: string) => {
    setSelectedContactId(contactId);
    const contact = contacts.find((c) => c.id === contactId);
    if (contact?.email) setRecipientEmail(contact.email);
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const result = await apiFetch<{ message?: string }>(`${config.api}/${encodeURIComponent(instructionId)}/send-email`, {
        method: "POST",
        json: { recipientEmail },
        defaultErrorMessage: "メールの送信に失敗しました",
      });
      onResult({ message: result.message || "メールの送信を予約しました" });
      setOpen(false);
    } catch (err) {
      onResult({ error: err instanceof Error ? err.message : "メールの送信に失敗しました" });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Button size="sm" onClick={() => void handleOpen()}>
        ✉️ メール送信
      </Button>
      {open && (
        <MailSendModal
          title={config.title}
          targetLabel="対象の指示書"
          targetId={instructionId}
          recipientEmail={recipientEmail}
          setRecipientEmail={setRecipientEmail}
          contacts={contacts}
          documentType={config.documentType}
          selectedContactId={selectedContactId}
          onContactSelect={handleContactSelect}
          partnerWord="倉庫"
          restrictToRegisteredContacts={restrictToRegisteredContacts}
          manualHint="※倉庫の連絡先から選択、あるいは手入力で指定できます。"
          placeholder="example@warehouse.com"
          onClose={() => setOpen(false)}
          onSend={() => void handleSend()}
          isMailSending={sending}
        />
      )}
    </>
  );
}
