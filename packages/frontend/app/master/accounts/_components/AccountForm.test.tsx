import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountForm } from "./AccountForm";

function baseProps() {
  return {
    editingAccount: null,
    onCancelEdit: vi.fn(),
    onSubmit: vi.fn(async () => {}),
    canCreate: true,
    canUpdate: true,
  };
}

describe("AccountForm", () => {
  it("新規登録時は「新規個別勘定科目登録」の見出しと登録ボタンを表示する", () => {
    render(<AccountForm {...baseProps()} />);
    expect(screen.getByText("新規個別勘定科目登録")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登録" })).toBeInTheDocument();
  });

  it("編集時は入力欄へ既存値を反映し、コード欄を無効化する", () => {
    render(
      <AccountForm
        {...baseProps()}
        editingAccount={{
          code: "1111",
          name: "現金",
          externalMappingCode: "OB_1111",
          status: "active",
          memo: "メモ",
        }}
      />,
    );
    expect(screen.getByDisplayValue("現金")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1111")).toBeDisabled();
  });

  it("承認ワークフロー有効時のステータスセレクトは無効化される", () => {
    render(
      <AccountForm
        {...baseProps()}
        isAccountWfEnabled
        editingAccount={{
          code: "1111",
          name: "現金",
          externalMappingCode: null,
          status: "active",
          memo: null,
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "🔀 変更を申請する" }),
    ).toBeInTheDocument();
  });

  it("isLocked:trueの場合はロック警告文を表示する", () => {
    render(
      <AccountForm
        {...baseProps()}
        isLocked
        editingAccount={{
          code: "1111",
          name: "現金",
          externalMappingCode: null,
          status: "temporary",
          memo: null,
        }}
      />,
    );
    expect(
      screen.getByText(
        /承認または差戻しが決定されるまで上書き・再編集行為は完全ロックされます/,
      ),
    ).toBeInTheDocument();
  });

  it("フォーム送信でonSubmitへ入力値を渡す", async () => {
    const props = baseProps();
    render(<AccountForm {...props} />);
    await userEvent.type(screen.getByPlaceholderText("例: 1111"), "1111");
    await userEvent.type(
      screen.getByPlaceholderText("例: 商品原材料高"),
      "現金",
    );
    await userEvent.click(screen.getByRole("button", { name: "登録" }));

    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ code: "1111", name: "現金" }),
    );
  });

  it("canCreate:falseの新規登録では閲覧専用バッジを表示し登録ボタンを無効化する", () => {
    render(<AccountForm {...baseProps()} canCreate={false} />);
    expect(screen.getByText("閲覧専用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登録" })).toBeDisabled();
  });
});
