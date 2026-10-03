import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MailSendModal, MailContactOption } from "./MailSendModal";

const contacts: MailContactOption[] = [
  {
    id: "C1",
    name: "見積担当",
    email: "quote@example.com",
    documentTypes: ["quote"],
  },
  {
    id: "C2",
    name: "請求担当",
    email: "billing@example.com",
    documentTypes: ["billing"],
  },
  {
    id: "C3",
    name: "全部担当",
    email: "all@example.com",
    documentTypes: ["quote", "billing"],
  },
  { id: "C4", name: "なし担当", email: "none@example.com", documentTypes: [] },
  { id: "C5", name: "旧API担当", email: "legacy@example.com" },
];

function renderModal(
  props: Partial<React.ComponentProps<typeof MailSendModal>> = {},
) {
  render(
    <MailSendModal
      title="個別メール送信"
      targetLabel="対象ID"
      targetId="X-1"
      recipientEmail=""
      setRecipientEmail={vi.fn()}
      contacts={contacts}
      selectedContactId=""
      onContactSelect={vi.fn()}
      onClose={vi.fn()}
      onSend={vi.fn()}
      isMailSending={false}
      {...props}
    />,
  );
}

describe("MailSendModal: 宛先候補の絞り込み(V-5)", () => {
  it("documentTypeを指定すると、その帳票を送る設定の担当者だけが候補になる(設定の無い旧APIの担当者は残る)", () => {
    renderModal({ documentType: "quote" });
    expect(screen.getByText(/見積担当/)).toBeInTheDocument();
    expect(screen.getByText(/全部担当/)).toBeInTheDocument();
    expect(screen.getByText(/旧API担当/)).toBeInTheDocument();
    expect(screen.queryByText(/請求担当/)).not.toBeInTheDocument();
    expect(screen.queryByText(/なし担当/)).not.toBeInTheDocument();
  });

  it("documentTypeを指定しない場合は、絞り込まずにすべて候補にする", () => {
    renderModal();
    expect(screen.getByText(/請求担当/)).toBeInTheDocument();
    expect(screen.getByText(/なし担当/)).toBeInTheDocument();
  });

  it("宛先制限がONで、その帳票を送る担当者がいない場合は、設定を促す案内を表示する", () => {
    renderModal({
      contacts: contacts.filter((c) => c.documentTypes),
      documentType: "purchase_order",
      restrictToRegisteredContacts: true,
    });
    expect(
      screen.getByText(/この帳票を送る設定の連絡先がありません/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("宛先が正しい形になるまで「送信」を押せず、誤りを表示する(BUG-037: 以前は各画面が alert で知らせていた)", () => {
    renderModal({ recipientEmail: "not-an-email" });
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
    expect(screen.getByText("有効な送信先メールアドレスを入力してください")).toBeInTheDocument();
  });

  it("宛先が空の間は「送信」を押せないが、誤りの表示は出さない", () => {
    renderModal({ recipientEmail: "" });
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
    expect(screen.queryByText("有効な送信先メールアドレスを入力してください")).toBeNull();
  });

  it("正しい宛先なら「送信」を押せる", () => {
    renderModal({ recipientEmail: "to@example.com" });
    expect(screen.getByRole("button", { name: "送信" })).not.toBeDisabled();
  });
});
