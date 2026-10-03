import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePriceOperations } from "./usePriceOperations";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function defaultProps() {
  return { canCreate: true, canUpdate: true, canDelete: true };
}

function mockLookups(fetchSpy: ReturnType<typeof vi.fn>, opts: { prices?: unknown[] } = {}) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/company-settings")) return jsonResponse({ is_pagination_enabled: false });
    if (u.includes("/api/products")) {
      return jsonResponse([{ id: "ITEM-1", name: "品目A", baseUnitCode: "KG" }]);
    }
    if (u.includes("/api/partners")) {
      return jsonResponse([{ id: "CUST-1", name: "得意先A" }]);
    }
    if (u.includes("/api/units")) return jsonResponse([{ code: "PCS", name: "個" }]);
    if (u.includes("/api/product-prices")) return jsonResponse(opts.prices ?? []);
    return jsonResponse({});
  });
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePriceOperations", () => {
  it("初期ロードでitems/partners/unitsを取得し、formDataのitemId/unitCodeを先頭品目に合わせる", async () => {
    const fetchSpy = vi.fn();
    mockLookups(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => usePriceOperations(defaultProps()));

    await waitFor(() => expect(result.current.items).toEqual([
      { id: "ITEM-1", name: "品目A", baseUnitCode: "KG" },
    ]));
    expect(result.current.formData.itemId).toBe("ITEM-1");
    expect(result.current.formData.unitCode).toBe("KG");
  });

  it("itemId変更時は選択品目のbaseUnitCodeへunitCodeを自動追従する", async () => {
    const fetchSpy = vi.fn();
    mockLookups(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => usePriceOperations(defaultProps()));
    await waitFor(() => expect(result.current.items.length).toBe(1));

    act(() => {
      result.current.handleInputChange("itemId", "ITEM-1");
    });

    expect(result.current.formData.unitCode).toBe("KG");
  });

  it("承認ワークフロー無効の新規登録: /api/product-prices/registerへPOSTする", async () => {
    const fetchSpy = vi.fn();
    mockLookups(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => usePriceOperations(defaultProps()));
    await waitFor(() => expect(result.current.items.length).toBe(1));

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/product-prices/register")) {
        const body = JSON.parse(init?.body as string);
        expect(body.itemId).toBe("ITEM-1");
        return jsonResponse({ id: "PRICE-1" });
      }
      return jsonResponse([]);
    });

    act(() => {
      result.current.handleInputChange("unitPrice", 1000);
      result.current.handleInputChange("minQuantity", 10);
    });

    let submitResult: boolean | undefined;
    await act(async () => {
      submitResult = await result.current.handleSubmit({
        preventDefault: () => {},
      } as React.SyntheticEvent);
    });

    expect(submitResult).toBe(true);
    expect(result.current.message).toBe("新しい契約個別単価を設定しました");
  });

  it("対象品目が未選択の場合はhandleSubmitがfalseを返しfetchしない", async () => {
    const fetchSpy = vi.fn();
    mockLookups(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => usePriceOperations(defaultProps()));
    await waitFor(() => expect(result.current.items.length).toBe(1));

    act(() => {
      result.current.handleInputChange("itemId", "");
    });

    fetchSpy.mockClear();
    let submitResult: boolean | undefined;
    await act(async () => {
      submitResult = await result.current.handleSubmit({
        preventDefault: () => {},
      } as React.SyntheticEvent);
    });

    expect(submitResult).toBe(false);
    expect(result.current.error).toBe("対象品目を選択してください");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("承認ワークフロー有効の新規登録: 仮登録(temporary)後にapprovals/request-updateを申請する", async () => {
    const fetchSpy = vi.fn();
    mockLookups(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      usePriceOperations({ ...defaultProps(), isProductPriceWfEnabled: true }),
    );
    await waitFor(() => expect(result.current.items.length).toBe(1));

    const calledUrls: string[] = [];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      calledUrls.push(url.toString());
      if (url.toString().includes("/api/product-prices/register")) {
        const body = JSON.parse(init?.body as string);
        expect(body.status).toBe("temporary");
        return jsonResponse({ id: "PRICE-1" });
      }
      if (url.toString().includes("/api/approvals/request-update")) {
        const body = JSON.parse(init?.body as string);
        expect(body.targetType).toBe("master_prices");
        expect(body.targetId).toBe("PRICE-1");
        expect(body.payload.status).toBe("active");
      }
      return jsonResponse({});
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(calledUrls.some((u) => u.includes("/api/product-prices/register"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/api/approvals/request-update"))).toBe(true);
    expect(result.current.message).toBe(
      "単価設定を仮登録し、承認を申請しました(承認待ち)",
    );
  });

  it("追加要望F: 複数部署所属時、選択中の申請部署をrequest-updateのペイロードに含める", async () => {
    const fetchSpy = vi.fn();
    mockLookups(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const departments = [
      { surrogateId: "dept-a", id: "D001", name: "営業統括部" },
      { surrogateId: "dept-b", id: "D002", name: "人事総務部" },
    ];
    const { result } = renderHook(() =>
      usePriceOperations({
        ...defaultProps(),
        isProductPriceWfEnabled: true,
        departments,
      }),
    );
    await waitFor(() => expect(result.current.items.length).toBe(1));
    expect(result.current.applicantDepartmentSurrogateId).toBe("dept-a");
    act(() => result.current.setApplicantDepartmentSurrogateId("dept-b"));

    const calledUrls: { url: string; body: any }[] = [];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : null;
      calledUrls.push({ url: url.toString(), body });
      if (url.toString().includes("/api/product-prices/register")) {
        return jsonResponse({ id: "PRICE-1" });
      }
      return jsonResponse({});
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    const request = calledUrls.find((c) => c.url.includes("/api/approvals/request-update"));
    expect(request!.body.applicantDepartmentSurrogateId).toBe("dept-b");
  });

  it("handleDeletePriceは確認キャンセル時はDELETEを呼ばない", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const fetchSpy = vi.fn();
    mockLookups(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => usePriceOperations(defaultProps()));
    await waitFor(() => expect(result.current.items.length).toBe(1));

    await act(async () => {
      await result.current.handleDeletePrice("PRICE-1");
    });

    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/product-prices/PRICE-1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("handleSuspendPrice(承認無効)は/registerへstatus:suspendedを送信する", async () => {
    const fetchSpy = vi.fn();
    mockLookups(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => usePriceOperations(defaultProps()));
    await waitFor(() => expect(result.current.items.length).toBe(1));

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/product-prices/register")) {
        const body = JSON.parse(init?.body as string);
        expect(body.status).toBe("suspended");
        return jsonResponse({});
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.handleSuspendPrice({
        id: "PRICE-1",
        itemId: "ITEM-1",
        priceType: "SALES",
        partnerId: null,
        minQuantity: 1,
        unitPrice: 100,
        unitCode: "KG",
        status: "active",
      });
    });

    expect(result.current.message).toBe("単価設定を無効化しました");
  });

  it("handleClearFiltersはすべての検索条件を空にする", async () => {
    const fetchSpy = vi.fn();
    mockLookups(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => usePriceOperations(defaultProps()));
    await waitFor(() => expect(result.current.items.length).toBe(1));

    act(() => {
      result.current.setSearchItemId("X");
      result.current.setSearchPriceType("SALES");
      result.current.setSearchPartnerId("CUST-1");
      result.current.setSearchStatus("active");
    });

    act(() => {
      result.current.handleClearFilters();
    });

    expect(result.current.searchItemId).toBe("");
    expect(result.current.searchPriceType).toBe("");
    expect(result.current.searchPartnerId).toBe("");
    expect(result.current.searchStatus).toBe("");
  });
});
