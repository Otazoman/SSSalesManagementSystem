import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePurchaseOrderOperations } from "./usePurchaseOrderOperations";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("usePurchaseOrderOperations: BUG-061 CSV取込の上書きの確認", () => {
  const csvFile = () => new File(["id"], "orders.csv", { type: "text/csv" });
  const setup = () => {
    const fetchSpy = vi.fn(async (url: string) => (url.toString().includes("bulk-register") ? json({ message: "ok" }) : json([])));
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      usePurchaseOrderOperations({ canRead: true, isPurchaseOrderWfEnabled: false }),
    );
    const bulkCalls = () => fetchSpy.mock.calls.filter(([url]) => url.toString().includes("/api/purchase-orders/bulk-register"));
    return { result, bulkCalls };
  };

  it("取込の前に上書きの確認を出し、キャンセルなら取り込まない", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result, bulkCalls } = setup();

    await act(async () => {
      await result.current.handleImportCsv(csvFile());
    });

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("上書きされます"));
    expect(bulkCalls()).toHaveLength(0);
  });

  it("確認で続けると取り込む", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result, bulkCalls } = setup();

    await act(async () => {
      await result.current.handleImportCsv(csvFile());
    });

    expect(bulkCalls()).toHaveLength(1);
  });
});

// 新規要望(2026-10-19): 過去の発注を複写して新規作成フォームを開く
describe("usePurchaseOrderOperations: 発注の複写", () => {
  const source = {
    id: "PO-1",
    title: "元の発注",
    partnerId: "SUP-1",
    requestId: "PR-1",
    orderDate: "2026-01-10",
    status: "APPROVED",
    projectId: "PJ-1",
    totalAmount: 1100,
    memo: "メモ",
    deliveryDate: "2026-02-01",
    deliveryPlace: "本社倉庫",
    paymentTerms: "月末締め翌月末払い",
    purchasePersonEmployeeNumber: "E-100",
    inputPersonEmployeeNumber: "E-200",
    isPaid: true,
    paidAt: "2026-01-20",
    attachments: [{ id: "ATT-1", fileName: "a.pdf", storageType: "R2" }],
    items: [
      {
        id: "OI-1",
        itemId: "ITEM-1",
        itemName: "部品A",
        inputType: "MASTER",
        quantity: 5,
        unitPrice: 200,
        purchaseRequestItemId: "PRI-1",
        salesOrderItemId: "SOI-1",
        requestedDeliveryDate: "2026-02-01",
        answeredDeliveryDate: "2026-02-05",
      },
    ],
  };

  const setup = (isPurchaseOrderWfEnabled: boolean) => {
    const fetchSpy = vi.fn(async (url: string) =>
      url.toString().includes("/api/purchase-orders/PO-1") ? json(source) : json([]),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      usePurchaseOrderOperations({
        canRead: true,
        isPurchaseOrderWfEnabled,
        currentUserEmployeeNumber: "E-999",
      }),
    );
    return { result };
  };

  it("引き継がない項目を外して新規作成フォームを開く", async () => {
    const { result } = setup(false);

    await act(async () => {
      await result.current.handleCopyToNewForm({ id: "PO-1" } as never);
    });

    const r = result.current;
    expect(r.viewMode).toBe("FORM");
    expect(r.editingId).toBeNull();
    expect(r.title).toBe("元の発注(コピー)");
    expect(r.partnerId).toBe("SUP-1");
    expect(r.projectId).toBe("PJ-1");
    expect(r.deliveryPlace).toBe("本社倉庫");
    expect(r.paymentTerms).toBe("月末締め翌月末払い");
    expect(r.purchasePersonEmployeeNumber).toBe("E-100");
    // 引き継がない項目
    expect(r.requestId).toBeNull();
    expect(r.orderDate).not.toBe("2026-01-10");
    expect(r.inputPersonEmployeeNumber).toBe("E-999");
    expect(r.isPaid).toBe(false);
    expect(r.paidAt).toBe("");
    expect(r.deliveryDate).toBe("");
    expect(r.attachments).toEqual([]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      id: undefined,
      itemId: "ITEM-1",
      quantity: 5,
      unitPrice: 200,
      purchaseRequestItemId: null,
      salesOrderItemId: null,
      requestedDeliveryDate: null,
      answeredDeliveryDate: null,
    });
  });

  it("承認機能が有効な場合は複写しない", async () => {
    const { result } = setup(true);

    await act(async () => {
      await result.current.handleCopyToNewForm({ id: "PO-1" } as never);
    });

    expect(result.current.viewMode).toBe("LIST");
    expect(result.current.error).toContain("購買申請から発注を作成");
  });
});
