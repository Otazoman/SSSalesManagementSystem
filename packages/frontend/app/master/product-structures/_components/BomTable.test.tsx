import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BomTable } from "./BomTable";
import { StructureRecord } from "../_types";

const structures: StructureRecord[] = [
  {
    id: "STR-1",
    parentItemId: "TOP",
    parentItemName: "完成品A",
    childItemId: "MID",
    childItemName: "部品B",
    childItemStatus: "active",
    quantityRequired: 2,
    revision: "1.0",
    validFrom: "2020-01-01",
    validTo: null,
    memo: null,
    childUnitPrice: 100,
    subTotalCost: 200,
    status: "active",
  },
  {
    id: "STR-2",
    parentItemId: "TOP",
    parentItemName: "完成品A",
    childItemId: "LEGACY",
    childItemName: "旧部品",
    childItemStatus: "active",
    quantityRequired: 1,
    revision: "0.9",
    validFrom: "2020-01-01",
    validTo: "2020-06-01",
    memo: null,
    childUnitPrice: 50,
    subTotalCost: 50,
    status: "suspended",
  },
];

function setup(overrides: Partial<Parameters<typeof BomTable>[0]> = {}) {
  const onSelectEdit = vi.fn();
  const onDeleteLink = vi.fn();
  const onSuspend = vi.fn();
  render(
    <BomTable
      displayedStructures={structures}
      canUpdate
      canDelete
      onSelectEdit={onSelectEdit}
      onDeleteLink={onDeleteLink}
      onSuspend={onSuspend}
      {...overrides}
    />,
  );
  return { onSelectEdit, onDeleteLink, onSuspend };
}

describe("BomTable", () => {
  it("親品目・子部品コードを表示する", () => {
    setup();
    expect(screen.getAllByText("TOP")).toHaveLength(2);
    expect(screen.getByText("MID")).toBeInTheDocument();
  });

  it("期限切れの構成には「🔴 期限切れ」ラベルを表示する", () => {
    setup();
    expect(screen.getByText("🔴 期限切れ")).toBeInTheDocument();
    expect(screen.getByText("🟢 現行有効")).toBeInTheDocument();
  });

  it("suspendedの行は「解除」を、それ以外は「無効化」を表示する", () => {
    setup();
    expect(screen.getByRole("button", { name: "解除" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "無効化" })).toBeInTheDocument();
  });

  it("行クリックでonSelectEditを呼ぶ", async () => {
    const { onSelectEdit } = setup();
    await userEvent.click(screen.getByText("MID"));
    expect(onSelectEdit).toHaveBeenCalledWith(structures[0]);
  });

  it("「解除」クリックでonDeleteLinkにidを渡す", async () => {
    const { onDeleteLink } = setup();
    await userEvent.click(screen.getByRole("button", { name: "解除" }));
    expect(onDeleteLink).toHaveBeenCalledWith("STR-2");
  });

  it("空データの場合は空メッセージを表示する", () => {
    setup({ displayedStructures: [] });
    expect(
      screen.getByText("該当するデータはありません"),
    ).toBeInTheDocument();
  });
});
