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
