import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
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
  lines: [
    { itemId: "ITEM-1", itemName: "テスト品目A", instructedQuantity: 5 },
    { itemId: "ITEM-2", itemName: "テスト品目B", instructedQuantity: 3 },
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
  lines: [{ itemId: "X", itemName: "X", instructedQuantity: 1 }],
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
