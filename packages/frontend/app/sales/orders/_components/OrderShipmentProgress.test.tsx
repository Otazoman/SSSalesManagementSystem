import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { OrderShipmentProgress } from "./OrderShipmentProgress";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function stubProgress(items: Array<{ id: string; name: string; remaining: number; direct: boolean }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify(
          items.map((i) => ({
            salesOrderItemId: i.id,
            itemId: "ITEM-1",
            itemName: i.name,
            inputType: "MASTER",
            quantity: i.remaining,
            shippedQuantity: 0,
            remainingQuantity: i.remaining,
            reservations: [],
            isDirectShipment: i.direct,
          })),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// BUG-109: 直送の明細は「直送」と出し、出荷指示を作る対象に数えない
describe("OrderShipmentProgress: 直送の明細", () => {
  it("直送の明細だけが残っている時は、直送と案内を出し、出荷指示の作成ボタンは出さない", async () => {
    stubProgress([{ id: "SOI-D", name: "直送品", remaining: 4, direct: true }]);
    render(<OrderShipmentProgress orderId="SO-1" />);

    await waitFor(() => expect(screen.getByText("直送品")).toBeInTheDocument());
    expect(screen.getByText("直送")).toBeInTheDocument();
    expect(screen.getByText(/直送完了にする/)).toBeInTheDocument();
    expect(screen.queryByText(/出荷指示を作成する/)).not.toBeInTheDocument();
  });

  it("直送でない明細が残っていれば、出荷指示の作成ボタンを出す", async () => {
    stubProgress([
      { id: "SOI-S", name: "在庫品", remaining: 10, direct: false },
      { id: "SOI-D", name: "直送品", remaining: 4, direct: true },
    ]);
    render(<OrderShipmentProgress orderId="SO-1" />);

    await waitFor(() => expect(screen.getByText(/出荷指示を作成する/)).toBeInTheDocument());
  });
});
