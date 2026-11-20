import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { StockTransferDetailModal } from "./StockTransferDetailModal";

// REQ-006: 倉庫間移動の詳細。何も入力していなければ、✕で確認を出さずに閉じる(ユーザーの指摘)
function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}
const ITEM = { id: "TI-1", transferId: "TF-1", itemId: "ITEM1", lotNumber: "NONE", accountCode: "ACC1", sourceLocationId: "LOC-A", quantity: 10, receivedQuantity: 0, differenceQuantity: 0, sortOrder: 0, pendingReceiptQuantity: 0 };
const DETAIL = {
  id: "TF-1", sourceWarehouseId: "WH-A", destinationWarehouseId: "WH-B", shippedDate: "2026-11-15T00:00:00.000Z", status: "IN_TRANSIT",
  shipmentId: "SH-1", shipmentInstructionId: null, receiptInstructionId: null, closedReason: null, memo: null, items: [ITEM],
  shipment: { id: "SH-1", status: "APPROVED" }, receipts: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderModal(onClose = vi.fn()) {
  render(
    <StockTransferDetailModal
      transferId="TF-1"
      canReceive
      locations={[{ id: "LOC-B", warehouseId: "WH-B", name: "B-1", status: "active" }]}
      warehouseName={(id) => id ?? ""}
      productName={(id) => id}
      locationName={(id) => id ?? ""}
      onClose={onClose}
      onChanged={vi.fn()}
    />,
  );
  return onClose;
}

describe("StockTransferDetailModal", () => {
  it("何も入力していなければ、✕で確認を出さずに閉じる", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(DETAIL)));
    const confirmSpy = vi.spyOn(window, "confirm");
    const onClose = renderModal();
    await waitFor(() => expect(screen.getByLabelText("ITEM1の入庫する数量")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("入庫に成功した後は、✕で確認を出さずに閉じる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (init?.method === "POST" ? json({ message: "入庫しました" }) : json(DETAIL))),
    );
    const confirmSpy = vi.spyOn(window, "confirm");
    const onClose = renderModal();
    await waitFor(() => expect(screen.getByLabelText("ITEM1の入庫する数量")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("ITEM1の入庫する数量"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("ITEM1の入庫するロケーション"), { target: { value: "LOC-B" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "入庫する" }));
    });
    await waitFor(() => expect(screen.getByLabelText("ITEM1の入庫する数量")).toHaveValue(null));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
