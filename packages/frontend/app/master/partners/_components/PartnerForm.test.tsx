import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PartnerForm from "./PartnerForm";
import { initialFormState } from "../_hooks/usePartnerForm";

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    editingId: null,
    formData: initialFormState,
    isSubmitting: false,
    isFormEditable: true,
    isPartnerWfEnabled: false,
    isMasterCurrentlyLocked: false,
    extUrlInput: "",
    setExtUrlInput: vi.fn(),
    extTitleInput: "",
    setExtTitleInput: vi.fn(),
    handleInputChange: vi.fn(),
    handleSubmit: vi.fn((e: React.SyntheticEvent) => e.preventDefault()),
    handleFileUpload: vi.fn(),
    handleAddExternalLink: vi.fn(),
    handleRemoveAttachment: vi.fn(),
    handleAddBankAccount: vi.fn(),
    handleRemoveBankAccount: vi.fn(),
    handleBankAccountChange: vi.fn(),
    ...overrides,
  };
}

describe("PartnerForm", () => {
  it("新規登録時は「新規個別取引先登録」見出しと登録ボタンを表示する", () => {
    render(<PartnerForm {...baseProps()} />);
    expect(screen.getByText("新規個別取引先登録")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登録" })).toBeInTheDocument();
  });

  it("編集時(承認ワークフロー無効)は「変更を直接保存」ボタンを表示する", () => {
    render(<PartnerForm {...baseProps({ editingId: "CUST-001" })} />);
    expect(screen.getByText("取引先情報の編集")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
  });

  it("承認ワークフロー有効時の新規登録は申請ボタン文言になる", () => {
    render(<PartnerForm {...baseProps({ isPartnerWfEnabled: true })} />);
    expect(
      screen.getByRole("button", { name: "✨ 承認を申請する" }),
    ).toBeInTheDocument();
  });

  it("isFormEditable:falseの場合は「閲覧専用」バッジを表示しボタンを無効化する", () => {
    render(<PartnerForm {...baseProps({ isFormEditable: false })} />);
    expect(screen.getByText("閲覧専用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登録" })).toBeDisabled();
  });

  it("isMasterCurrentlyLocked:trueの場合はロック警告文を表示しfieldsetを無効化する", () => {
    const { container } = render(
      <PartnerForm
        {...baseProps({ editingId: "CUST-001", isMasterCurrentlyLocked: true })}
      />,
    );
    expect(
      screen.getByText(
        /承認または差戻しが決定されるまで上書き・再編集行為は完全ロックされます/,
      ),
    ).toBeInTheDocument();
    expect(container.querySelector("fieldset")).toBeDisabled();
  });

  it("取引先コード入力でhandleInputChangeが呼ばれる", async () => {
    const props = baseProps();
    render(<PartnerForm {...props} />);
    await userEvent.type(
      screen.getByPlaceholderText("例: CUST-001(空欄で自動採番)"),
      "C",
    );
    expect(props.handleInputChange).toHaveBeenCalledWith("id", "C");
  });

  it("編集時は取引先コード欄が無効化される", () => {
    render(<PartnerForm {...baseProps({ editingId: "CUST-001" })} />);
    expect(
      screen.getByPlaceholderText("例: CUST-001(空欄で自動採番)"),
    ).toBeDisabled();
  });

  it("フォーム送信でhandleSubmitが呼ばれる(required項目を満たした状態)", async () => {
    const props = baseProps({
      formData: { ...initialFormState, id: "CUST-001", name: "株式会社テスト" },
    });
    render(<PartnerForm {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "登録" }));
    expect(props.handleSubmit).toHaveBeenCalledTimes(1);
  });
});
