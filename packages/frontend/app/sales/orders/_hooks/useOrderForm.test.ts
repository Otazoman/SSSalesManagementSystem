import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useOrderForm } from "./useOrderForm";
import { PartnerMaster, ProductMaster } from "../_types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const partners: PartnerMaster[] = [{ id: "CUST-1", name: "得意先A" }];
const products: ProductMaster[] = [{ id: "PROD-1", name: "品目A", price: 1000 }];
const userMaster = [{ id: "u1", name: "山田太郎", employeeNumber: "E001" }];
const departments = [{ id: "d1", name: "営業部" }];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useOrderForm: BUG-054 数量の入力と単価の取得の順序", () => {
  it("単価の応答を待たずに品目・数量が反映され、古い入力への応答で数量・単価が上書きされない", async () => {
    const resolvers: Array<(price: number | null) => void> = [];
    // 初期化effectの依存配列に含まれるpropsは、レンダーの度に作り直さない(無限ループ防止)
    const props = {
      editingId: null,
      orderId: "",
      partners,
      products,
      userMaster,
      departments,
      onSubmit: vi.fn(),
      fetchSpecialPrice: vi.fn(() => new Promise<number | null>((resolve) => resolvers.push(resolve))),
    };
    const { result } = renderHook(() => useOrderForm(props));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

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

describe("useOrderForm: BUG-054 取引先の変更と単価の取り直し", () => {
  it("取引先を変えた直後に数量を入力しても、取引先変更による単価の取り直しで数量が戻らない", async () => {
    const resolvers: Array<(price: number | null) => void> = [];
    const twoPartners: PartnerMaster[] = [
      { id: "CUST-1", name: "得意先A" },
      { id: "CUST-2", name: "得意先B" },
    ];
    const props = {
      editingId: null,
      orderId: "",
      partners: twoPartners,
      products,
      userMaster,
      departments,
      onSubmit: vi.fn(),
      fetchSpecialPrice: vi.fn(() => new Promise<number | null>((resolve) => resolvers.push(resolve))),
    };
    const { result } = renderHook(() => useOrderForm(props));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      const done = result.current.handleItemChange(0, "itemId", "PROD-1");
      resolvers[resolvers.length - 1](1000);
      await done;
    });

    const pending: Promise<void>[] = [];
    act(() => {
      pending.push(result.current.handlePartnerChange("CUST-2"));
    });
    const partnerChangeIndex = resolvers.length - 1;
    act(() => {
      pending.push(result.current.handleItemChange(0, "quantity", 5));
    });
    const quantityIndex = resolvers.length - 1;

    await act(async () => {
      resolvers[partnerChangeIndex](777);
      resolvers[quantityIndex](900);
      await Promise.all(pending);
    });

    expect(result.current.partnerId).toBe("CUST-2");
    expect(result.current.items[0]).toMatchObject({ itemId: "PROD-1", quantity: 5, unitPrice: 900 });
  });
});
