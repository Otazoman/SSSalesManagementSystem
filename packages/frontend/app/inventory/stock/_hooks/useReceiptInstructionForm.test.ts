import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useReceiptInstructionForm } from "./useReceiptInstructionForm";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch() {
  const fetchSpy = vi.fn(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/warehouses")) return jsonResponse([]);
    if (u.includes("/api/partners")) return jsonResponse([]);
    // editTargetの復元effectはproducts.length===0の間ブロックされるため、
    // 空配列のままだと編集対象の復元が永久に走らない
    if (u.includes("/api/products")) return jsonResponse([{ id: "ITEM-1", name: "テスト品目A" }]);
    return jsonResponse([]);
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// レンダーコールバック内で配列/オブジェクトリテラルを直接渡すと、renderHookの再レンダーの度に
// 新しい参照が生成され、それに依存するuseEffectが無限に再発火してしまう
// (usePurchaseRequisitionOperations.test.tsの EMPTY_CUSTOMERS と同じ理由)。
// 依存配列に載る値は必ずこの安定した参照を使う
const EMPTY_DEPARTMENTS: never[] = [];
const PREFILL = {
  partnerId: "SUPP-1",
  orderId: "PO-1",
  lines: [
    { itemId: "ITEM-1", itemName: "テスト品目A", instructedQuantity: 5, orderItemId: "POI-1" },
    { itemId: "ITEM-2", itemName: "テスト品目B", instructedQuantity: 3, orderItemId: "POI-2" },
  ],
};
const EDIT_TARGET = {
  headerId: "RI-1",
  partnerId: "SUPP-EDIT",
  warehouseId: "WH-EDIT",
  instructedReceiveDate: "2026-08-01",
  memo: null,
  items: [],
};
const EDIT_PREFILL = {
  partnerId: "SUPP-PREFILL",
  orderId: "PO-X",
  lines: [{ itemId: "X", itemName: "X", instructedQuantity: 1, orderItemId: "POI-X" }],
};

// Item9: 発注画面の「入荷指示を作成する」・入荷指示画面の「発注から選ぶ」からの新規作成prefill。
// 発注には受注のような倉庫引当(reservation)が無いため、warehouseIdはprefillせず
// 仕入先と明細のみを自動投入することを確認する
describe("useReceiptInstructionForm: createPrefillによる発注からの自動prefill", () => {
  it("createPrefillのpartnerId・明細がフォームへ反映される(warehouseIdは反映しない)", async () => {
    mockFetch();

    const { result } = renderHook(() => useReceiptInstructionForm(vi.fn(), null, EMPTY_DEPARTMENTS, PREFILL));

    await waitFor(() => expect(result.current.partnerId).toBe("SUPP-1"));
    expect(result.current.warehouseId).toBe("");
    expect(result.current.lines).toHaveLength(2);
    expect(result.current.lines[0]).toMatchObject({
      itemId: "ITEM-1",
      itemName: "テスト品目A",
      instructedQuantity: 5,
      lotNumber: "NONE",
    });
  });

  it("editTargetが指定されている場合はcreatePrefillより優先される", async () => {
    mockFetch();

    const { result } = renderHook(() =>
      useReceiptInstructionForm(vi.fn(), EDIT_TARGET, EMPTY_DEPARTMENTS, EDIT_PREFILL),
    );

    await waitFor(() => expect(result.current.partnerId).toBe("SUPP-EDIT"));
    expect(result.current.warehouseId).toBe("WH-EDIT");
  });
});

describe("useReceiptInstructionForm: BUG-071 発注から作った入荷指示", () => {
  it("createPrefillの発注・発注明細をフォームに持ち、作成時に送る", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/receipt-instructions/register")) {
        return new Response(JSON.stringify({ message: "OK", body: init?.body }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useReceiptInstructionForm(vi.fn(), null, EMPTY_DEPARTMENTS, PREFILL));
    await waitFor(() => expect(result.current.orderId).toBe("PO-1"));
    act(() => {
      result.current.setWarehouseId("WH-EXT");
    });
    await act(async () => {
      await result.current.submit();
    });

    const call = fetchSpy.mock.calls.find(([u]) => u.toString().includes("/api/receipt-instructions/register"));
    expect(call).toBeDefined();
    const body = JSON.parse(String(call![1]!.body));
    expect(body.orderId).toBe("PO-1");
    expect(body.items.map((i: { orderItemId: string }) => i.orderItemId)).toEqual(["POI-1", "POI-2"]);
  });
});

// REQ-010・BUG-091: 倉庫の選択肢と、発注の納品先倉庫の引き継ぎ
describe("useReceiptInstructionForm: REQ-010 倉庫の選択肢・BUG-091 発注の納品先倉庫", () => {
  const WAREHOUSES = [
    { id: "WH-IN", name: "本社倉庫", warehouseType: "INTERNAL" },
    { id: "WH-EX", name: "外部倉庫", warehouseType: "EXTERNAL" },
    { id: "WH-DIR", name: "直送", warehouseType: "DIRECT" },
  ];
  function mockWithWarehouses() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = url.toString();
        if (u.includes("/api/warehouses")) return jsonResponse(WAREHOUSES);
        if (u.includes("/api/products")) return jsonResponse([{ id: "ITEM-1", name: "テスト品目A" }]);
        return jsonResponse([]);
      }),
    );
  }
  const PREFILL_IN = { ...PREFILL, warehouseId: "WH-IN" };
  const PREFILL_DIRECT = { ...PREFILL, warehouseId: "WH-DIR" };

  it("自社倉庫・外部倉庫を選べ、直送用の倉庫は選択肢に出さない", async () => {
    mockWithWarehouses();
    const { result } = renderHook(() => useReceiptInstructionForm(vi.fn(), null, EMPTY_DEPARTMENTS, null));
    await waitFor(() => expect(result.current.warehouses.map((w) => w.id)).toEqual(["WH-IN", "WH-EX"]));
  });

  it("発注の納品先倉庫が選択肢にあれば、倉庫の初期値にする", async () => {
    mockWithWarehouses();
    const { result } = renderHook(() => useReceiptInstructionForm(vi.fn(), null, EMPTY_DEPARTMENTS, PREFILL_IN));
    await waitFor(() => expect(result.current.warehouseId).toBe("WH-IN"));
  });

  it("発注の納品先倉庫が選択肢に無ければ(直送用など)、初期値にしない", async () => {
    mockWithWarehouses();
    const { result } = renderHook(() => useReceiptInstructionForm(vi.fn(), null, EMPTY_DEPARTMENTS, PREFILL_DIRECT));
    await waitFor(() => expect(result.current.partnerId).toBe("SUPP-1"));
    await waitFor(() => expect(result.current.warehouses).toHaveLength(2));
    expect(result.current.warehouseId).toBe("");
  });
});
