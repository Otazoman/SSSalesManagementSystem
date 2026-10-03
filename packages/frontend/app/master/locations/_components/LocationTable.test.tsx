import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocationTable } from "./LocationTable";
import { LocationRecord, WarehouseSimple } from "../_types";

const warehouses: WarehouseSimple[] = [{ id: "WH-1", name: "本社倉庫" }];
const locations: LocationRecord[] = [
  { id: "LOC-A-01", warehouseId: "WH-1", name: "A棚1段目", memo: "メモ", status: "active" },
  { id: "LOC-B-01", warehouseId: "WH-1", name: "仮登録棚", memo: null, status: "temporary" },
  { id: "LOC-C-01", warehouseId: "WH-1", name: "廃止棚", memo: null, status: "suspended" },
];

function setup(overrides: Partial<Parameters<typeof LocationTable>[0]> = {}) {
  const onSelect = vi.fn();
  const onDelete = vi.fn();
  const onSuspend = vi.fn();
  render(
    <LocationTable
      locations={locations}
      warehouses={warehouses}
      onSelect={onSelect}
      onDelete={onDelete}
      onSuspend={onSuspend}
      canUpdate
      canDelete
      {...overrides}
    />,
  );
  return { onSelect, onDelete, onSuspend };
}

describe("LocationTable", () => {
  it("倉庫名・ロケーション名を表示する", () => {
    setup();
    expect(screen.getAllByText("本社倉庫").length).toBe(3);
    expect(screen.getByText("A棚1段目")).toBeInTheDocument();
  });

  it("紐づく倉庫が見つからない場合は「不明な倉庫」を表示する", () => {
    setup({ warehouses: [] });
    expect(screen.getAllByText("不明な倉庫").length).toBe(3);
  });

  it("行クリックでonSelectを呼ぶ", async () => {
    const { onSelect } = setup();
    await userEvent.click(screen.getByText("A棚1段目"));
    expect(onSelect).toHaveBeenCalledWith(locations[0]);
  });

  it("QR/バーコードボタンクリックでLabelPrintModalを開く", async () => {
    setup();
    await userEvent.click(screen.getAllByText("🏷️ QR/バーコード")[0]);
    expect(screen.getByText(/ロケーション: LOC-A-01/)).toBeInTheDocument();
  });

  it("canUpdate:falseの場合は変更がリンクでなくテキスト表示になる", () => {
    setup({ canUpdate: false });
    expect(screen.queryByRole("button", { name: "変更" })).not.toBeInTheDocument();
  });

  it("suspended行は「完全に削除」ボタンでonDeleteを呼ぶ", async () => {
    const { onDelete } = setup();
    await userEvent.click(screen.getByRole("button", { name: "完全に削除 🗑️" }));
    expect(onDelete).toHaveBeenCalledWith(locations[2]);
  });

  it("空データの場合は空メッセージを表示する", () => {
    setup({ locations: [] });
    expect(screen.getByText("該当するデータはありません")).toBeInTheDocument();
  });
});
