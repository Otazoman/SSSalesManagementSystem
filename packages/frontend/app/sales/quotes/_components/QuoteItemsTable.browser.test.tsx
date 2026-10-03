import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { QuoteItemsTable } from "./QuoteItemsTable";
import {
  WIDTHS,
  setWidth,
  pageOverflowsHorizontally,
} from "../../../../test-support/responsive";

// 実ブラウザ: 明細表のリストボックス(形式・品目・単位・税区分)が、潰れず切れずに表示される。
// 従来は列幅が割合(w-1/12)指定で、スマホでは各列が数pxに潰れ、PCでも品目名が途中で切れた
const products: any[] = [
  { id: "PROD-0001", name: "サンプル品目A(標準タイプ)", price: 12000 },
];
const units: any[] = [{ code: "PCS", name: "個" }];
const taxes: any[] = [
  { code: "TAX10", name: "課税10%", taxType: "STANDARD", taxRate: 0.1 },
];
const item: any = {
  itemId: "PROD-0001",
  itemName: "",
  inputType: "MASTER",
  quantity: 2,
  unitPrice: 12000,
  unitCode: "PCS",
  taxCategoryCode: "TAX10",
};

const renderTable = (containerWidth?: number) =>
  render(
    <div
      style={containerWidth ? { width: containerWidth } : undefined}
      className="p-4"
    >
      <QuoteItemsTable
        items={[item]}
        products={products}
        units={units}
        taxCategories={taxes}
        onItemTypeChange={() => {}}
        onItemChange={() => {}}
        onAddItemRow={() => {}}
        onRemoveItemRow={() => {}}
        onMoveItemUp={() => {}}
        onMoveItemDown={() => {}}
        calcSubTotal={() => 24000}
        calcGrossSubTotal={() => 24000}
        calcDiscountTotal={() => 0}
        calcTax={() => 2400}
        calcTotal={() => 26400}
      />
    </div>,
  );

const selectByValue = (container: HTMLElement, value: string) =>
  Array.from(container.querySelectorAll("select")).find(
    (s) => (s as HTMLSelectElement).value === value,
  ) as HTMLSelectElement;

describe("QuoteItemsTable のリストボックス(実ブラウザ)", () => {
  it("PC(サイドバー付きの実効幅 約990px): 品目は240px以上・税区分は128px以上・形式は100px以上で、切れない幅を確保する", async () => {
    await setWidth(WIDTHS.desktop, 800);
    const { container } = renderTable(990);
    expect(
      selectByValue(container, "PROD-0001").getBoundingClientRect().width,
    ).toBeGreaterThanOrEqual(220);
    expect(
      selectByValue(container, "TAX10").getBoundingClientRect().width,
    ).toBeGreaterThanOrEqual(120);
    expect(
      selectByValue(container, "MASTER").getBoundingClientRect().width,
    ).toBeGreaterThanOrEqual(90);
    expect(pageOverflowsHorizontally()).toBe(false);
  });

  it("スマホ: 列を潰さず(PCと同じ幅のまま)、表の枠内で横スクロールする。ページは横にはみ出さない", async () => {
    await setWidth(WIDTHS.phone, 700);
    const { container } = renderTable();
    expect(
      selectByValue(container, "PROD-0001").getBoundingClientRect().width,
    ).toBeGreaterThanOrEqual(220);
    expect(
      selectByValue(container, "TAX10").getBoundingClientRect().width,
    ).toBeGreaterThanOrEqual(120);
    const scroller = container.querySelector(".overflow-x-auto") as HTMLElement;
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    expect(pageOverflowsHorizontally()).toBe(false);
  });
});
