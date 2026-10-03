import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePurchaseRequisitionOperations } from "./usePurchaseRequisitionOperations";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function defaultProps(overrides: Partial<Parameters<typeof usePurchaseRequisitionOperations>[0]> = {}) {
  return {
    canRead: true,
    isPurchaseRequisitionWfEnabled: false,
    departments: [],
    permsLoading: false,
    ...overrides,
  };
}

function mockInitialFetches(
  fetchSpy: ReturnType<typeof vi.fn>,
  data: {
    items?: unknown[];
    projects?: unknown[];
    departments?: unknown[];
    requisitions?: unknown[];
    suppliers?: unknown[];
    // 一覧は明細を含まないため、編集時はGET /api/purchase-requisitions/:id で取り直す。
    // そのIDごとの詳細レスポンス
    requisitionDetails?: Record<string, unknown>;
  } = {},
) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/products")) return jsonResponse(data.items ?? []);
    if (u.includes("/api/projects")) return jsonResponse(data.projects ?? []);
    if (u.includes("/api/partners")) return jsonResponse(data.suppliers ?? []);
    if (u.includes("/api/departments")) return jsonResponse(data.departments ?? []);
    if (u.includes("/api/users")) return jsonResponse([]);
    if (u.includes("/api/units")) return jsonResponse([]);
    if (u.includes("/api/tax-categories")) return jsonResponse([]);
    const detailMatch = u.match(/\/api\/purchase-requisitions\/([^/?]+)$/);
    if (detailMatch) {
      return jsonResponse(data.requisitionDetails?.[detailMatch[1]] ?? {});
    }
    if (u.includes("/api/purchase-requisitions")) return jsonResponse(data.requisitions ?? []);
    return jsonResponse({});
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePurchaseRequisitionOperations", () => {
  it("初期状態: マスタと一覧を取得する", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, {
      items: [{ id: "ITEM-1", name: "テスト品目" }],
      projects: [{ id: "PJ-1", name: "本社移転" }],
      requisitions: [{ id: "PR-1", title: "既存申請", status: "DRAFT", requestType: "ONE_TIME", totalAmount: 1000 }],
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));

    await waitFor(() => expect(result.current.allItems).toEqual([{ id: "ITEM-1", name: "テスト品目" }]));
    expect(result.current.projects).toEqual([{ id: "PJ-1", name: "本社移転" }]);
    await waitFor(() => expect(result.current.requisitions).toHaveLength(1));
  });

  it("新規登録: /api/purchase-requisitions/registerへFormDataでPOSTする", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));
    await waitFor(() => expect(result.current.requisitions).toEqual([]));

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/purchase-requisitions/register")) {
        const formData = init?.body as FormData;
        const payload = JSON.parse(formData.get("requisitionData") as string);
        expect(payload.title).toBe("事務用品購入");
        expect(payload.departmentSurrogateId).toBe("D001");
        expect(payload.requestType).toBe("ONE_TIME");
        return jsonResponse({ id: "PR-NEW-1" });
      }
      return jsonResponse([]);
    });

    act(() => {
      result.current.setTitle("事務用品購入");
      result.current.setDepartmentSurrogateId("D001");
      result.current.setPartnerId("PARTNER-1");
      result.current.setProjectId("PJ-1");
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    });

    expect(result.current.message).toBe("購買申請を新規登録しました");
    expect(result.current.editingId).toBe("PR-NEW-1");
  });

  it("品目未入力の明細行があるとエラーになりAPIを呼ばない", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));
    await waitFor(() => expect(result.current.requisitions).toEqual([]));

    act(() => {
      result.current.setTitle("テスト");
      result.current.setDepartmentSurrogateId("D001");
      result.current.addItemRow();
    });

    const registerCalls: string[] = [];
    fetchSpy.mockImplementation(async (url: string) => {
      registerCalls.push(url.toString());
      return jsonResponse({});
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    });

    expect(result.current.error).toContain("品目");
    expect(registerCalls.some((u) => u.includes("/register"))).toBe(false);
  });

  it("仕入先・勘定科目が未入力だとエラーになりAPIを呼ばない", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));
    await waitFor(() => expect(result.current.requisitions).toEqual([]));

    act(() => {
      result.current.setTitle("テスト");
      result.current.setDepartmentSurrogateId("D001");
    });

    const registerCalls: string[] = [];
    fetchSpy.mockImplementation(async (url: string) => {
      registerCalls.push(url.toString());
      return jsonResponse({});
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    });

    expect(result.current.error).toContain("仕入先");
    expect(registerCalls.some((u) => u.includes("/register"))).toBe(false);

    act(() => {
      result.current.setPartnerId("PARTNER-1");
    });
    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    });
    expect(result.current.error).toContain("勘定科目");
    expect(registerCalls.some((u) => u.includes("/register"))).toBe(false);
  });

  it("編集開始: 一覧は明細を含まないため、GET /api/purchase-requisitions/:id で明細を取り直してフォームへ反映する", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, {
      // 一覧レスポンスにはitemsが無い(backendのsearchRequisitionsが明細を返さないため)
      requisitions: [{ id: "PR-1", title: "申請1", status: "DRAFT", requestType: "ONE_TIME", totalAmount: 1000 }],
      requisitionDetails: {
        "PR-1": {
          id: "PR-1",
          title: "申請1",
          status: "DRAFT",
          requestType: "ONE_TIME",
          totalAmount: 1000,
          items: [
            { itemId: "ITEM-1", itemName: "テスト品目", inputType: "MASTER", quantity: 2, estimatedUnitPrice: 500 },
          ],
        },
      },
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));
    await waitFor(() => expect(result.current.requisitions).toHaveLength(1));

    await act(async () => {
      await result.current.handleSelectEdit(result.current.requisitions[0]);
    });

    // 詳細取得を経由しないと明細が空のままフォームが開き、上書き保存で明細が全消しされる
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].itemId).toBe("ITEM-1");
    expect(result.current.viewMode).toBe("FORM");
  });

  it("編集開始: 詳細取得に失敗した場合はフォームを開かず、明細が空のまま保存されるのを防ぐ", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, {
      requisitions: [{ id: "PR-1", title: "申請1", status: "DRAFT", requestType: "ONE_TIME", totalAmount: 1000 }],
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));
    await waitFor(() => expect(result.current.requisitions).toHaveLength(1));

    const listed = result.current.requisitions[0];
    fetchSpy.mockImplementation(async () => new Response("", { status: 500 }));

    await act(async () => {
      await result.current.handleSelectEdit(listed);
    });

    expect(result.current.viewMode).toBe("LIST");
    expect(result.current.editingId).toBeNull();
    expect(result.current.error).not.toBe("");
  });

  it("承認申請: /api/purchase-requisitions/:id/submit-for-approvalへPOSTする", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, {
      requisitions: [{ id: "PR-1", title: "申請1", status: "DRAFT", requestType: "ONE_TIME", totalAmount: 1000 }],
      requisitionDetails: {
        "PR-1": { id: "PR-1", title: "申請1", status: "DRAFT", requestType: "ONE_TIME", totalAmount: 1000, items: [] },
      },
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));
    await waitFor(() => expect(result.current.requisitions).toHaveLength(1));

    await act(async () => {
      await result.current.handleSelectEdit(result.current.requisitions[0]);
    });
    expect(result.current.editingId).toBe("PR-1");

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/submit-for-approval")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ message: "承認を申請しました" });
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.handleSubmitForApproval();
    });

    expect(result.current.message).toBe("承認を申請しました");
  });

  it("削除申請: /api/purchase-requisitions/:id/request-deletionへPOSTする", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));
    await waitFor(() => expect(result.current.requisitions).toEqual([]));

    const calledUrls: string[] = [];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      calledUrls.push(url.toString());
      if (url.toString().includes("/request-deletion")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ message: "削除処理が完了しました" });
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.handleDeleteLink({
        id: "PR-1",
        title: "x",
        status: "DRAFT",
        requestType: "ONE_TIME",
        totalAmount: 0,
        departmentSurrogateId: "D001",
        applicantId: "a",
        memo: null,
      });
    });

    expect(calledUrls.some((u) => u.includes("/api/purchase-requisitions/PR-1/request-deletion"))).toBe(true);
    expect(result.current.message).toBe("削除処理が完了しました");
  });

  it("追加要望F: 複数部署所属時、選択中の申請部署をsubmit-for-approvalのペイロードに含める", async () => {
    const fetchSpy = vi.fn();
    const departments = [
      { surrogateId: "dept-a", id: "D001", name: "資材部" },
      { surrogateId: "dept-b", id: "D002", name: "総務部" },
    ];
    mockInitialFetches(fetchSpy, {
      requisitions: [{ id: "PR-1", title: "申請1", status: "DRAFT", requestType: "ONE_TIME", totalAmount: 1000 }],
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      usePurchaseRequisitionOperations(defaultProps({ departments, isPurchaseRequisitionWfEnabled: true })),
    );
    await waitFor(() => expect(result.current.applicantDepartmentSurrogateId).toBe("dept-a"));
    await waitFor(() => expect(result.current.requisitions).toHaveLength(1));

    act(() => {
      result.current.handleSelectEdit(result.current.requisitions[0]);
      result.current.setApplicantDepartmentSurrogateId("dept-b");
    });

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/submit-for-approval")) {
        const body = JSON.parse(init?.body as string);
        expect(body.applicantDepartmentSurrogateId).toBe("dept-b");
        return jsonResponse({});
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.handleSubmitForApproval();
    });
  });

  it("回帰テスト: 部署未選択時の既定値はdepartments[0].surrogateId(idではない)を使う", async () => {
    const fetchSpy = vi.fn();
    const departments = [{ surrogateId: "dept-a", id: "D001", name: "資材部" }];
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps({ departments })));

    await waitFor(() => expect(result.current.departmentSurrogateId).toBe("dept-a"));
    expect(result.current.departmentSurrogateId).not.toBe("D001");
  });

  it("Phase3フォローアップ: 手入力(DIRECT)行はitemName未入力だとエラーになり、入力すればitemName/inputTypeがペイロードに含まれる", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));
    await waitFor(() => expect(result.current.requisitions).toEqual([]));

    act(() => {
      result.current.setTitle("マスタ外品購入");
      result.current.setDepartmentSurrogateId("D001");
      result.current.setPartnerId("PARTNER-1");
      result.current.setProjectId("PJ-1");
      result.current.addItemRow();
    });
    act(() => {
      result.current.onItemTypeChange(0, "DIRECT");
      result.current.updateItemRow(0, { itemId: "FREE-1" });
    });

    // itemName未入力のためエラーになりAPIは呼ばれない
    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    });
    expect(result.current.error).toContain("品目名");

    act(() => {
      result.current.updateItemRow(0, { itemName: "自由入力の品目" });
    });

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/purchase-requisitions/register")) {
        const formData = init?.body as FormData;
        const payload = JSON.parse(formData.get("requisitionData") as string);
        expect(payload.items[0].inputType).toBe("DIRECT");
        expect(payload.items[0].itemId).toBe("FREE-1");
        expect(payload.items[0].itemName).toBe("自由入力の品目");
        return jsonResponse({ id: "PR-DIRECT-1" });
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    });
    expect(result.current.editingId).toBe("PR-DIRECT-1");
  });

  it("Phase3フォローアップ: 7つのマスタ取得は完全に独立しており、1つが失敗しても他は正常に読み込まれる", async () => {
    const fetchSpy = vi.fn();
    fetchSpy.mockImplementation(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/products")) return jsonResponse([{ id: "ITEM-1", name: "テスト品目" }]);
      if (u.includes("/api/projects")) return jsonResponse([{ id: "PJ-1", name: "本社移転" }]);
      if (u.includes("/api/departments")) return jsonResponse([{ id: "D001", name: "資材部" }]);
      // ユーザーマスタだけ意図的に失敗させる(実際にユーザーから報告された症状の再現:
      // 新規追加のユーザー取得を既存の品目/勘定科目/部署と同じグループにまとめてしまい、
      // ユーザー取得の失敗が他の3つまで巻き添えにしていた不具合)
      if (u.includes("/api/users")) return jsonResponse({ error: "internal error" }, 500);
      if (u.includes("/api/partners")) return jsonResponse([{ id: "PARTNER-1", name: "仕入先A" }]);
      if (u.includes("/api/units")) return jsonResponse([{ code: "PCS", name: "個" }]);
      if (u.includes("/api/tax-categories")) return jsonResponse([{ code: "TAX_10", name: "10%", taxType: "STANDARD", taxRate: 0.1 }]);
      if (u.includes("/api/purchase-requisitions")) return jsonResponse([]);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));

    await waitFor(() => expect(result.current.allItems).toEqual([{ id: "ITEM-1", name: "テスト品目" }]));
    // ユーザーマスタ以外は、ユーザーマスタの失敗に巻き込まれず正常に読み込まれる
    expect(result.current.projects).toEqual([{ id: "PJ-1", name: "本社移転" }]);
    expect(result.current.orgDepartments).toEqual([{ id: "D001", name: "資材部" }]);
    expect(result.current.suppliers).toEqual([{ id: "PARTNER-1", name: "仕入先A" }]);
    expect(result.current.units).toEqual([{ code: "PCS", name: "個" }]);
    expect(result.current.taxCategories).toHaveLength(1);
    // 失敗したユーザーマスタだけ空のまま(クラッシュしない)
    expect(result.current.userMaster).toEqual([]);
  });

  it("Phase3フォローアップ: 品目をマスタ選択すると、仕入先向けの登録単価(/api/product-prices, priceType=PURCHASE)を自動反映する", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, {
      items: [{ id: "ITEM-1", name: "品目A", baseUnitCode: "PCS", taxCategoryCode: "TAX_10" }],
      suppliers: [{ id: "PARTNER-1", name: "仕入先A" }],
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));
    await waitFor(() => expect(result.current.allItems).toHaveLength(1));

    act(() => {
      result.current.setPartnerId("PARTNER-1");
      result.current.addItemRow();
    });

    fetchSpy.mockImplementation(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/product-prices")) {
        expect(u).toContain("partnerId=PARTNER-1");
        expect(u).toContain("itemId=ITEM-1");
        expect(u).toContain("priceType=PURCHASE");
        return jsonResponse([{ unitPrice: 850 }]);
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.onItemMasterSelect(0, "ITEM-1");
    });

    expect(result.current.items[0].itemId).toBe("ITEM-1");
    expect(result.current.items[0].unitCode).toBe("PCS");
    expect(result.current.items[0].taxCategoryCode).toBe("TAX_10");
    expect(result.current.items[0].estimatedUnitPrice).toBe(850);
  });

  it("Phase3フォローアップ: 数量帯によって単価が変わる場合、数量変更時に仕入単価を再取得する", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, {
      items: [{ id: "ITEM-1", name: "品目A", baseUnitCode: "PCS", taxCategoryCode: "TAX_10" }],
      suppliers: [{ id: "PARTNER-1", name: "仕入先A" }],
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));
    await waitFor(() => expect(result.current.allItems).toHaveLength(1));

    act(() => {
      result.current.setPartnerId("PARTNER-1");
      result.current.addItemRow();
    });
    fetchSpy.mockImplementation(async (url: string) =>
      url.toString().includes("/api/product-prices") ? jsonResponse([{ unitPrice: 850 }]) : jsonResponse([]),
    );
    await act(async () => {
      await result.current.onItemMasterSelect(0, "ITEM-1");
    });

    fetchSpy.mockImplementation(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/product-prices")) {
        expect(u).toContain("quantity=10");
        return jsonResponse([{ unitPrice: 700 }]);
      }
      return jsonResponse([]);
    });
    await act(async () => {
      await result.current.onItemQuantityChange(0, 10);
    });

    expect(result.current.items[0].quantity).toBe(10);
    expect(result.current.items[0].estimatedUnitPrice).toBe(700);
  });

  it("Phase3フォローアップ: 仕入先(マスタ)を切り替えると、選択済みのマスタ品目行の単価を新しい仕入先向けに再取得する", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, {
      items: [{ id: "ITEM-1", name: "品目A", baseUnitCode: "PCS", taxCategoryCode: "TAX_10" }],
      suppliers: [
        { id: "PARTNER-1", name: "仕入先A" },
        { id: "PARTNER-2", name: "仕入先B" },
      ],
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));
    await waitFor(() => expect(result.current.allItems).toHaveLength(1));

    act(() => {
      result.current.setPartnerId("PARTNER-1");
      result.current.addItemRow();
    });
    fetchSpy.mockImplementation(async (url: string) =>
      url.toString().includes("/api/product-prices") ? jsonResponse([{ unitPrice: 850 }]) : jsonResponse([]),
    );
    await act(async () => {
      await result.current.onItemMasterSelect(0, "ITEM-1");
    });

    fetchSpy.mockImplementation(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/product-prices")) {
        expect(u).toContain("partnerId=PARTNER-2");
        return jsonResponse([{ unitPrice: 900 }]);
      }
      return jsonResponse([]);
    });
    await act(async () => {
      await result.current.onSupplierMasterSelect("PARTNER-2");
    });

    expect(result.current.partnerId).toBe("PARTNER-2");
    expect(result.current.items[0].estimatedUnitPrice).toBe(900);
  });

  it("Phase4起票トリガー②: handlePrefillFromSalesOrderは受注紐付け(salesOrderItemId)を保持したままフォームへ反映しDBへは書き込まない", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));
    await waitFor(() => expect(result.current.requisitions).toEqual([]));

    const calledUrls: string[] = [];
    fetchSpy.mockImplementation(async (url: string) => {
      calledUrls.push(url.toString());
      return jsonResponse([]);
    });

    act(() => {
      result.current.handlePrefillFromSalesOrder({
        title: "SO-1の欠品調達",
        memo: "(受注 SO-1 の欠品調達)",
        items: [
          {
            itemId: "ITEM-1",
            itemName: "品目A",
            inputType: "MASTER",
            quantity: 5,
            estimatedUnitPrice: 800,
            unitCode: "PCS",
            taxCategoryCode: "TAX_10",
            memo: null,
            salesOrderItemId: "SOI-1",
          },
        ],
      });
    });

    expect(result.current.viewMode).toBe("FORM");
    expect(result.current.editingId).toBeNull();
    expect(result.current.title).toBe("SO-1の欠品調達");
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].salesOrderItemId).toBe("SOI-1");
    // プレフィルの時点ではAPIへの保存は一切呼ばれない(POST/PUTが無いこと)
    expect(calledUrls.every((u) => !u.includes("/register") && !u.includes("/api/purchase-requisitions/PR"))).toBe(
      true,
    );
  });

  it("Phase4起票トリガー③: handlePrefillFromPurchaseOrderは仕入先・勘定科目を引き継ぎ、再発注元をメモへ自動付記する", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));
    await waitFor(() => expect(result.current.requisitions).toEqual([]));

    act(() => {
      result.current.handlePrefillFromPurchaseOrder({
        title: "PO-1の再発注",
        memo: "(再発注元: 発注 PO-1)",
        partnerId: "PARTNER-1",
        partnerInputType: "MASTER",
        projectId: "PJ-1",
        items: [
          {
            itemId: "ITEM-1",
            itemName: "品目A",
            inputType: "MASTER",
            quantity: 10,
            estimatedUnitPrice: 700,
            unitCode: "PCS",
            taxCategoryCode: "TAX_10",
            memo: null,
          },
        ],
      });
    });

    expect(result.current.viewMode).toBe("FORM");
    expect(result.current.editingId).toBeNull();
    expect(result.current.partnerId).toBe("PARTNER-1");
    expect(result.current.partnerInputType).toBe("MASTER");
    expect(result.current.projectId).toBe("PJ-1");
    expect(result.current.memo).toBe("(再発注元: 発注 PO-1)");
    expect(result.current.items).toHaveLength(1);
  });

  it("コピーして下書き作成: 明細を詳細取得したうえで、id/statusを引き継がない新規レコードとしてプレフィルする", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, {
      requisitions: [
        {
          id: "PR-1",
          title: "既存申請",
          status: "APPROVED",
          requestType: "ONE_TIME",
          totalAmount: 1000,
          partnerId: "PARTNER-1",
          projectId: "PJ-1",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));
    await waitFor(() => expect(result.current.requisitions).toHaveLength(1));

    fetchSpy.mockImplementation(async (url: string) => {
      if (url.toString().includes("/api/purchase-requisitions/PR-1")) {
        return jsonResponse({
          items: [
            {
              itemId: "ITEM-1",
              itemName: "品目A",
              inputType: "MASTER",
              quantity: 3,
              estimatedUnitPrice: 500,
              unitCode: "PCS",
              taxCategoryCode: "TAX_10",
              memo: null,
              salesOrderItemId: "SOI-1",
            },
          ],
        });
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.handleCopyToNewDraft(result.current.requisitions[0]);
    });

    expect(result.current.viewMode).toBe("FORM");
    expect(result.current.editingId).toBeNull();
    expect(result.current.title).toBe("既存申請(コピー)");
    expect(result.current.partnerId).toBe("PARTNER-1");
    expect(result.current.projectId).toBe("PJ-1");
    expect(result.current.items).toHaveLength(1);
    // コピー元の受注紐付けトレーサビリティは引き継がない(独立した新規申請のため)
    expect(result.current.items[0].salesOrderItemId).toBeNull();
  });
});

describe("usePurchaseRequisitionOperations: BUG-061 CSV取込の上書きの確認", () => {
  const csvFile = () => new File(["id"], "requisitions.csv", { type: "text/csv" });
  const bulkCalls = (fetchSpy: ReturnType<typeof vi.fn>) =>
    fetchSpy.mock.calls.filter(([url]) => url.toString().includes("/api/purchase-requisitions/bulk-register"));

  it("取込の前に上書きの確認を出し、キャンセルなら取り込まない", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));

    await act(async () => {
      await result.current.handleImportCsv(csvFile());
    });

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("上書きされます"));
    expect(bulkCalls(fetchSpy)).toHaveLength(0);
    confirmSpy.mockRestore();
  });

  it("確認で続けると取り込む", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderHook(() => usePurchaseRequisitionOperations(defaultProps()));

    await act(async () => {
      await result.current.handleImportCsv(csvFile());
    });

    expect(bulkCalls(fetchSpy)).toHaveLength(1);
    confirmSpy.mockRestore();
  });
});
