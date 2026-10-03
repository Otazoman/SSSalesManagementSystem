import React from "react";
import { Modal } from "./Modal";
import { FormActions } from "./FormActions";
import { FormField, formFieldInputClass } from "./FormField";
import { filterContactsByDocumentType } from "../contact-document-types";

export interface MailContactOption {
  id: string;
  name: string;
  department?: string | null;
  email?: string | null;
  /** メールで送る帳票(V-5)。無い場合(旧API)は絞り込まない */
  documentTypes?: string[];
}

interface MailSendModalProps {
  /** 例: "🚀 見積書の個別メール送信" */
  title: string;
  /** 例: "対象見積ID" */
  targetLabel: string;
  targetId: string;
  recipientEmail: string;
  setRecipientEmail: (v: string) => void;
  contacts: MailContactOption[];
  /**
   * 送る帳票の種別(_shared/contact-document-types.ts のキー)。指定すると、その帳票を送る設定の担当者だけを
   * 候補にする(V-5。バックエンドの宛先・OTP宛先の判定と同じ条件)
   */
  documentType?: string;
  selectedContactId: string;
  onContactSelect: (contactId: string) => void;
  /** OTPダウンロード宛先制限(連絡先マスタからの選択のみ許可)が有効か */
  restrictToRegisteredContacts?: boolean;
  /** 連絡先が無い時の案内に入れる呼び名(例: 取引先 / 仕入先) */
  partnerWord?: string;
  /** 手入力できる場合の補足(例: "※連絡先マスタから選択、あるいは手入力で指定できます。") */
  manualHint?: string;
  placeholder?: string;
  onClose: () => void;
  onSend: () => void;
  isMailSending: boolean;
}

/**
 * 伝票の個別メール送信モーダルの共通部品(見積・受注・売上・請求・発注・納品書・検収書)。
 * 伝票ごとの違い(タイトル・対象IDの名称・案内文)は props で渡す。
 */
export function MailSendModal({
  title,
  targetLabel,
  targetId,
  recipientEmail,
  setRecipientEmail,
  contacts: allContacts,
  documentType,
  selectedContactId,
  onContactSelect,
  restrictToRegisteredContacts = false,
  partnerWord = "取引先",
  manualHint = "※取引先担当者マスタから選択、あるいは手入力で指定できます。",
  placeholder = "example@customer.com",
  onClose,
  onSend,
  isMailSending,
}: MailSendModalProps) {
  const contacts = documentType
    ? filterContactsByDocumentType(allContacts, documentType)
    : allContacts;
  const hasContacts = contacts.length > 0;
  // BUG-037: 宛先が正しい形になるまで「送信」を押せないようにする(以前は各画面が alert で知らせていた)
  const isValidEmail = /^[^\s@]+@[^\s@]+$/.test(recipientEmail.trim());
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <FormActions
          mode="create"
          submitLabel="送信"
          onCancel={onClose}
          onSubmit={onSend}
          loading={isMailSending}
          submitDisabled={!isValidEmail}
        />
      }
    >
      <FormField label={targetLabel}>
        <input
          type="text"
          disabled
          value={targetId}
          className={`${formFieldInputClass} font-mono`}
        />
      </FormField>

      {/* 取引先担当者マスタからの選択。宛先制限がONの場合は必須の選択手段になる */}
      {hasContacts && (
        <FormField
          label={`📇 取引先担当者マスタから選択${restrictToRegisteredContacts ? " *" : "(任意)"}`}
        >
          <select
            required={restrictToRegisteredContacts}
            value={selectedContactId}
            onChange={(e) => onContactSelect(e.target.value)}
            className={`${formFieldInputClass} cursor-pointer`}
          >
            <option value="">
              -- 連絡先を選択するとメールアドレスが自動反映されます --
            </option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.department ? `(${c.department})` : ""}{" "}
                {c.email ? `<${c.email}>` : "(メール未登録)"}
              </option>
            ))}
          </select>
        </FormField>
      )}

      {restrictToRegisteredContacts && !hasContacts && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold rounded-lg">
          ⚠️ この{partnerWord}
          には、この帳票を送る設定の連絡先がありません。OTPダウンロード宛先制限が有効なため、取引先担当者マスタで担当者の「メールで送る帳票」を設定してから送信してください。
        </div>
      )}

      <FormField
        label="送信先メールアドレス *"
        hint={
          restrictToRegisteredContacts
            ? "※OTPダウンロード宛先制限が有効なため、上の取引先担当者マスタからの選択のみで指定できます(手入力不可)。"
            : manualHint
        }
      >
        <input
          type="email"
          required
          readOnly={restrictToRegisteredContacts}
          placeholder={placeholder}
          value={recipientEmail}
          onChange={(e) =>
            !restrictToRegisteredContacts && setRecipientEmail(e.target.value)
          }
          className={`${formFieldInputClass} ${restrictToRegisteredContacts ? "cursor-not-allowed" : ""}`}
        />
        {recipientEmail.trim() !== "" && !isValidEmail && (
          <p className="mt-1 text-[11px] font-bold text-red-700">
            有効な送信先メールアドレスを入力してください
          </p>
        )}
      </FormField>
    </Modal>
  );
}
