import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectLinePicker } from "./DirectLinePicker";

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// REQ-029: 一時保管で、発注番号・受注番号を検索して直接入力の明細を選ぶ
describe("DirectLinePicker", () => {
  it("発注番号で探して発注を選び、直接入力の明細だけを出して選べる", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/purchase-orders/PO-1")) {
        return json({
          id: "PO-1",
          partnerId: "SUP-1",
          items: [
            { id: "POI-M", itemName: "マスタ品", quantity: 2, inputType: "MASTER" },
            { id: "POI-D", itemName: "特注の部品", quantity: 3, inputType: "DIRECT" },
          ],
        });
      }
      if (url.includes("/api/purchase-orders?id=PO-1")) return json([{ id: "PO-1", title: "特注の発注" }]);
      return json([]);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const onPick = vi.fn();
    render(<DirectLinePicker kind="purchase" onPick={onPick} />);

    await userEvent.type(screen.getByLabelText("発注番号"), "PO-1");
    await userEvent.click(screen.getByRole("button", { name: "検索" }));
    await userEvent.click(await screen.findByText("特注の発注"));

    await waitFor(() => expect(screen.getByText(/特注の部品/)).toBeInTheDocument());
    expect(screen.queryByText(/マスタ品/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText(/特注の部品/));
    expect(onPick).toHaveBeenCalledWith({ orderId: "PO-1", itemId: "POI-D", itemName: "特注の部品", quantity: 3, partnerId: "SUP-1" });
  });

  it("受注番号で探す(該当が無ければ知らせる)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([])));
    render(<DirectLinePicker kind="sales" onPick={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("受注番号"), "SO-9");
    await userEvent.click(screen.getByRole("button", { name: "検索" }));
    expect(await screen.findByText("該当する受注がありません。")).toBeInTheDocument();
  });
});
