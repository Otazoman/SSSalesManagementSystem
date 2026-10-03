import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
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
