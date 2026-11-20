import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PurchaseOrderReceiptProgress } from "./PurchaseOrderReceiptProgress";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function stubProgress() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            orderItemId: "POI-1",
            itemId: "ITEM-1",
            itemName: "テスト品目",
            inputType: "MASTER",
            quantity: 5,
            receivedQuantity: 0,
            remainingQuantity: 5,
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// BUG-116: 直送の発注で受注明細とつながる明細が無い時は、黙ってボタンを隠さず理由を出す
describe("PurchaseOrderReceiptProgress: 直送完了", () => {
  it("受注明細とつながる明細があれば直送完了ボタンを出す", async () => {
    stubProgress();
    render(
      <PurchaseOrderReceiptProgress orderId="PO-1" directSalesOrderId="SO-1" directLinkedOrderItemIds={["POI-1"]} />,
    );
    await waitFor(() => expect(screen.getByText(/直送完了にする/)).toBeInTheDocument());
    expect(screen.queryByText(/直送完了にできません/)).not.toBeInTheDocument();
  });

  it("つながる明細が無ければボタンの代わりに理由を出す", async () => {
    stubProgress();
    render(<PurchaseOrderReceiptProgress orderId="PO-1" directSalesOrderId="SO-1" directLinkedOrderItemIds={[]} />);
    await waitFor(() => expect(screen.getByText(/直送完了にできません/)).toBeInTheDocument());
    expect(screen.queryByText(/直送完了にする/)).not.toBeInTheDocument();
  });
});
