import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserForm } from "./UserForm";
import { UserRecord, DepartmentRecord, RoleRecord } from "../_types";

const departments: DepartmentRecord[] = [{ id: "d1", name: "開発部" }];
const roles: RoleRecord[] = [{ id: "general_user", name: "一般", description: "" }];

const existingUser: UserRecord = {
  id: "u1",
  employeeNumber: "EMP001",
  name: "山田 太郎",
  email: "yamada@example.com",
  isActive: true,
  relations: [{ departmentId: "d1", departmentName: "開発部", roleId: "general_user", roleName: "一般" }],
};

function baseProps(overrides: Partial<Parameters<typeof UserForm>[0]> = {}) {
  return {
    editingUserId: null,
    users: [existingUser],
    departments,
    roles,
    hasCreate: true,
    hasUpdate: true,
    hasFormPermission: true,
    onSuccess: vi.fn(),
    setError: vi.fn(),
    setMessage: vi.fn(),
    ...overrides,
  };
}

describe("UserForm", () => {
  it("新規登録時は「新規個別ユーザー登録」を表示し、メール送信チェックボックスを表示する", () => {
    render(<UserForm {...baseProps()} />);
    expect(screen.getByText("新規個別ユーザー登録")).toBeInTheDocument();
    expect(screen.getByText(/初期パスワード通知メール/)).toBeInTheDocument();
  });

  it("編集時は「ユーザー情報の編集」を表示し、メール送信チェックボックスは表示しない", () => {
    render(<UserForm {...baseProps({ editingUserId: "u1" })} />);
    expect(screen.getByText("ユーザー情報の編集")).toBeInTheDocument();
    expect(screen.queryByText(/初期パスワード通知メール/)).not.toBeInTheDocument();
  });

  it("配属部署✕権限の行を追加・削除できる", async () => {
    render(<UserForm {...baseProps()} />);
    expect(screen.getAllByText("配属部署を選択").length).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: "＋ 所属・権限を追加" }));
    expect(screen.getAllByText("配属部署を選択").length).toBe(2);

    await userEvent.click(screen.getAllByRole("button", { name: "✕" })[0]);
    expect(screen.getAllByText("配属部署を選択").length).toBe(1);
  });

  it("hasFormPermission:falseの場合は「閲覧専用」バッジを表示し行追加ボタンを表示しない", () => {
    render(<UserForm {...baseProps({ hasFormPermission: false })} />);
    expect(screen.getByText("閲覧専用")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "＋ 所属・権限を追加" })).not.toBeInTheDocument();
  });

  it("編集時は従業員番号入力欄が無効化される", () => {
    render(<UserForm {...baseProps({ editingUserId: "u1" })} />);
    expect(screen.getByPlaceholderText("例: EMP202600")).toBeDisabled();
  });
});
