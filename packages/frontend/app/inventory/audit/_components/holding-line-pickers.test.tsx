import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HoldingLinePickerModal } from "./holding-line-pickers";

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// REQ-029: 一時保管の受入・払出は、仕入・売上と同じ共通の部品(DocumentLinePickerModal)で発注・受注の明細を選ぶ
describe("HoldingLinePickerModal", () => {
  function stubPurchase() {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/purchase-orders/PO-1")) {
        return json({
          id: "PO-1",
          items: [
            { id: "POI-M", itemName: "マスタ品", quantity: 2, inputType: "MASTER" },
            { id: "POI-D", itemName: "特注の部品", quantity: 3, inputType: "DIRECT" },
            { id: "POI-E", itemName: "特注の箱", quantity: 1, inputType: "DIRECT" },
          ],
        });
      }
      if (url.includes("/api/purchase-orders")) {
        return json([{ id: "PO-1", title: "特注の発注", partnerId: "SUP-1", totalAmount: 5000 }]);
      }
      return json([]);
    });
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  it("承認済みの発注を選ぶと直接入力の明細だけを出し、1件を選んで数量と取引先を返す", async () => {
    const fetchSpy = stubPurchase();
    const onPick = vi.fn();
    render(<HoldingLinePickerModal kind="purchase" onClose={vi.fn()} onPick={onPick} />);

    await userEvent.click(await screen.findByText("特注の発注"));
    await waitFor(() => expect(screen.getByText("特注の部品")).toBeInTheDocument());
    expect(screen.queryByText("マスタ品")).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes("/api/purchase-orders?status=APPROVED"))).toBe(true);

    await userEvent.clear(screen.getByLabelText("特注の部品の受け入れる数量"));
    await userEvent.type(screen.getByLabelText("特注の部品の受け入れる数量"), "2");
    await userEvent.click(screen.getByRole("button", { name: "この明細を使う" }));
    expect(onPick).toHaveBeenCalledWith({ orderId: "PO-1", itemId: "POI-D", itemName: "特注の部品", quantity: 2, partnerId: "SUP-1" });
  });

  it("2件以上に数量を入れると、1件だけ選ぶよう知らせる", async () => {
    stubPurchase();
    const onPick = vi.fn();
    render(<HoldingLinePickerModal kind="purchase" onClose={vi.fn()} onPick={onPick} />);
    await userEvent.click(await screen.findByText("特注の発注"));
    await waitFor(() => expect(screen.getByText("特注の部品")).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText("特注の部品の受け入れる数量"), "1");
    await userEvent.type(screen.getByLabelText("特注の箱の受け入れる数量"), "1");
    await userEvent.click(screen.getByRole("button", { name: "この明細を使う" }));
    expect(screen.getByText(/明細は1件だけ選択してください/)).toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
  });
});
