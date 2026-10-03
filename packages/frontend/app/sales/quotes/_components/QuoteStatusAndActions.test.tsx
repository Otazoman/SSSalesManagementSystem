import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuoteStatusAndActions } from "./QuoteStatusAndActions";
import { QuoteRecord } from "../_types";

function baseProps(
  overrides: Partial<Parameters<typeof QuoteStatusAndActions>[0]> = {},
) {
  return {
    memo: "",
    setMemo: vi.fn(),
    status: "DRAFT" as QuoteRecord["status"],
    setStatus: vi.fn(),
    isQuoteWfEnabled: false,
    isSubmitting: false,
    editingId: null,
    onSubmitRevisionUp: vi.fn(),
    onSubmitForApproval: vi.fn(),
    onSubmitApprovedEdit: vi.fn(),
    ...overrides,
  };
}

describe("QuoteStatusAndActions", () => {
  it("承認機能無効時はステータスを直接編集できるセレクトを表示する", () => {
    render(<QuoteStatusAndActions {...baseProps()} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(
      screen.getByText(
        "承認機能が無効なため、ステータスはこの画面から直接変更できます。",
      ),
    ).toBeInTheDocument();
  });

  it("新規登録時(editingId:null)は「マスタ登録を実行」に相当する新規登録ボタンのみ表示する", () => {
    render(<QuoteStatusAndActions {...baseProps()} />);
    expect(screen.getByRole("button", { name: "登録" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /改定登録/ }),
    ).not.toBeInTheDocument();
  });

  it("編集時(editingId有)は上書き保存ボタンとVer.UPボタンを表示する", () => {
    render(<QuoteStatusAndActions {...baseProps({ editingId: "Q-1" })} />);
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /新版として改定登録/ }),
    ).toBeInTheDocument();
  });

  it("承認機能有効・PENDING_APPROVALの場合はロックされ操作ボタンを表示しない", () => {
    render(
      <QuoteStatusAndActions
        {...baseProps({
          isQuoteWfEnabled: true,
          status: "PENDING_APPROVAL",
          editingId: "Q-1",
        })}
      />,
    );
    expect(
      screen.getByText(
        "承認処理中のため、この見積は編集できません。承認完了後に再度お試しください。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "保存" }),
    ).not.toBeInTheDocument();
  });

  it("承認機能有効・DRAFT編集時は承認申請ボタンを表示する", () => {
    render(
      <QuoteStatusAndActions
        {...baseProps({
          isQuoteWfEnabled: true,
          status: "DRAFT",
          editingId: "Q-1",
        })}
      />,
    );
    expect(
      screen.getByRole("button", { name: "🚀 承認を申請する" }),
    ).toBeInTheDocument();
  });

  it("承認機能有効・APPROVED編集時は変更申請ボタン(onSubmitApprovedEdit)を表示する", async () => {
    const onSubmitApprovedEdit = vi.fn();
    render(
      <QuoteStatusAndActions
        {...baseProps({
          isQuoteWfEnabled: true,
          status: "APPROVED",
          editingId: "Q-1",
          onSubmitApprovedEdit,
        })}
      />,
    );
    const button = screen.getByRole("button", {
      name: "🔒 変更を申請する",
    });
    await userEvent.click(button);
    expect(onSubmitApprovedEdit).toHaveBeenCalledTimes(1);
  });

  it("isSubmitting:trueの間は主ボタンが無効になる", () => {
    render(<QuoteStatusAndActions {...baseProps({ isSubmitting: true })} />);
    expect(screen.getByRole("button", { name: "登録中..." })).toBeDisabled();
  });

  it("memo入力でsetMemoを呼ぶ", async () => {
    const setMemo = vi.fn();
    render(<QuoteStatusAndActions {...baseProps({ setMemo })} />);
    await userEvent.type(
      screen.getByPlaceholderText("審査時の注意点など"),
      "A",
    );
    expect(setMemo).toHaveBeenCalledWith("A");
  });

  it("追加要望F: 承認機能有効かつ複数部署所属時のみ申請部署選択を表示する", () => {
    const applicantDepartments = [
      { surrogateId: "dept-a", id: "D001", name: "営業統括部" },
      { surrogateId: "dept-b", id: "D002", name: "人事総務部" },
    ];
    const { rerender } = render(
      <QuoteStatusAndActions
        {...baseProps({
          isQuoteWfEnabled: true,
          status: "DRAFT",
          editingId: "Q-1",
          applicantDepartments,
        })}
      />,
    );
    expect(screen.getByText("申請部署")).toBeInTheDocument();

    rerender(
      <QuoteStatusAndActions
        {...baseProps({
          isQuoteWfEnabled: true,
          status: "DRAFT",
          editingId: "Q-1",
          applicantDepartments: [applicantDepartments[0]],
        })}
      />,
    );
    expect(screen.queryByText("申請部署")).not.toBeInTheDocument();

    rerender(
      <QuoteStatusAndActions
        {...baseProps({
          isQuoteWfEnabled: false,
          status: "DRAFT",
          editingId: "Q-1",
          applicantDepartments,
        })}
      />,
    );
    expect(screen.queryByText("申請部署")).not.toBeInTheDocument();
  });
});
