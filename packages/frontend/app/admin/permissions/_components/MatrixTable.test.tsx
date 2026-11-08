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
    onSetColumn: vi.fn(),
    onSetRow: vi.fn(),
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
    // BUG-082: 一括操作はボタンのため、チェックボックスは単位マスタ行の read, create の2個だけ
    expect(checkboxes.length).toBe(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it("BUG-082: 行の全権限がONでも、一括操作はチェック状態を表示しない(ボタンのみ)", () => {
    render(
      <MatrixTable
        {...baseProps({ checkedPermissionIds: ["master_units:read", "master_units:create"] })}
      />,
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "「単位マスタ」のすべての権限をすべてON" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "「単位マスタ」のすべての権限をすべてOFF" })).toBeInTheDocument();
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
    // インデックス0,1が単位マスタ行(read, create)
    await userEvent.click(checkboxes[0]);
    expect(onCellChange).toHaveBeenCalledWith("master_units:read");
  });

  it("一括適用行の「すべてON」「すべてOFF」でonSetColumnをアクションとON/OFFで呼ぶ", async () => {
    const onSetColumn = vi.fn();
    render(<MatrixTable {...baseProps({ onSetColumn })} />);
    await userEvent.click(screen.getByRole("button", { name: "すべての画面の「閲覧 (R)」をすべてON" }));
    expect(onSetColumn).toHaveBeenCalledWith("read", true);
    await userEvent.click(screen.getByRole("button", { name: "すべての画面の「閲覧 (R)」をすべてOFF" }));
    expect(onSetColumn).toHaveBeenCalledWith("read", false);
  });

  it("行一括の「すべてON」「すべてOFF」でonSetRowをresourceKeyとON/OFFで呼ぶ", async () => {
    const onSetRow = vi.fn();
    render(<MatrixTable {...baseProps({ onSetRow })} />);
    await userEvent.click(screen.getByRole("button", { name: "「単位マスタ」のすべての権限をすべてON" }));
    expect(onSetRow).toHaveBeenCalledWith("master_units", true);
    await userEvent.click(screen.getByRole("button", { name: "「単位マスタ」のすべての権限をすべてOFF" }));
    expect(onSetRow).toHaveBeenCalledWith("master_units", false);
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

  it("canUpdate:falseの場合はチェックボックスと一括操作のボタンが無効化される", () => {
    render(<MatrixTable {...baseProps({ canUpdate: false })} />);
    screen.getAllByRole("checkbox").forEach((cb) => expect(cb).toBeDisabled());
    screen
      .getAllByRole("button", { name: /すべて(ON|OFF)$/ })
      .forEach((button) => expect(button).toBeDisabled());
  });
});
