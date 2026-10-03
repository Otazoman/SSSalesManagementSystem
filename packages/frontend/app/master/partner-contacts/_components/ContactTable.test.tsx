import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContactTable } from "./ContactTable";
import { ContactRecord, PartnerLookup, UserLookup } from "../_types";

const partners: PartnerLookup[] = [
  { id: "P1", name: "取引先A", status: "active" },
  { id: "P2", name: "取引先B(停止中)", status: "suspended" },
];
const users: UserLookup[] = [{ id: "U1", name: "ユーザーA" }];

const contacts: ContactRecord[] = [
  {
    id: "C1",
    customerId: "P1",
    partnerId: "P1",
    contactType: "CUSTOMER_CONTACT",
    internalUserId: null,
    name: "田中太郎",
    email: "tanaka@example.com",
    phone: "03-1111-2222",
    fax: null,
    departmentName: "営業部",
    isEmailTarget: true,
    memo: null,
    status: "active",
  },
  {
    id: "C2",
    customerId: "P1",
    partnerId: "P1",
    contactType: "COMPANY_SALES",
    internalUserId: "U1",
    name: null,
    email: null,
    phone: null,
    fax: null,
    departmentName: null,
    isEmailTarget: false,
    memo: null,
    status: "suspended",
  },
];

function setup(overrides: Partial<Parameters<typeof ContactTable>[0]> = {}) {
  const onEditClick = vi.fn();
  const onDeleteClick = vi.fn();
  const onSuspendClick = vi.fn();
  render(
    <ContactTable
      contacts={contacts}
      partners={partners}
      users={users}
      canUpdate
      canDelete
      onEditClick={onEditClick}
      onDeleteClick={onDeleteClick}
      onSuspendClick={onSuspendClick}
      {...overrides}
    />,
  );
  return { onEditClick, onDeleteClick, onSuspendClick };
}

describe("ContactTable", () => {
  it("取引先名・担当者名・連絡先を表示する", () => {
    setup();
    expect(screen.getAllByText("取引先A").length).toBe(2);
    expect(screen.getByText("田中太郎")).toBeInTheDocument();
    expect(screen.getByText(/tanaka@example.com/)).toBeInTheDocument();
  });

  it("internalUserId指定時は[自社]プレフィックス付きでユーザー名を表示する", () => {
    setup();
    expect(screen.getByText("[自社] ユーザーA")).toBeInTheDocument();
  });

  it("isEmailTarget:trueの場合はシステム通知対象バッジを表示する", () => {
    setup();
    expect(screen.getByText("📧システム通知対象")).toBeInTheDocument();
  });

  it("メールで送る帳票の列に、選択した帳票・すべて・なしを表示する(V-5)", () => {
    setup({
      contacts: [
        { ...contacts[0], id: "D1", documentTypes: ["quote", "billing"] },
        {
          ...contacts[0],
          id: "D2",
          documentTypes: [
            "quote",
            "sales_order",
            "delivery_note",
            "sales_invoice_sale",
            "sales_invoice_return",
            "sales_invoice_discount",
            "sales_invoice_correction",
            "billing",
            "purchase_order",
            "acceptance_inspection",
          ],
        },
        { ...contacts[0], id: "D3", documentTypes: [] },
      ],
    });
    expect(screen.getByText("メールで送る帳票")).toBeInTheDocument();
    expect(screen.getByText("見積書、請求書")).toBeInTheDocument();
    expect(screen.getByText("すべての帳票")).toBeInTheDocument();
    expect(screen.getByText("なし")).toBeInTheDocument();
  });

  it("documentTypesが無い(旧API)場合は、isEmailTargetに従い「すべての帳票」または「なし」と表示する", () => {
    setup();
    expect(screen.getByText("すべての帳票")).toBeInTheDocument();
    expect(screen.getByText("なし")).toBeInTheDocument();
  });

  it("行クリックでonEditClickを呼ぶ", async () => {
    const { onEditClick } = setup();
    await userEvent.click(screen.getByText("田中太郎"));
    expect(onEditClick).toHaveBeenCalledWith(contacts[0]);
  });

  it("suspendedの行は「完全に削除」ボタンでonDeleteClickをidで呼ぶ", async () => {
    const { onDeleteClick } = setup();
    await userEvent.click(screen.getByRole("button", { name: "完全に削除 🗑️" }));
    expect(onDeleteClick).toHaveBeenCalledWith("C2");
  });

  it("紐づく取引先が停止中の場合は「無効」バッジを表示する", () => {
    setup({
      contacts: [{ ...contacts[0], partnerId: "P2" }],
    });
    expect(screen.getByText("無効")).toBeInTheDocument();
  });

  it("空データの場合は空メッセージを表示する", () => {
    setup({ contacts: [] });
    expect(screen.getByText("該当するデータはありません")).toBeInTheDocument();
  });
});
