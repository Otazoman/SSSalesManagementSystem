import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContactForm } from "./ContactForm";
import { PartnerLookup, UserLookup } from "../_types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const partners: PartnerLookup[] = [
  { id: "P1", name: "取引先1", status: "active" },
];
const users: UserLookup[] = [];

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    editingId: null,
    setEditingId: vi.fn(),
    initialValues: null,
    partners,
    users,
    hasFormPermission: true,
    canCreate: true,
    onSuccess: vi.fn(),
    onError: vi.fn(),
    onSync: vi.fn(),
    onImportCsv: vi.fn(),
    onCloseForm: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const editingContact = {
  id: "C-1",
  customerId: "P1",
  partnerId: "P1",
  contactType: "CUSTOMER_CONTACT",
  internalUserId: null,
  name: "山田 太郎",
  email: null,
  phone: null,
  fax: null,
  departmentName: null,
  isEmailTarget: true,
  documentTypes: ["quote"],
  memo: null,
  status: "active",
};

describe("ContactForm: メールで送る帳票(V-5)", () => {
  type RequestBody = {
    documentTypes?: string[];
    payload?: { documentTypes?: string[] };
  };
  function captureCalls() {
    const calls: { url: string; body: RequestBody }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url: url.toString(),
          body: init?.body ? JSON.parse(init.body as string) : {},
        });
        return jsonResponse({ id: "CON-1" });
      }),
    );
    return calls;
  }

  async function fillNewContact() {
    await userEvent.selectOptions(screen.getAllByRole("combobox")[0], "P1");
    await userEvent.type(screen.getByPlaceholderText("山田 太郎"), "山田 太郎");
  }

  it("新規登録の既定はすべての帳票にチェックが入り、そのまま登録するとdocumentTypesに全帳票を送る", async () => {
    const calls = captureCalls();
    render(<ContactForm {...baseProps()} />);
    expect(screen.getByLabelText("見積書")).toBeChecked();
    expect(screen.getByLabelText("検収書")).toBeChecked();

    await fillNewContact();
    await userEvent.click(screen.getByRole("button", { name: "担当者情報を登録" }));
    const register = calls.find((c) => c.url.includes("/api/partner-contacts/register"));
    expect(register!.body.documentTypes).toHaveLength(10);
  });

  it("チェックを外した帳票は送られず、「すべて外す」で空配列になる", async () => {
    const calls = captureCalls();
    render(<ContactForm {...baseProps()} />);
    await fillNewContact();
    await userEvent.click(screen.getByLabelText("見積書"));
    await userEvent.click(screen.getByRole("button", { name: "担当者情報を登録" }));
    let register = calls.find((c) => c.url.includes("/api/partner-contacts/register"));
    expect(register!.body.documentTypes).not.toContain("quote");
    expect(register!.body.documentTypes).toContain("billing");

    calls.length = 0;
    await userEvent.click(screen.getByRole("button", { name: "すべて外す" }));
    await userEvent.click(screen.getByRole("button", { name: "担当者情報を登録" }));
    register = calls.find((c) => c.url.includes("/api/partner-contacts/register"));
    expect(register!.body.documentTypes).toEqual([]);
  });

  it("編集時は登録済みの帳票だけにチェックが入り、変更するとPUTでdocumentTypesを送る", async () => {
    const calls = captureCalls();
    render(
      <ContactForm
        {...baseProps({ editingId: "C-1", initialValues: editingContact })}
      />,
    );
    expect(screen.getByLabelText("見積書")).toBeChecked();
    expect(screen.getByLabelText("請求書")).not.toBeChecked();

    await userEvent.click(screen.getByLabelText("請求書"));
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    const put = calls.find((c) => c.url.includes("/api/partner-contacts/C-1"));
    expect(put!.body.documentTypes).toEqual(["quote", "billing"]);
  });

  it("承認機能ON時は、仮登録には変更前の帳票、承認申請には変更後の帳票を送る", async () => {
    const calls = captureCalls();
    render(
      <ContactForm
        {...baseProps({
          isPartnerContactWfEnabled: true,
          editingId: "C-1",
          initialValues: editingContact,
        })}
      />,
    );
    await userEvent.click(screen.getByLabelText("請求書"));
    await userEvent.click(
      screen.getByRole("button", { name: "🔀 変更を申請する" }),
    );

    const preSave = calls.find((c) => c.url.includes("/api/partner-contacts/C-1"));
    expect(preSave!.body.documentTypes).toEqual(["quote"]);
    const request = calls.find((c) => c.url.includes("/api/approvals/request-update"));
    expect(request!.body.payload?.documentTypes).toEqual(["quote", "billing"]);
  });
});

describe("ContactForm", () => {
  it("回帰: コード自動採番(担当者管理コード空欄)時、仮登録レスポンスのidをrequest-updateのtargetIdに使う", async () => {
    const calledUrls: { url: string; body: any }[] = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      calledUrls.push({
        url: url.toString(),
        body: init?.body ? JSON.parse(init.body as string) : null,
      });
      if (url.toString().includes("/api/partner-contacts/register")) {
        return jsonResponse({ id: "CON-AUTO-1" });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ContactForm
        {...baseProps({ isPartnerContactWfEnabled: true })}
      />,
    );

    // 担当者管理コードは未入力のまま(自動採番依頼)。「対象取引先」selectはDOM上で最初のcombobox。
    await userEvent.selectOptions(screen.getAllByRole("combobox")[0], "P1");
    await userEvent.type(screen.getByPlaceholderText("山田 太郎"), "山田 太郎");
    await userEvent.click(
      screen.getByRole("button", { name: "✨ 承認を申請する" }),
    );

    const request = calledUrls.find((c) => c.url.includes("/api/approvals/request-update"));
    expect(request!.body.targetId).toBe("CON-AUTO-1");
    expect(request!.body.payload.id).toBe("CON-AUTO-1");
  });
});
