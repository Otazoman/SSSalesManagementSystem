import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DirectShipmentCompletionModal } from "./DirectShipmentCompletionModal";

afterEach(() => {
  vi.unstubAllGlobals();
});

// REQ-005 第2段階: 直送完了の画面。残数量を初期値にし、数量0の明細は送らない
describe("DirectShipmentCompletionModal", () => {
  it("入れた数量の明細だけを直送完了のAPIへ送り、結果のメッセージを返す", async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ message: "直送完了を確定しました" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    render(
      <DirectShipmentCompletionModal
        orderId="PO-1"
        salesOrderId="SO-1"
        lines={[
          { orderItemId: "POI-1", itemName: "品目A", remainingQuantity: 5 },
          { orderItemId: "POI-2", itemName: "品目B", remainingQuantity: 2 },
        ]}
        onClose={onClose}
        onCompleted={onCompleted}
      />,
    );

    expect(screen.getByLabelText("品目Aの納品数量")).toHaveValue(5);
    fireEvent.change(screen.getByLabelText("品目Bの納品数量"), { target: { value: "0" } });
    fireEvent.click(screen.getByText("直送完了にする"));

    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith("直送完了を確定しました"));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/api/purchase-orders/PO-1/direct-shipment-completion");
    const body = JSON.parse(String(init?.body));
    expect(body.items).toEqual([{ orderItemId: "POI-1", quantity: 5 }]);
    expect(onClose).toHaveBeenCalled();
  });
});
