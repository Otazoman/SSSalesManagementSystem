import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuoteItemsTable } from "./QuoteItemsTable";
import { ProductMaster, QuoteItem } from "../_types";

const products: ProductMaster[] = [{ id: "PROD-1", name: "品目A", price: 1000 }];

function baseItem(overrides: Partial<QuoteItem> = {}): QuoteItem {
  return {
    itemId: "",
    itemName: "",
    inputType: "MASTER",
    quantity: 1,
    unitPrice: 0,
    ...overrides,
  };
}

function baseProps(overrides: Partial<Parameters<typeof QuoteItemsTable>[0]> = {}) {
  return {
    items: [baseItem()],
    products,
    onItemTypeChange: vi.fn(),
    onItemChange: vi.fn(),
    onAddItemRow: vi.fn(),
    onRemoveItemRow: vi.fn(),
    onMoveItemUp: vi.fn(),
    onMoveItemDown: vi.fn(),
    calcSubTotal: () => 1000,
    calcGrossSubTotal: () => 1000,
    calcDiscountTotal: () => 0,
    calcTax: () => 100,
    calcTotal: () => 1100,
    ...overrides,
  };
}

describe("QuoteItemsTable", () => {
  it("合計金額を表示する", () => {
    render(<QuoteItemsTable {...baseProps()} />);
    expect(screen.getByText("¥1,100")).toBeInTheDocument();
  });

  it("「行を追加」クリックでonAddItemRowを呼ぶ", async () => {
    const onAddItemRow = vi.fn();
    render(<QuoteItemsTable {...baseProps({ onAddItemRow })} />);
    await userEvent.click(screen.getByRole("button", { name: "＋ 行を追加" }));
    expect(onAddItemRow).toHaveBeenCalledTimes(1);
  });

  it("行が1件のみの場合は削除ボタンが無効になる", () => {
    render(<QuoteItemsTable {...baseProps()} />);
    expect(screen.getByRole("button", { name: "🗑️" })).toBeDisabled();
  });

  it("行が複数ある場合は削除ボタンが有効になり、クリックでonRemoveItemRowを呼ぶ", async () => {
    const onRemoveItemRow = vi.fn();
    render(
      <QuoteItemsTable
        {...baseProps({ items: [baseItem(), baseItem()], onRemoveItemRow })}
      />,
    );
    const deleteButtons = screen.getAllByRole("button", { name: "🗑️" });
    expect(deleteButtons[0]).toBeEnabled();
    await userEvent.click(deleteButtons[0]);
    expect(onRemoveItemRow).toHaveBeenCalledWith(0);
  });

  it("先頭行は上移動ボタンが無効、最終行は下移動ボタンが無効になる", () => {
    render(<QuoteItemsTable {...baseProps({ items: [baseItem(), baseItem()] })} />);
    const upButtons = screen.getAllByTitle("上へ移動");
    const downButtons = screen.getAllByTitle("下へ移動");
    expect(upButtons[0]).toBeDisabled();
    expect(downButtons[1]).toBeDisabled();
    expect(upButtons[1]).toBeEnabled();
    expect(downButtons[0]).toBeEnabled();
  });

  it("MASTER品目行は品目セレクトを表示し、DIRECT行はコード/品名の自由入力を表示する", () => {
    render(
      <QuoteItemsTable
        {...baseProps({
          items: [baseItem({ inputType: "MASTER" }), baseItem({ inputType: "DIRECT" })],
        })}
      />,
    );
    expect(screen.getByText("-- 品目を選択 --")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("コード自由")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("自由な品目名")).toBeInTheDocument();
  });

  it("数量入力でonItemChangeを呼ぶ", () => {
    const onItemChange = vi.fn();
    render(<QuoteItemsTable {...baseProps({ onItemChange })} />);
    const quantityInputs = screen.getAllByRole("spinbutton");
    fireEvent.change(quantityInputs[0], { target: { value: "5" } });
    expect(onItemChange).toHaveBeenCalledWith(0, "quantity", 5);
  });

  it("calcTaxBreakdown指定時は税率別内訳を表示する", () => {
    render(
      <QuoteItemsTable
        {...baseProps({
          calcTaxBreakdown: () => ({
            rate10: { excl: 0, tax: 0 },
            rate8: { excl: 1000, tax: 80 },
            rate0: { excl: 0, tax: 0 },
          }),
        })}
      />,
    );
    expect(screen.getByText("消費税 (8%対象):")).toBeInTheDocument();
    expect(screen.queryByText("消費税 (10%対象):")).not.toBeInTheDocument();
  });

  it("値引き(discountTotal<0)がある場合は値引き合計行を表示する", () => {
    render(<QuoteItemsTable {...baseProps({ calcDiscountTotal: () => -300 })} />);
    expect(screen.getByText("値引き合計:")).toBeInTheDocument();
    expect(screen.getByText("-¥300")).toBeInTheDocument();
  });
});
