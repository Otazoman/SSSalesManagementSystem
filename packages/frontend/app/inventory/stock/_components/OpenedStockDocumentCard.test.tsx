import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { OpenedStockDocumentCard } from "./OpenedStockDocumentCard";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOnce(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

describe("OpenedStockDocumentCard", () => {
  it("入荷指示の詳細を取得し、ヘッダと明細(消込済み・残数量)を表示する", async () => {
    const fetchSpy = mockFetchOnce({
      header: { id: "RI-1", status: "APPROVED", partnerId: "P-1", warehouseId: "W-1", instructedReceiveDate: "2026-09-10T00:00:00.000Z", memo: null, createdBy: "EMP001" },
      items: [{ id: "L1", itemId: "ITEM-A", lotNumber: "LOT1", instructedQuantity: 10, fulfilledQuantity: 4, remainingQuantity: 6 }],
    });
    render(<OpenedStockDocumentCard kind="receipt_instruction" id="RI-1" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText("ITEM-A")).toBeTruthy());
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/api/receipt-instructions/RI-1");
    expect(screen.getByText("2026-09-10")).toBeTruthy();
    expect(screen.getByText("消込済み")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
  });

  it("出庫は出庫APIから取得する。取得に失敗したらエラーを表示する", async () => {
    const fetchSpy = mockFetchOnce({ message: "見つかりません" }, 404);
    render(<OpenedStockDocumentCard kind="shipment" id="SH-9" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText("見つかりません")).toBeTruthy());
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/api/stock-shipments/SH-9");
  });

  it("倉庫間移動: 入庫は移動元倉庫、出庫は移動先倉庫をヘッダに表示する", async () => {
    mockFetchOnce({
      header: { id: "RC-1", status: "APPROVED", receivedDate: "2026-09-23T00:00:00.000Z", partnerId: null, sourceWarehouseId: "WH-SRC", createdBy: "EMP001" },
      items: [],
    });
    const { unmount } = render(<OpenedStockDocumentCard kind="receipt" id="RC-1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("WH-SRC")).toBeTruthy());
    expect(screen.getByText("移動元倉庫")).toBeTruthy();
    unmount();
    vi.restoreAllMocks();

    mockFetchOnce({
      header: { id: "SH-1", status: "APPROVED", shippedDate: "2026-09-23T00:00:00.000Z", partnerId: null, destinationWarehouseId: "WH-DST", createdBy: "EMP001" },
      items: [],
    });
    render(<OpenedStockDocumentCard kind="shipment" id="SH-1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("WH-DST")).toBeTruthy());
    expect(screen.getByText("移動先倉庫")).toBeTruthy();
  });
});
