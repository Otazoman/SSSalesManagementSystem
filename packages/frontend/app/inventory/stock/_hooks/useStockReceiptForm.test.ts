import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useStockReceiptForm } from "./useStockReceiptForm";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch() {
  const fetchSpy = vi.fn(async () => jsonResponse([]));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// 新規要望(2026-09-23): 倉庫間移動。仕入先/移動元倉庫は排他選択(一方を選ぶと他方は自動でクリアする)
describe("useStockReceiptForm: 仕入先と移動元倉庫の排他選択", () => {
  it("移動元倉庫を選ぶと仕入先はクリアされる", () => {
    mockFetch();
    const { result } = renderHook(() => useStockReceiptForm(vi.fn()));

    act(() => {
      result.current.setPartnerId("PARTNER-1");
    });
    expect(result.current.partnerId).toBe("PARTNER-1");

    act(() => {
      result.current.setSourceWarehouseId("WH-2");
    });
    expect(result.current.sourceWarehouseId).toBe("WH-2");
    expect(result.current.partnerId).toBe("");
  });

  it("仕入先を選ぶと移動元倉庫はクリアされる", () => {
    mockFetch();
    const { result } = renderHook(() => useStockReceiptForm(vi.fn()));

    act(() => {
      result.current.setSourceWarehouseId("WH-2");
    });
    expect(result.current.sourceWarehouseId).toBe("WH-2");

    act(() => {
      result.current.setPartnerId("PARTNER-1");
    });
    expect(result.current.partnerId).toBe("PARTNER-1");
    expect(result.current.sourceWarehouseId).toBe("");
  });
});

describe("useStockReceiptForm: BUG-062 「発注から選ぶ」の選択肢", () => {
  it("発注番号に件名と仕入先名を添えて表示する(仕入先名が分からない時は件名まで)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = url.toString();
        if (u.includes("/api/purchase-orders")) {
          return jsonResponse({
            data: [
              { id: "PO-1", status: "APPROVED", title: "部品発注", partnerId: "SUPP-2" },
              { id: "PO-2", status: "APPROVED", title: null, partnerId: "SUPP-9" },
            ],
          });
        }
        if (u.includes("/api/partners")) return jsonResponse([{ id: "SUPP-2", name: "サンプル仕入先B" }]);
        if (u.includes("/api/receipt-instructions")) return jsonResponse({ data: [] });
        return jsonResponse([]);
      }),
    );
    const { result } = renderHook(() => useStockReceiptForm(vi.fn()));

    await waitFor(() => expect(result.current.orderOptions).toHaveLength(2));
    await waitFor(() => expect(result.current.orderOptions[0].label).toBe("PO-1 部品発注(サンプル仕入先B)"));
    expect(result.current.orderOptions[1].label).toBe("PO-2");
  });
});

describe("useStockReceiptForm: BUG-070 発注を選ぶと仕入先が入る", () => {
  it("発注を選ぶと仕入先が発注の仕入先になり、移動元倉庫はクリアされる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = url.toString();
        if (u.includes("/api/purchase-orders?")) {
          return jsonResponse({ data: [{ id: "PO-1", status: "APPROVED", title: "部品発注", partnerId: "SUPP-2" }] });
        }
        if (u.includes("/api/receipt-instructions")) return jsonResponse({ data: [] });
        return jsonResponse([]);
      }),
    );
    const { result } = renderHook(() => useStockReceiptForm(vi.fn()));
    await waitFor(() => expect(result.current.orderOptions).toHaveLength(1));

    act(() => {
      result.current.setSourceWarehouseId("WH-2");
    });
    act(() => {
      result.current.setOrderId("PO-1");
    });
    expect(result.current.orderId).toBe("PO-1");
    expect(result.current.partnerId).toBe("SUPP-2");
    expect(result.current.sourceWarehouseId).toBe("");
  });

  it("自社倉庫の入庫でも仕入先を送る", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      const u = url.toString();
      if (u.includes("/api/stock-receipts/register")) return jsonResponse({ message: "OK" });
      if (u.includes("/api/receipt-instructions") || u.includes("/api/purchase-orders?")) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useStockReceiptForm(onSuccess, null, "INTERNAL"));

    act(() => {
      result.current.setPartnerId("SUPP-2");
      result.current.setSelectedLocation({ id: "LOC-1", warehouseId: "WH-1", name: "A-1" } as never);
      result.current.setSelectedProduct({ id: "ITEM-1", name: "部品" } as never);
      result.current.setQuantity("3");
    });
    act(() => {
      result.current.addLine();
    });
    await act(async () => {
      await result.current.submit();
    });

    const call = fetchSpy.mock.calls.find(([u]) => u.toString().includes("/api/stock-receipts/register"));
    expect(call).toBeDefined();
    const body = JSON.parse(String(call![1]!.body));
    expect(body.partnerId).toBe("SUPP-2");
    expect(onSuccess).toHaveBeenCalled();
  });
});

describe("useStockReceiptForm: BUG-071 入荷指示・発注明細との紐づけ", () => {
  function stubWithOrderAndInstruction() {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      const u = url.toString();
      if (u.includes("/api/stock-receipts/register")) return jsonResponse({ message: "OK" });
      if (u.includes("/api/receipt-instructions/RI-1")) {
        return jsonResponse({
          header: { partnerId: "SUPP-2", orderId: "PO-1" },
          items: [
            { id: "RII-1", itemId: "ITEM-1", lotNumber: "NONE", instructedQuantity: 4, accountCode: "A", orderItemId: "POI-1" },
          ],
        });
      }
      if (u.includes("/api/receipt-instructions")) {
        return jsonResponse({ data: [{ id: "RI-1", warehouseId: "WH-1", status: "APPROVED" }] });
      }
      if (u.includes("/api/purchase-orders/PO-1/receipt-progress")) {
        return jsonResponse([
          { orderItemId: "POI-1", itemId: "ITEM-1", itemName: "部品", remainingQuantity: 10 },
        ]);
      }
      if (u.includes("/api/purchase-orders?")) {
        return jsonResponse({ data: [{ id: "PO-1", status: "APPROVED", partnerId: "SUPP-2" }] });
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  async function addAndSubmit(result: { current: ReturnType<typeof useStockReceiptForm> }) {
    act(() => {
      result.current.setSelectedLocation({ id: "LOC-1", warehouseId: "WH-1", name: "A-1" } as never);
      result.current.setSelectedProduct({ id: "ITEM-1", name: "部品" } as never);
      result.current.setQuantity("4");
    });
    act(() => {
      result.current.addLine();
    });
    await act(async () => {
      await result.current.submit();
    });
  }

  it("発注から作った入荷指示を選ぶと、発注・仕入先を引き継ぎ、明細を発注明細と紐づける", async () => {
    const fetchSpy = stubWithOrderAndInstruction();
    const { result } = renderHook(() => useStockReceiptForm(vi.fn()));
    await waitFor(() => expect(result.current.instructions).toHaveLength(1));

    act(() => {
      result.current.setReceiptInstructionId("RI-1");
    });
    await waitFor(() => expect(result.current.instructionItems).toHaveLength(1));
    expect(result.current.orderId).toBe("PO-1");
    expect(result.current.partnerId).toBe("SUPP-2");

    act(() => {
      result.current.applyInstructionItem(result.current.instructionItems[0]);
    });
    await addAndSubmit(result);

    const call = fetchSpy.mock.calls.find(([u]) => u.toString().includes("/api/stock-receipts/register"));
    const body = JSON.parse(String(call![1]!.body));
    expect(body.orderId).toBe("PO-1");
    expect(body.items[0].orderItemId).toBe("POI-1");
  });

  it("発注を選び、明細のボタンを使わずに同じ品目を追加しても発注明細と紐づける", async () => {
    const fetchSpy = stubWithOrderAndInstruction();
    const { result } = renderHook(() => useStockReceiptForm(vi.fn()));
    await waitFor(() => expect(result.current.orderOptions).toHaveLength(1));

    act(() => {
      result.current.setOrderId("PO-1");
    });
    await waitFor(() => expect(result.current.orderItems).toHaveLength(1));
    await addAndSubmit(result);

    const call = fetchSpy.mock.calls.find(([u]) => u.toString().includes("/api/stock-receipts/register"));
    const body = JSON.parse(String(call![1]!.body));
    expect(body.items[0].orderItemId).toBe("POI-1");
  });
});
