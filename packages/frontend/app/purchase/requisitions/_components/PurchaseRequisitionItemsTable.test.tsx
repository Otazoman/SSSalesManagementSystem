import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PurchaseRequisitionItemsTable } from "./PurchaseRequisitionItemsTable";
import { PurchaseRequisitionItemRecord, ItemMaster } from "../_types";

const allItems: ItemMaster[] = [
  { id: "ITEM-1", name: "品目A", baseUnitCode: "PCS", taxCategoryCode: "TAX_10" },
];

function baseItem(overrides: Partial<PurchaseRequisitionItemRecord> = {}): PurchaseRequisitionItemRecord {
  return {
    itemId: "",
    itemName: "",
    inputType: "MASTER",
    quantity: 1,
    estimatedUnitPrice: 0,
    ...overrides,
  };
}

function baseProps(overrides: Partial<Parameters<typeof PurchaseRequisitionItemsTable>[0]> = {}) {
  return {
    items: [baseItem()],
    allItems,
    units: [],
    taxCategories: [],
    isLocked: false,
    onItemTypeChange: vi.fn(),
    onItemChange: vi.fn(),
    onItemMasterSelect: vi.fn(),
    onItemQuantityChange: vi.fn(),
    onAddItemRow: vi.fn(),
    onRemoveItemRow: vi.fn(),
    onMoveItemUp: vi.fn(),
    onMoveItemDown: vi.fn(),
    calcSubTotal: () => 0,
    calcGrossSubTotal: () => 0,
    calcDiscountTotal: () => 0,
    calcTax: () => 0,
    calcTaxBreakdown: () => ({
      rate10: { excl: 0, tax: 0 },
      rate8: { excl: 0, tax: 0 },
      rate0: { excl: 0, tax: 0 },
    }),
    calcTotal: () => 0,
    ...overrides,
  };
}

describe("PurchaseRequisitionItemsTable", () => {
  it("品目をマスタ選択すると、onItemMasterSelectを呼ぶ(単位/税区分/仕入単価の自動反映はフック側で行う)", async () => {
    const onItemMasterSelect = vi.fn();
    render(<PurchaseRequisitionItemsTable {...baseProps({ onItemMasterSelect })} />);

    // 品目選択セレクト(2つ目のcombobox: 1つ目は形式トグル)を操作
    const selects = screen.getAllByRole("combobox");
    const itemSelect = selects[1];
    await userEvent.selectOptions(itemSelect, "ITEM-1");

    expect(onItemMasterSelect).toHaveBeenCalledWith(0, "ITEM-1");
  });

  it("数量を変更すると、onItemQuantityChangeを呼ぶ(仕入単価の再取得はフック側で行う)", async () => {
    const onItemQuantityChange = vi.fn();
    render(<PurchaseRequisitionItemsTable {...baseProps({ onItemQuantityChange })} />);

    const quantityInput = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(quantityInput, { target: { value: "5" } });

    expect(onItemQuantityChange).toHaveBeenCalledWith(0, 5);
  });

  it("合計金額を表示する", () => {
    render(<PurchaseRequisitionItemsTable {...baseProps({ calcTotal: () => 4950 })} />);
    expect(screen.getByText("¥4,950")).toBeInTheDocument();
  });

  it("「行を追加」クリックでonAddItemRowを呼ぶ", async () => {
    const onAddItemRow = vi.fn();
    render(<PurchaseRequisitionItemsTable {...baseProps({ onAddItemRow })} />);
    await userEvent.click(screen.getByRole("button", { name: "＋ 行を追加" }));
    expect(onAddItemRow).toHaveBeenCalledTimes(1);
  });
});
