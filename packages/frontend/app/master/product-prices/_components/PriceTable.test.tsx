import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PriceTable } from "./PriceTable";
import { PriceRecord, MasterItem, MasterPartner } from "../_types";

const items: MasterItem[] = [{ id: "ITEM-1", name: "品目A", baseUnitCode: "KG" }];
const partners: MasterPartner[] = [{ id: "CUST-1", name: "得意先A" }];
const prices: PriceRecord[] = [
  {
    id: "PRICE-1",
    itemId: "ITEM-1",
    priceType: "SALES",
    partnerId: "CUST-1",
    minQuantity: 10,
    unitPrice: 1500,
    unitCode: "KG",
    status: "active",
  },
  {
    id: "PRICE-2",
    itemId: "ITEM-1",
    priceType: "PURCHASE",
    partnerId: null,
    minQuantity: 1,
    unitPrice: 500,
    unitCode: "KG",
    status: "suspended",
  },
];

function setup(overrides: Partial<Parameters<typeof PriceTable>[0]> = {}) {
  const onEditSelect = vi.fn();
  const onDeletePrice = vi.fn();
  const onSuspendPrice = vi.fn();
  render(
    <PriceTable
      prices={prices}
      items={items}
      partners={partners}
      editingId={null}
      canUpdate
      canDelete
      onEditSelect={onEditSelect}
      onDeletePrice={onDeletePrice}
      onSuspendPrice={onSuspendPrice}
      {...overrides}
    />,
  );
  return { onEditSelect, onDeletePrice, onSuspendPrice };
}

describe("PriceTable", () => {
  it("品目名・取引先名・単価を表示する", () => {
    setup();
    expect(screen.getAllByText("品目A")).toHaveLength(2);
    expect(screen.getByText("得意先A")).toBeInTheDocument();
    expect(screen.getByText("¥1,500")).toBeInTheDocument();
  });

  it("partnerId未指定の場合は「標準単価設定」と表示する", () => {
    setup();
    expect(screen.getByText("🌐 標準単価設定")).toBeInTheDocument();
  });

  it("suspendedの行は「完全に削除」を、それ以外は「無効化」を表示する", () => {
    setup();
    expect(screen.getByRole("button", { name: "完全に削除 🗑️" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "無効化" })).toBeInTheDocument();
  });

  it("行クリックでonEditSelectを呼ぶ", async () => {
    const { onEditSelect } = setup();
    await userEvent.click(screen.getByText("¥1,500"));
    expect(onEditSelect).toHaveBeenCalledWith(prices[0]);
  });

  it("「完全に削除」クリックでonDeletePriceにidを渡す", async () => {
    const { onDeletePrice } = setup();
    await userEvent.click(screen.getByRole("button", { name: "完全に削除 🗑️" }));
    expect(onDeletePrice).toHaveBeenCalledWith("PRICE-2");
  });

  it("編集中の行は「調整中」ボタン文言になる", () => {
    setup({ editingId: "PRICE-1" });
    expect(screen.getByRole("button", { name: "調整中" })).toBeInTheDocument();
  });

  it("空データの場合は空メッセージを表示する", () => {
    setup({ prices: [] });
    expect(
      screen.getByText("該当するデータはありません"),
    ).toBeInTheDocument();
  });
});
