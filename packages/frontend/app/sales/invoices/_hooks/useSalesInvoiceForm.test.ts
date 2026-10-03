import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSalesInvoiceForm } from "./useSalesInvoiceForm";
import { PartnerMaster, ProductMaster, SalesOrderItemProgress } from "../_types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const partners: PartnerMaster[] = [
  { id: "CUST-1", name: "得意先A" },
  { id: "CUST-2", name: "得意先B" },
];
const products: ProductMaster[] = [{ id: "PROD-1", name: "品目A", price: 1000 }];
const userMaster = [{ id: "u1", name: "山田太郎", employeeNumber: "E001" }];
const departments = [{ id: "d1", name: "営業部" }];

// 初期化effectの依存配列に含まれるpropsは、レンダーの度に作り直さない(無限ループ防止)
const props = {
  editingId: null,
  invoiceId: "",
  partners,
  products,
  userMaster,
  departments,
  onSubmit: vi.fn(),
  fetchSpecialPrice: vi.fn(async () => null),
};

const progress = (salesOrderItemId: string): SalesOrderItemProgress => ({
  salesOrderItemId,
  itemId: "PROD-1",
  itemName: "品目A",
  inputType: "MASTER",
  quantity: 2,
  unitPrice: 1000,
  unitCode: null,
  taxCategoryCode: null,
  accountCode: null,
  basisQuantity: 2,
  invoicedQuantity: 0,
  remainingQuantity: 2,
  basis: "ORDERED",
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSalesInvoiceForm: BUG-050 受注から選択した時の取引先", () => {
  it("受注を選ぶと、取引先がその受注の得意先に切り替わる", async () => {
    const { result } = renderHook(() => useSalesInvoiceForm(props));
    await waitFor(() => expect(result.current.partnerId).toBe("CUST-1"));

    let error: string | undefined;
    act(() => {
      error = result.current.applyOrderSelection("SO-B", [{ progress: progress("SOI-B1"), quantity: 2 }], null, "CUST-2");
    });

    expect(error).toBeUndefined();
    expect(result.current.partnerId).toBe("CUST-2");
    expect(result.current.items.map((i) => i.sourceOrderItemId)).toEqual(["SOI-B1"]);
  });

  it("別の得意先の受注明細が入っている時は取り込まず、理由を返す", async () => {
    const { result } = renderHook(() => useSalesInvoiceForm(props));
    await waitFor(() => expect(result.current.partnerId).toBe("CUST-1"));
    act(() => {
      result.current.applyOrderSelection("SO-B", [{ progress: progress("SOI-B1"), quantity: 2 }], null, "CUST-2");
    });

    let error: string | undefined;
    act(() => {
      error = result.current.applyOrderSelection("SO-A", [{ progress: progress("SOI-A1"), quantity: 2 }], null, "CUST-1");
    });

    expect(error).toMatch(/得意先/);
    expect(result.current.partnerId).toBe("CUST-2");
    expect(result.current.items.map((i) => i.sourceOrderItemId)).toEqual(["SOI-B1"]);
  });

  it("同じ得意先の受注なら、続けて明細を追加できる", async () => {
    const { result } = renderHook(() => useSalesInvoiceForm(props));
    await waitFor(() => expect(result.current.partnerId).toBe("CUST-1"));
    act(() => {
      result.current.applyOrderSelection("SO-B", [{ progress: progress("SOI-B1"), quantity: 2 }], null, "CUST-2");
    });

    let error: string | undefined;
    act(() => {
      error = result.current.applyOrderSelection("SO-B2", [{ progress: progress("SOI-B2"), quantity: 1 }], null, "CUST-2");
    });

    expect(error).toBeUndefined();
    expect(result.current.items.map((i) => i.sourceOrderItemId)).toEqual(["SOI-B1", "SOI-B2"]);
  });
});

describe("useSalesInvoiceForm: BUG-054 数量の入力と単価の取得の順序", () => {
  it("単価の応答を待たずに品目・数量が反映され、古い入力への応答で数量・単価が上書きされない", async () => {
    const resolvers: Array<(price: number | null) => void> = [];
    const raceProps = {
      ...props,
      fetchSpecialPrice: vi.fn(() => new Promise<number | null>((resolve) => resolvers.push(resolve))),
    };
    const { result } = renderHook(() => useSalesInvoiceForm(raceProps));
    await waitFor(() => expect(result.current.partnerId).toBe("CUST-1"));

    const pending: Promise<void>[] = [];
    act(() => {
      pending.push(result.current.handleItemChange(0, "itemId", "PROD-1"));
    });
    expect(result.current.items[0].itemId).toBe("PROD-1");
    act(() => {
      pending.push(result.current.handleItemChange(0, "quantity", 1));
    });
    act(() => {
      pending.push(result.current.handleItemChange(0, "quantity", 15));
    });
    expect(result.current.items[0].quantity).toBe(15);

    await act(async () => {
      resolvers[2](900);
      resolvers[1](1000);
      resolvers[0](1100);
      await Promise.all(pending);
    });

    expect(result.current.items[0]).toMatchObject({ itemId: "PROD-1", quantity: 15, unitPrice: 900 });
  });
});
