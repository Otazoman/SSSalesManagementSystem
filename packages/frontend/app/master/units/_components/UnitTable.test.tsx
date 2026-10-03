import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UnitTable } from "./UnitTable";
import { UnitRecord } from "../_types";

const units: UnitRecord[] = [
  { code: "PCS", name: "個", status: "active" },
  { code: "TMP", name: "仮登録単位", status: "temporary" },
  { code: "OLD", name: "廃止単位", status: "suspended" },
];

function setup(overrides: Partial<Parameters<typeof UnitTable>[0]> = {}) {
  const onStartEdit = vi.fn();
  const onDelete = vi.fn();
  const onSuspend = vi.fn();
  render(
    <UnitTable
      units={units}
      editingUnit={null}
      canUpdate
      canDelete
      onStartEdit={onStartEdit}
      onDelete={onDelete}
      onSuspend={onSuspend}
      {...overrides}
    />,
  );
  return { onStartEdit, onDelete, onSuspend };
}

describe("UnitTable", () => {
  it("各単位のコード・名称を表示する", () => {
    setup();
    expect(screen.getByText("PCS")).toBeInTheDocument();
    expect(screen.getByText("個")).toBeInTheDocument();
  });

  it("temporaryステータスには「仮登録/申請中」バッジを表示する", () => {
    setup();
    expect(screen.getByText("仮登録/申請中")).toBeInTheDocument();
  });

  it("suspendedステータスには「無効」バッジと「完全に削除」ボタンを表示する", () => {
    setup();
    expect(screen.getByText("無効")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完全に削除 🗑️" })).toBeInTheDocument();
  });

  it("suspended以外の行には「無効化」ボタンを表示する", () => {
    setup();
    const suspendButtons = screen.getAllByRole("button", { name: "無効化" });
    expect(suspendButtons).toHaveLength(2);
  });

  it("行クリックでonStartEditを呼ぶ", async () => {
    const { onStartEdit } = setup();
    await userEvent.click(screen.getByText("個"));
    expect(onStartEdit).toHaveBeenCalledWith(units[0]);
  });

  it("「無効化」クリックはonSuspendのみ呼び、行のonStartEditへ伝播しない", async () => {
    const { onStartEdit, onSuspend } = setup();
    const suspendButton = screen.getAllByRole("button", { name: "無効化" })[0];
    await userEvent.click(suspendButton);
    expect(onSuspend).toHaveBeenCalledWith(units[0]);
    expect(onStartEdit).not.toHaveBeenCalled();
  });

  it("「完全に削除」クリックでonDeleteを呼ぶ", async () => {
    const { onDelete } = setup();
    await userEvent.click(screen.getByRole("button", { name: "完全に削除 🗑️" }));
    expect(onDelete).toHaveBeenCalledWith(units[2]);
  });

  it("canUpdate:falseの場合は変更ボタンが無効になる", () => {
    setup({ canUpdate: false });
    const editButtons = screen.getAllByRole("button", { name: "変更" });
    editButtons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it("データが空の場合は空メッセージを表示する", () => {
    setup({ units: [] });
    expect(screen.getByText("該当するデータはありません")).toBeInTheDocument();
  });
});
