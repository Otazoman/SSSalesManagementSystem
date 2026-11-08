import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { toItemDeliveryDate, useOrderForm } from "./useOrderForm";
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

// BUG-075: ヘッダーの納期(自由入力)が日付なら、明細の納期が空欄のものにだけ入れる
describe("useOrderForm: ヘッダーの納期を明細へ反映する(BUG-075)", () => {
  it("日付の形の文字だけを明細の納期(YYYY-MM-DD)にする", () => {
    expect(toItemDeliveryDate("2026-11-20")).toBe("2026-11-20");
    expect(toItemDeliveryDate(" 2026/1/5 ")).toBe("2026-01-05");
    expect(toItemDeliveryDate("2026-02-30")).toBeNull();
    expect(toItemDeliveryDate("注文確定後、約2週間でお届け")).toBeNull();
    // 年の無い月/日は今年。今日より前の日付なら来年
    expect(toItemDeliveryDate("11/26", "2026-11-08")).toBe("2026-11-26");
    expect(toItemDeliveryDate("1/10", "2026-11-08")).toBe("2027-01-10");
    expect(toItemDeliveryDate("11/2", "2026-11-08")).toBe("2027-11-02");
    expect(toItemDeliveryDate("13/1", "2026-11-08")).toBeNull();
  });

  // ユーザーの確認で見つかった: 1文字ずつ入力すると、途中の「2026/11/2」で 11/02 が入り、続きの入力に追随しなかった
  it("1文字ずつ入力しても、最後に入力した日付が明細に入る。追加した行にもヘッダーの日付が入る", async () => {
    const props = {
      editingId: "SO-1",
      orderId: "SO-1",
      partners,
      products,
      userMaster,
      departments,
      onSubmit: vi.fn(),
      fetchSpecialPrice: vi.fn(async () => null),
      initialData: {
        id: "SO-1",
        partnerId: "CUST-1",
        orderDate: "2026-11-01",
        items: [
          { itemId: "PROD-1", itemName: "品目A", quantity: 1, unitPrice: 1000, deliveryDate: null },
          { itemId: "PROD-1", itemName: "品目A", quantity: 2, unitPrice: 1000, deliveryDate: "2026-12-01" },
        ],
      },
    } as unknown as Parameters<typeof useOrderForm>[0];
    const { result } = renderHook(() => useOrderForm(props));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => result.current.setDeliveryDate(""));
    for (const ch of "2026/11/26") {
      act(() => result.current.setDeliveryDate(result.current.deliveryDate + ch));
    }
    expect(result.current.deliveryDate).toBe("2026/11/26");
    expect(result.current.items.map((i) => i.deliveryDate)).toEqual(["2026-11-26", "2026-12-01"]);

    act(() => result.current.handleAddItemRow());
    expect(result.current.items[2].deliveryDate).toBe("2026-11-26");

    // ヘッダーを変えると、ヘッダーから入れた日付の明細(追加した行を含む)だけが変わる
    act(() => result.current.setDeliveryDate("2026/12/10"));
    expect(result.current.items.map((i) => i.deliveryDate)).toEqual(["2026-12-10", "2026-12-01", "2026-12-10"]);
  });

  it("空欄の明細にだけ入れ、入力済みの明細は変えない。日付でない文字では明細を変えない", async () => {
    const props = {
      editingId: "SO-1",
      orderId: "SO-1",
      partners,
      products,
      userMaster,
      departments,
      onSubmit: vi.fn(),
      fetchSpecialPrice: vi.fn(async () => null),
      initialData: {
        id: "SO-1",
        partnerId: "CUST-1",
        orderDate: "2026-11-01",
        items: [
          { itemId: "PROD-1", itemName: "品目A", quantity: 1, unitPrice: 1000, deliveryDate: null },
          { itemId: "PROD-1", itemName: "品目A", quantity: 2, unitPrice: 1000, deliveryDate: "2026-12-01" },
        ],
      },
    } as unknown as Parameters<typeof useOrderForm>[0];
    const { result } = renderHook(() => useOrderForm(props));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => result.current.setDeliveryDate("約2週間"));
    expect(result.current.items.map((i) => i.deliveryDate ?? null)).toEqual([null, "2026-12-01"]);

    act(() => result.current.setDeliveryDate("2026-11-20"));
    expect(result.current.deliveryDate).toBe("2026-11-20");
    expect(result.current.items.map((i) => i.deliveryDate)).toEqual(["2026-11-20", "2026-12-01"]);
  });
});
