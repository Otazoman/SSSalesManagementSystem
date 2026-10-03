import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductTable } from "./ProductTable";
import { ItemRecord } from "../_types";

const items: ItemRecord[] = [
  {
    id: "ITEM-1",
    name: "品目A",
    isPurchased: false,
    isSales: true,
    isService: false,
    baseUnitCode: "PCS",
    taxCategoryCode: "TAX_10",
    productBarcode: null,
    accountCode: "ACC-1",
    memo: null,
    standardSalesPrice: 1000,
    standardPurchasePrice: 500,
    status: "active",
    supplierId: null,
    supplierPartNumber: null,
  },
  {
    id: "ITEM-2",
    name: "廃止品目",
    isPurchased: true,
    isSales: false,
    isService: false,
    baseUnitCode: "PCS",
    taxCategoryCode: "TAX_10",
    productBarcode: null,
    accountCode: null,
    memo: null,
    status: "suspended",
    supplierId: null,
    supplierPartNumber: null,
  },
];

function setup(overrides: Partial<Parameters<typeof ProductTable>[0]> = {}) {
  const onEdit = vi.fn();
  const onSuspend = vi.fn();
  const onPurge = vi.fn();
  const { container } = render(
    <ProductTable
      items={items}
      accounts={[{ code: "ACC-1", name: "売上高" }]}
      suppliers={[]}
      taxCategories={[{ code: "TAX_10", name: "10%課税", taxType: "STANDARD", taxRate: 0.1 }]}
      canUpdate
      canDelete
      onEdit={onEdit}
      onSuspend={onSuspend}
      onPurge={onPurge}
      {...overrides}
    />,
  );
  return { onEdit, onSuspend, onPurge, container };
}

describe("ProductTable", () => {
  it("品目コード・名称・勘定科目名を表示する", () => {
    setup();
    expect(screen.getByText("ITEM-1")).toBeInTheDocument();
    expect(screen.getByText("品目A")).toBeInTheDocument();
    expect(screen.getByText(/売上高/)).toBeInTheDocument();
  });

  it("suspendedの行は「完全に削除」を、それ以外は「無効化」を表示する", () => {
    setup();
    expect(screen.getByRole("button", { name: "完全に削除 🗑️" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "無効化" })).toBeInTheDocument();
  });

  it("行クリックでonEditを呼ぶ", async () => {
    const { onEdit } = setup();
    await userEvent.click(screen.getByText("品目A"));
    expect(onEdit).toHaveBeenCalledWith(items[0]);
  });

  it("「無効化」クリックはonSuspendのみ呼び行のonEditへ伝播しない", async () => {
    const { onEdit, onSuspend } = setup();
    await userEvent.click(screen.getByRole("button", { name: "無効化" }));
    expect(onSuspend).toHaveBeenCalledWith(items[0]);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("「完全に削除」クリックでonPurgeを呼ぶ", async () => {
    const { onPurge } = setup();
    await userEvent.click(screen.getByRole("button", { name: "完全に削除 🗑️" }));
    expect(onPurge).toHaveBeenCalledWith("ITEM-2", "廃止品目");
  });

  it("「QR/バーコード」クリックでLabelPrintModalを開閉できる", async () => {
    setup();
    await userEvent.click(screen.getAllByRole("button", { name: "🏷️ QR/バーコード" })[0]);
    expect(screen.getByText(/品目: ITEM-1/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByText(/品目: ITEM-1/)).not.toBeInTheDocument();
  });

  it("空データの場合は空メッセージを表示する", () => {
    setup({ items: [] });
    expect(screen.getByText("該当するデータはありません")).toBeInTheDocument();
  });

  it("回帰: ヘッダー(th)と各データ行(td)の列数が一致する(税区分バッジと区分バッジが同一td内に収まっている)", () => {
    const { container } = setup();
    const headerCount = container.querySelectorAll("thead th").length;
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => {
      expect(row.querySelectorAll("td").length).toBe(headerCount);
    });
  });
});
