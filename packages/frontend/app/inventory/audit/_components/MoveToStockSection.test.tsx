import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MoveToStockSection } from "./MoveToStockSection";
import { TemporaryHolding } from "../_types/temporary-holdings";

// REQ-011(3): 自社品を品目マスタの品目として在庫へ移す
function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const HOLDING: TemporaryHolding = {
  id: "TH-1", category: "OWN", itemName: "仮置きの部材", spec: null, quantity: 4, unitName: "個", warehouseId: "WH1", locationId: null,
  sourceType: null, sourceId: null, sourceItemId: null, partnerId: null, receivedDate: "2026-11-15", plannedReleaseDate: null, status: "HOLDING",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MoveToStockSection(REQ-011(3))", () => {
  it("同じ倉庫のロケーションだけを選べ、品目とロケーションを選んで在庫へ移す", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const posted: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/products")) return json([{ id: "ITEM1", name: "登録した品目" }]);
        if (url.includes("/api/locations")) {
          return json([
            { id: "LOC1", name: "A-1", warehouseId: "WH1" },
            { id: "LOC9", name: "別倉庫の棚", warehouseId: "WH2" },
          ]);
        }
        if (url.includes("/move-to-stock")) {
          posted.push(JSON.parse(String(init?.body)));
          return json({ message: "在庫へ移しました" });
        }
        return json([]);
      }),
    );
    const onMoved = vi.fn();
    render(<MoveToStockSection holding={HOLDING} onMoved={onMoved} />);
    await waitFor(() => expect(screen.getByRole("option", { name: "A-1(LOC1)" })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: /別倉庫の棚/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("品目"), { target: { value: "ITEM1" } });
    fireEvent.change(screen.getByLabelText("ロケーション"), { target: { value: "LOC1" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "在庫へ移す" }));
    });
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith("在庫へ移しました"));
    expect(posted[0]).toMatchObject({ itemId: "ITEM1", locationId: "LOC1" });
  });
});
