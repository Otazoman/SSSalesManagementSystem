import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoleTable } from "./RoleTable";
import { RoleRecord } from "../_types";

const roles: RoleRecord[] = [
  { id: "admin", name: "管理者", description: null, createdAt: "" },
  { id: "finance_checker", name: "経理検収担当", description: "経理業務", createdAt: "" },
];

function setup(overrides: Partial<Parameters<typeof RoleTable>[0]> = {}) {
  const onSelectRow = vi.fn();
  const onDelete = vi.fn();
  const setError = vi.fn();
  render(
    <RoleTable
      roles={roles}
      canUpdate
      canDelete
      onSelectRow={onSelectRow}
      onDelete={onDelete}
      setError={setError}
      {...overrides}
    />,
  );
  return { onSelectRow, onDelete, setError };
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

describe("RoleTable", () => {
  it("システム組み込みロールにはSYSTEMバッジを表示する", () => {
    setup();
    expect(screen.getByText("SYSTEM")).toBeInTheDocument();
  });

  it("行クリックでonSelectRowを呼ぶ", async () => {
    const { onSelectRow } = setup();
    await userEvent.click(screen.getByText("経理検収担当"));
    expect(onSelectRow).toHaveBeenCalledWith(roles[1]);
  });

  it("システム組み込みロール(admin)の削除ボタンは無効", () => {
    setup();
    const deleteButtons = screen.getAllByRole("button", { name: "削除" });
    expect(deleteButtons[0]).toBeDisabled();
  });

  it("非組み込みロールの削除は確認後onDeleteを呼ぶ", async () => {
    const { onDelete } = setup();
    const deleteButtons = screen.getAllByRole("button", { name: "削除" });
    await userEvent.click(deleteButtons[1]);
    expect(onDelete).toHaveBeenCalledWith("finance_checker");
  });

  it("確認をキャンセルした場合はonDeleteを呼ばない", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const { onDelete } = setup();
    const deleteButtons = screen.getAllByRole("button", { name: "削除" });
    await userEvent.click(deleteButtons[1]);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("空配列の場合は空メッセージを表示する", () => {
    setup({ roles: [] });
    expect(screen.getByText("該当するデータはありません")).toBeInTheDocument();
  });
});
