import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useOrders } from "./useOrders";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useOrders: 品目マスタ取得(fetchProducts)", () => {
  it("GET /api/productsのstandardSalesPriceをProductMaster.priceへ変換する", async () => {
    // useQuotes.tsのfetchProductsと同じ方針。products.repository.tsは
    // standardSalesPrice/standardPurchasePriceで返すため、`price`キーへの変換が必要
    const fetchSpy = vi.fn(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/products")) {
        return jsonResponse([
          { id: "PROD-1", name: "品目A", standardSalesPrice: 800, baseUnitCode: "PCS" },
        ]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useOrders({ canRead: true, permsLoading: false }));

    await waitFor(() => expect(result.current.products).toHaveLength(1));
    expect(result.current.products[0].price).toBe(800);
  });
});

describe("useOrders: 得意先特価取得(fetchSpecialPrice)", () => {
  it("/api/product-pricesをpartnerId=で呼び出す(customerId=は旧backendのvalibotスキーマに存在しないパラメータ名)", async () => {
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => jsonResponse([]),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useOrders({ canRead: false, permsLoading: false }));

    await result.current.fetchSpecialPrice("PARTNER-1", "PROD-1", 5);

    const calledUrl = fetchSpy.mock.calls.map((c) => String(c[0])).find((u) => u.includes("/api/product-prices"));
    expect(calledUrl).toContain("partnerId=PARTNER-1");
    expect(calledUrl).not.toContain("customerId=");
  });
});
