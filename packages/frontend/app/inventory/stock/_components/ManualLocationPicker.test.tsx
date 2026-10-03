import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ManualLocationPicker } from "./ManualLocationPicker";
import { LocationRecord, WarehouseRecord } from "../_types";

const warehouses: WarehouseRecord[] = [
  { id: "WH-001", name: "東京倉庫", warehouseType: "INTERNAL", status: "active" },
  { id: "WH-002", name: "大阪倉庫", warehouseType: "INTERNAL", status: "active" },
];

const locations: LocationRecord[] = [
  { id: "LOC-A-01", warehouseId: "WH-001", name: "Aラック", status: "active" },
  { id: "LOC-B-01", warehouseId: "WH-002", name: "Bラック", status: "active" },
];

// D対応: 棚卸・入荷・出荷それぞれのロケーション手入力選択で、倉庫ごとに絞り込めるようにした。
// 倉庫が多い現場でキーワード検索だけに頼らず候補を絞れることを確認する
describe("ManualLocationPicker: 倉庫による絞り込み", () => {
  it("初期状態は全倉庫のロケーションを一覧表示する", () => {
    render(<ManualLocationPicker locations={locations} warehouses={warehouses} onSelect={vi.fn()} />);
    expect(screen.getByText("LOC-A-01")).toBeInTheDocument();
    expect(screen.getByText("LOC-B-01")).toBeInTheDocument();
  });

  it("倉庫を選択すると、その倉庫のロケーションのみに絞り込まれる", () => {
    render(<ManualLocationPicker locations={locations} warehouses={warehouses} onSelect={vi.fn()} />);

    fireEvent.change(screen.getByDisplayValue("倉庫で絞り込み(すべて)"), {
      target: { value: "WH-001" },
    });

    expect(screen.getByText("LOC-A-01")).toBeInTheDocument();
    expect(screen.queryByText("LOC-B-01")).not.toBeInTheDocument();
  });

  it("倉庫絞り込みとキーワード検索は併用できる", () => {
    render(<ManualLocationPicker locations={locations} warehouses={warehouses} onSelect={vi.fn()} />);

    fireEvent.change(screen.getByDisplayValue("倉庫で絞り込み(すべて)"), {
      target: { value: "WH-001" },
    });
    fireEvent.change(screen.getByPlaceholderText("ロケーションコード・名称で検索"), {
      target: { value: "B" },
    });

    // WH-001に絞った上でさらに"B"を含まないため0件になる(LOC-B-01はWH-002側なので出ない)
    expect(screen.getByText("該当するロケーションがありません")).toBeInTheDocument();
  });

  it("ロケーションを選択するとonSelectへ渡される", () => {
    const onSelect = vi.fn();
    render(<ManualLocationPicker locations={locations} warehouses={warehouses} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("LOC-A-01"));

    expect(onSelect).toHaveBeenCalledWith(locations[0]);
  });
});
