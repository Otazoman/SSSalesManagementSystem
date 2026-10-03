import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useStockShipmentForm } from "./useStockShipmentForm";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PRODUCTS = [{ id: "ITEM-1", name: "テスト品目A" }];
const SALES_ORDERS = { data: [{ id: "SO-1", status: "APPROVED" }] };
const SHIPMENT_PROGRESS = [
  { salesOrderItemId: "SOI-1", itemId: "ITEM-1", itemName: "テスト品目A", remainingQuantity: 4 },
  { salesOrderItemId: "SOI-2", itemId: "ITEM-2", itemName: "テスト品目B", remainingQuantity: 0 },
];

function mockFetch() {
  const fetchSpy = vi.fn(async (url: string) => {
    const u = url.toString();
    if (u.includes("/shipment-progress")) return jsonResponse(SHIPMENT_PROGRESS);
    if (u.includes("/api/sales-orders")) return jsonResponse(SALES_ORDERS);
    if (u.includes("/api/products")) return jsonResponse(PRODUCTS);
    if (u.includes("/api/shipment-instructions")) return jsonResponse({ data: [] });
    return jsonResponse([]);
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Item9残課題: 手動スキャン出庫でも、出荷指示を経由せず直接「受注から選ぶ」で受注残と
// 消込できることを確認する(useStockReceiptForm.tsの「発注から選ぶ」と対称の機能)
describe("useStockShipmentForm: 受注から選ぶ(出荷指示を経由しない直接消込)", () => {
  it("APPROVEDな受注一覧を取得し、選択すると残数量のある明細のみをorderItemsへ反映する", async () => {
    mockFetch();
    const { result } = renderHook(() => useStockShipmentForm(vi.fn()));

    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    expect(result.current.orders[0].id).toBe("SO-1");

    await act(async () => {
      result.current.setSalesOrderId("SO-1");
    });

    await waitFor(() => expect(result.current.orderItems).toHaveLength(1));
    // remainingQuantity=0のSOI-2は候補から除外される
    expect(result.current.orderItems[0].salesOrderItemId).toBe("SOI-1");
  });

  it("applyOrderItemで品目・数量が入力欄へ反映され、追加した明細にsalesOrderItemIdが引き継がれる", async () => {
    mockFetch();
    const { result } = renderHook(() => useStockShipmentForm(vi.fn()));

    await waitFor(() => expect(result.current.products).toHaveLength(1));

    await act(async () => {
      result.current.setSalesOrderId("SO-1");
    });
    await waitFor(() => expect(result.current.orderItems).toHaveLength(1));

    act(() => {
      result.current.applyOrderItem(result.current.orderItems[0]);
    });

    expect(result.current.selectedProduct?.id).toBe("ITEM-1");
    expect(result.current.quantity).toBe("4");
  });
});

// 新規要望(2026-09-23): 倉庫間移動。得意先/移動先倉庫は排他選択(一方を選ぶと他方は自動でクリアする)
describe("useStockShipmentForm: 得意先と移動先倉庫の排他選択", () => {
  it("移動先倉庫を選ぶと得意先はクリアされる", async () => {
    mockFetch();
    const { result } = renderHook(() => useStockShipmentForm(vi.fn()));

    act(() => {
      result.current.setPartnerId("PARTNER-1");
    });
    expect(result.current.partnerId).toBe("PARTNER-1");

    act(() => {
      result.current.setDestinationWarehouseId("WH-2");
    });
    expect(result.current.destinationWarehouseId).toBe("WH-2");
    expect(result.current.partnerId).toBe("");
  });

  it("得意先を選ぶと移動先倉庫はクリアされる", async () => {
    mockFetch();
    const { result } = renderHook(() => useStockShipmentForm(vi.fn()));

    act(() => {
      result.current.setDestinationWarehouseId("WH-2");
    });
    expect(result.current.destinationWarehouseId).toBe("WH-2");

    act(() => {
      result.current.setPartnerId("PARTNER-1");
    });
    expect(result.current.partnerId).toBe("PARTNER-1");
    expect(result.current.destinationWarehouseId).toBe("");
  });
});

// 出庫: ロケーションに出庫できる商品が1つだけなら、商品スキャンを省いて数量の入力だけで出庫できる
describe("useStockShipmentForm: 1品目だけのロケーションは品目を自動選択する", () => {
  const WAREHOUSES = [{ id: "W-1", name: "自社倉庫", warehouseType: "INTERNAL", status: "active" }];
  const LOCATIONS = ["LOC-A", "LOC-B", "LOC-C", "LOC-D"].map((id) => ({
    id,
    warehouseId: "W-1",
    name: `棚${id}`,
    status: "active",
  }));
  const PRODUCT_LIST = [
    { id: "ITEM-1", name: "品目1", productBarcode: null, accountCode: null, baseUnitCode: "PCS", status: "active" },
    { id: "ITEM-2", name: "品目2", productBarcode: null, accountCode: null, baseUnitCode: "PCS", status: "active" },
  ];
  const stock = (locationId: string, itemId: string, quantity: number, lotNumber = "LOT-1") => ({
    id: `${locationId}-${itemId}-${lotNumber}`,
    itemId,
    itemName: itemId,
    warehouseId: "W-1",
    warehouseName: "自社倉庫",
    locationId,
    locationName: locationId,
    lotNumber,
    accountCode: "1000",
    qualityStatus: "NORMAL",
    quantity,
    updatedAt: "2026-09-22",
  });
  const STOCKS = [
    stock("LOC-A", "ITEM-1", 10), // 1行だけ
    stock("LOC-B", "ITEM-1", 5, "LOT-1"), // 同じ商品でもロットが2つ
    stock("LOC-B", "ITEM-1", 5, "LOT-2"),
    stock("LOC-C", "ITEM-2", 7), // 別の商品が1行だけ
    stock("LOC-D", "ITEM-1", 3), // 数量0の行は数えない
    stock("LOC-D", "ITEM-2", 0),
  ];

  function mockStockFetch() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = url.toString();
        if (u.includes("/api/locations")) return jsonResponse(LOCATIONS);
        if (u.includes("/api/warehouses")) return jsonResponse(WAREHOUSES);
        if (u.includes("/api/products")) return jsonResponse(PRODUCT_LIST);
        if (u.includes("/api/stocks")) return jsonResponse(STOCKS);
        if (u.includes("/api/shipment-instructions") || u.includes("/api/sales-orders")) {
          return jsonResponse({ data: [] });
        }
        return jsonResponse([]);
      }),
    );
  }

  async function setup() {
    mockStockFetch();
    const hook = renderHook(() => useStockShipmentForm(vi.fn()));
    await waitFor(() => expect(hook.result.current.stocksAtLocation("LOC-A")).toHaveLength(1));
    return hook.result;
  }

  const location = (id: string) => LOCATIONS.find((l) => l.id === id)!;

  it("在庫の行が1つだけのロケーションを選ぶと、その品目が自動で選ばれ、数量だけで明細に追加できる", async () => {
    const result = await setup();

    act(() => result.current.setSelectedLocation(location("LOC-A")));
    expect(result.current.selectedProduct?.id).toBe("ITEM-1");
    expect(result.current.productAutoSelected).toBe(true);

    act(() => result.current.setQuantity("4"));
    act(() => result.current.addLine());
    expect(result.current.error).toBe("");
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0]).toMatchObject({
      locationId: "LOC-A",
      itemId: "ITEM-1",
      quantity: 4,
      lotNumber: "LOT-1",
    });
  });

  it("同じ品目でもロットが複数あるロケーションは、従来どおり自動選択しない", async () => {
    const result = await setup();
    act(() => result.current.setSelectedLocation(location("LOC-B")));
    expect(result.current.selectedProduct).toBeNull();
    expect(result.current.productAutoSelected).toBe(false);
  });

  it("数量0の行は数えず、出庫できる行が1つだけなら自動選択する", async () => {
    const result = await setup();
    act(() => result.current.setSelectedLocation(location("LOC-D")));
    expect(result.current.selectedProduct?.id).toBe("ITEM-1");
  });

  it("ユーザーが先に選んだ品目は、自動選択で上書きしない", async () => {
    const result = await setup();
    act(() => result.current.setSelectedProduct(PRODUCT_LIST[1]));
    act(() => result.current.setSelectedLocation(location("LOC-A")));
    expect(result.current.selectedProduct?.id).toBe("ITEM-2");
    expect(result.current.productAutoSelected).toBe(false);
  });

  it("自動で選んだ品目は、別のロケーションを選ぶと入れ替わり、複数行のロケーションでは外れる", async () => {
    const result = await setup();
    act(() => result.current.setSelectedLocation(location("LOC-A")));
    expect(result.current.selectedProduct?.id).toBe("ITEM-1");

    act(() => result.current.setSelectedLocation(location("LOC-C")));
    expect(result.current.selectedProduct?.id).toBe("ITEM-2");
    expect(result.current.productAutoSelected).toBe(true);

    act(() => result.current.setSelectedLocation(location("LOC-B")));
    expect(result.current.selectedProduct).toBeNull();
    expect(result.current.productAutoSelected).toBe(false);
  });

  it("自動選択のあとでユーザーが品目を選び直すと、以後は上書きされない", async () => {
    const result = await setup();
    act(() => result.current.setSelectedLocation(location("LOC-A")));
    act(() => result.current.setSelectedProduct(PRODUCT_LIST[1]));
    expect(result.current.productAutoSelected).toBe(false);

    act(() => result.current.setSelectedLocation(location("LOC-C")));
    expect(result.current.selectedProduct?.id).toBe("ITEM-2");
    act(() => result.current.setSelectedLocation(location("LOC-A")));
    expect(result.current.selectedProduct?.id).toBe("ITEM-2");
  });
});
