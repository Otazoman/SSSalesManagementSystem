import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { StockTransferPanel } from "./StockTransferPanel";

// REQ-006: 倉庫間移動の一覧・入庫
function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const ITEM = { id: "TI-1", transferId: "TF-1", itemId: "ITEM1", lotNumber: "NONE", accountCode: "ACC1", sourceLocationId: "LOC-A", quantity: 10, receivedQuantity: 4, differenceQuantity: 0, sortOrder: 0 };
const TRANSFER = {
  id: "TF-1", sourceWarehouseId: "WH-A", destinationWarehouseId: "WH-B", shippedDate: "2026-11-15T00:00:00.000Z", status: "PARTIALLY_RECEIVED",
  shipmentId: "SH-1", shipmentInstructionId: null, receiptInstructionId: null, closedReason: null, memo: null, items: [ITEM],
};

function stubFetch(posted: Array<{ url: string; body: unknown }> = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        posted.push({ url, body: JSON.parse(String(init.body)) });
        return json({ message: "入庫しました" });
      }
      if (url.includes("/api/warehouses")) return json([{ id: "WH-A", name: "本社倉庫", warehouseType: "INTERNAL", status: "active" }, { id: "WH-B", name: "第二倉庫", warehouseType: "INTERNAL", status: "active" }]);
      if (url.includes("/api/locations")) return json([{ id: "LOC-B", warehouseId: "WH-B", name: "B-1", status: "active" }]);
      if (url.includes("/api/products")) return json([{ id: "ITEM1", name: "移動する品目" }]);
      if (url.includes("/api/stock-transfers/TF-1")) return json({ ...TRANSFER, items: [{ ...ITEM, pendingReceiptQuantity: 0 }], shipment: { id: "SH-1", status: "APPROVED" }, receipts: [] });
      if (url.includes("/api/stock-transfers")) return json([TRANSFER]);
      return json([]);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StockTransferPanel(REQ-006)", () => {
  it("一覧に移動元 → 移動先・品目・輸送中の数量・状態を出す", async () => {
    stubFetch();
    render(<StockTransferPanel mode="ship" canCreate />);
    await waitFor(() => expect(screen.getByText("本社倉庫 → 第二倉庫")).toBeInTheDocument());
    expect(screen.getByText("移動する品目")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getAllByText("一部入庫").some((el) => el.tagName !== "OPTION")).toBe(true);
    expect(screen.getByRole("button", { name: /倉庫間移動を作る/ })).toBeInTheDocument();
  });

  it("入荷の画面では、輸送中の残りを数量とロケーションを選んで入庫する", async () => {
    const posted: Array<{ url: string; body: unknown }> = [];
    stubFetch(posted);
    render(<StockTransferPanel mode="receive" canCreate />);
    await waitFor(() => expect(screen.getByRole("button", { name: "入庫する" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /倉庫間移動を作る/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "入庫する" }));
    await waitFor(() => expect(screen.getByLabelText("移動する品目の入庫する数量")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("移動する品目の入庫する数量"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("移動する品目の入庫するロケーション"), { target: { value: "LOC-B" } });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "入庫する" }).at(-1)!);
    });
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].url).toContain("/api/stock-transfers/TF-1/receive");
    expect(posted[0].body).toMatchObject({ items: [{ transferItemId: "TI-1", locationId: "LOC-B", quantity: 6 }] });
  });
});
