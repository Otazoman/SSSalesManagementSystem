import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MatrixTable } from "./MatrixTable";
import { RoleRecord, PermissionRecord, ScreenOption, ActionOption } from "../_types";

const roles: RoleRecord[] = [
  { id: "admin", name: "管理者" },
  { id: "general_user", name: "一般ユーザー" },
];
const screenOptions: ScreenOption[] = [
  { resource: "master_units", name: "単位マスタ", category: "master" },
];
const dynamicHeaderActions: ActionOption[] = [
  { key: "read", label: "閲覧 (R)" },
  { key: "create", label: "登録 (C)" },
];
const permissions: PermissionRecord[] = [
  { id: "master_units:read", resource: "master_units", action: "read", name: "", description: null },
  { id: "master_units:create", resource: "master_units", action: "create", name: "", description: null },
];

function baseProps(overrides: Partial<Parameters<typeof MatrixTable>[0]> = {}) {
  return {
    roles,
    permissions,
    screenOptions,
    dynamicHeaderActions,
    selectedRoleId: "general_user",
    checkedPermissionIds: ["master_units:read"],
    canUpdate: true,
    isSaving: false,
    onRoleChange: vi.fn(),
    onSave: vi.fn(),
    onToggleColumn: vi.fn(),
    onToggleRow: vi.fn(),
    onCellChange: vi.fn(),
    ...overrides,
  };
}

describe("MatrixTable", () => {
  it("adminロールをロール切替セレクトの選択肢から除外する", () => {
    render(<MatrixTable {...baseProps()} />);
    expect(screen.queryByRole("option", { name: "管理者" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "一般ユーザー" })).toBeInTheDocument();
  });

  it("画面名と各アクション列のチェック状態を表示する", () => {
    render(<MatrixTable {...baseProps()} />);
    expect(screen.getByText("単位マスタ")).toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox");
    // 一括適用行 x2 + 単位マスタ行(read, create, 行一括) x3 = 5個
    expect(checkboxes.length).toBe(5);
  });

  it("権限レコードが存在しないアクションは「—」を表示しチェックボックスを出さない", () => {
    render(
      <MatrixTable
        {...baseProps({
          dynamicHeaderActions: [...dynamicHeaderActions, { key: "delete", label: "削除 (D)" }],
        })}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("セルのチェックボックスクリックでonCellChangeを呼ぶ", async () => {
    const onCellChange = vi.fn();
    render(<MatrixTable {...baseProps({ onCellChange })} />);
    const checkboxes = screen.getAllByRole("checkbox");
    // インデックス2,3が単位マスタ行(read, create)
    await userEvent.click(checkboxes[2]);
    expect(onCellChange).toHaveBeenCalledWith("master_units:read");
  });

  it("一括適用行のチェックボックスクリックでonToggleColumnを呼ぶ", async () => {
    const onToggleColumn = vi.fn();
    render(<MatrixTable {...baseProps({ onToggleColumn })} />);
    const checkboxes = screen.getAllByRole("checkbox");
    await userEvent.click(checkboxes[0]);
    expect(onToggleColumn).toHaveBeenCalledWith("read");
  });

  it("行一括チェックボックスクリックでonToggleRowをresourceKeyで呼ぶ", async () => {
    const onToggleRow = vi.fn();
    render(<MatrixTable {...baseProps({ onToggleRow })} />);
    const checkboxes = screen.getAllByRole("checkbox");
    // インデックス4が単位マスタ行の行一括チェックボックス
    await userEvent.click(checkboxes[4]);
    expect(onToggleRow).toHaveBeenCalledWith("master_units");
  });

  it("保存ボタンクリックでonSaveを呼ぶ", async () => {
    const onSave = vi.fn();
    render(<MatrixTable {...baseProps({ onSave })} />);
    await userEvent.click(screen.getByRole("button", { name: /マトリクス設定を保存する/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("isSaving:trueの場合は保存ボタンが無効化され文言が変わる", () => {
    render(<MatrixTable {...baseProps({ isSaving: true })} />);
    expect(screen.getByRole("button", { name: "同期書き込み中..." })).toBeDisabled();
  });

  it("canUpdate:falseの場合はチェックボックスが無効化される", () => {
    render(<MatrixTable {...baseProps({ canUpdate: false })} />);
    screen.getAllByRole("checkbox").forEach((cb) => expect(cb).toBeDisabled());
  });
});
