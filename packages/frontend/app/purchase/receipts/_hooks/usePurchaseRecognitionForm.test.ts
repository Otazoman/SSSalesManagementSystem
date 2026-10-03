import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePurchaseRecognitionForm } from "./usePurchaseRecognitionForm";
import { PartnerMaster, ProductMaster, OrderItemProgress } from "../_types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const partners: PartnerMaster[] = [
  { id: "SUPP-1", name: "仕入先A" },
  { id: "SUPP-2", name: "仕入先B" },
];
const products: ProductMaster[] = [{ id: "PROD-1", name: "品目A" }];
const userMaster = [{ id: "u1", name: "山田太郎", employeeNumber: "E001" }];
const departments = [{ id: "d1", name: "営業部" }];

// 初期化effectの依存配列に含まれるpropsは、レンダーの度に作り直さない(無限ループ防止)
const props = {
  editingId: null,
  recognitionId: "",
  partners,
  products,
  userMaster,
  departments,
  onSubmit: vi.fn(),
};

const progress = (salesOrderItemId: string): OrderItemProgress => ({
  sourceOrderItemId: salesOrderItemId,
  itemId: "PROD-1",
  itemName: "品目A",
  inputType: "MASTER",
  quantity: 2,
  unitPrice: 1000,
  unitCode: null,
  taxCategoryCode: null,
  accountCode: null,
  basisQuantity: 2,
  recognizedQuantity: 0,
  remainingQuantity: 2,
  basis: "ORDERED",
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePurchaseRecognitionForm: BUG-050 発注から選択した時の取引先", () => {
  it("発注を選ぶと、取引先がその発注の仕入先に切り替わる", async () => {
    const { result } = renderHook(() => usePurchaseRecognitionForm(props));
    await waitFor(() => expect(result.current.partnerId).toBe("SUPP-1"));

    let error: string | undefined;
    act(() => {
      error = result.current.applyOrderSelection("PO-B", [{ progress: progress("POI-B1"), quantity: 2 }], null, "SUPP-2");
    });

    expect(error).toBeUndefined();
    expect(result.current.partnerId).toBe("SUPP-2");
    expect(result.current.items.map((i) => i.sourceOrderItemId)).toEqual(["POI-B1"]);
  });

  it("別の仕入先の発注明細が入っている時は取り込まず、理由を返す", async () => {
    const { result } = renderHook(() => usePurchaseRecognitionForm(props));
    await waitFor(() => expect(result.current.partnerId).toBe("SUPP-1"));
    act(() => {
      result.current.applyOrderSelection("PO-B", [{ progress: progress("POI-B1"), quantity: 2 }], null, "SUPP-2");
    });

    let error: string | undefined;
    act(() => {
      error = result.current.applyOrderSelection("PO-A", [{ progress: progress("POI-A1"), quantity: 2 }], null, "SUPP-1");
    });

    expect(error).toMatch(/仕入先/);
    expect(result.current.partnerId).toBe("SUPP-2");
    expect(result.current.items.map((i) => i.sourceOrderItemId)).toEqual(["POI-B1"]);
  });

  it("同じ仕入先の発注なら、続けて明細を追加できる", async () => {
    const { result } = renderHook(() => usePurchaseRecognitionForm(props));
    await waitFor(() => expect(result.current.partnerId).toBe("SUPP-1"));
    act(() => {
      result.current.applyOrderSelection("PO-B", [{ progress: progress("POI-B1"), quantity: 2 }], null, "SUPP-2");
    });

    let error: string | undefined;
    act(() => {
      error = result.current.applyOrderSelection("PO-B2", [{ progress: progress("POI-B2"), quantity: 1 }], null, "SUPP-2");
    });

    expect(error).toBeUndefined();
    expect(result.current.items.map((i) => i.sourceOrderItemId)).toEqual(["POI-B1", "POI-B2"]);
  });
});
