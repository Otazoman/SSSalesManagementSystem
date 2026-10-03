import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useProductForm } from "./useProductForm";
import { ItemRecord } from "../_types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    editingId: null,
    initialData: null,
    defaultUnitCode: "PCS",
    canCreate: true,
    canUpdate: true,
    onSuccess: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useProductForm", () => {
  it("初期状態(initialDataなし)はresetForm()によりtemporaryステータスへ揃う", () => {
    const { result } = renderHook(() => useProductForm(baseProps() as never));
    expect(result.current.formState.baseUnitCode).toBe("PCS");
    expect(result.current.formState.itemStatus).toBe("temporary");
    expect(result.current.formState.taxCategoryCode).toBe("TAX_10");
  });

  it("initialData指定時はフォーム状態をそのレコードで埋める", () => {
    const initialData: ItemRecord = {
      id: "ITEM-1",
      name: "品目A",
      isPurchased: true,
      isSales: false,
      isService: false,
      baseUnitCode: "KG",
      taxCategoryCode: "TAX_8",
      productBarcode: "1234567890",
      accountCode: "ACC-1",
      memo: "メモ",
      status: "active",
      supplierId: "SUP-1",
      supplierPartNumber: "P-001",
      attachments: [],
    };
    const { result } = renderHook(() =>
      useProductForm(baseProps({ editingId: "ITEM-1", initialData }) as never),
    );
    expect(result.current.formState.itemId).toBe("ITEM-1");
    expect(result.current.formState.itemName).toBe("品目A");
    expect(result.current.formState.baseUnitCode).toBe("KG");
    expect(result.current.formState.itemStatus).toBe("active");
  });

  it("canCreate:falseの新規登録submitはonErrorを呼びfetchしない", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useProductForm(baseProps({ canCreate: false, onError }) as never),
    );

    await act(async () => {
      await result.current.handleFormSubmit({
        preventDefault: () => {},
      } as React.SyntheticEvent);
    });

    expect(onError).toHaveBeenCalledWith("この操作をする権限がありません");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("承認ワークフロー無効の新規登録: /api/products/registerへPOSTしonSuccessを呼ぶ", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchSpy);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useProductForm(baseProps({ onSuccess }) as never));

    act(() => {
      result.current.formState.setItemId("ITEM-1");
      result.current.formState.setItemName("品目A");
    });

    await act(async () => {
      await result.current.handleFormSubmit({
        preventDefault: () => {},
      } as React.SyntheticEvent);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/products/register",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onSuccess).toHaveBeenCalledWith("品目マスタを新規登録しました");
  });

  it("承認ワークフロー有効の新規登録: 仮登録POST後にapprovals/request-updateを申請する", async () => {
    const calledUrls: string[] = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      calledUrls.push(url.toString());
      if (url.toString().includes("/api/products/register")) {
        const body = JSON.parse(init?.body as string);
        expect(body.status).toBe("temporary");
      }
      if (url.toString().includes("/api/approvals/request-update")) {
        const body = JSON.parse(init?.body as string);
        expect(body.targetType).toBe("master_products");
        expect(body.payload.status).toBe("active");
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useProductForm(baseProps({ isProductWfEnabled: true, onSuccess }) as never),
    );

    act(() => {
      result.current.formState.setItemId("ITEM-1");
      result.current.formState.setItemName("品目A");
    });

    await act(async () => {
      await result.current.handleFormSubmit({
        preventDefault: () => {},
      } as React.SyntheticEvent);
    });

    expect(calledUrls.some((u) => u.includes("/api/products/register"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/api/approvals/request-update"))).toBe(true);
    expect(onSuccess).toHaveBeenCalledWith("品目を仮登録し、承認を申請しました(承認待ち)");
  });

  it("回帰: コード自動採番(itemId空欄)時、仮登録レスポンスのidをrequest-updateのtargetIdに使う", async () => {
    const calledUrls: { url: string; body: any }[] = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      calledUrls.push({
        url: url.toString(),
        body: init?.body ? JSON.parse(init.body as string) : null,
      });
      if (url.toString().includes("/api/products/register")) {
        return jsonResponse({ id: "ITEM-AUTO-1" });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      useProductForm(baseProps({ isProductWfEnabled: true }) as never),
    );

    // itemIdは未入力のまま(自動採番依頼)
    act(() => {
      result.current.formState.setItemName("品目A");
    });

    await act(async () => {
      await result.current.handleFormSubmit({
        preventDefault: () => {},
      } as React.SyntheticEvent);
    });

    const request = calledUrls.find((c) => c.url.includes("/api/approvals/request-update"));
    expect(request!.body.targetId).toBe("ITEM-AUTO-1");
  });

  it("追加要望F: 複数部署所属時、選択中の申請部署をrequest-updateのペイロードに含める", async () => {
    const departments = [
      { surrogateId: "dept-a", id: "D001", name: "営業統括部" },
      { surrogateId: "dept-b", id: "D002", name: "人事総務部" },
    ];
    const calledUrls: { url: string; body: any }[] = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      calledUrls.push({
        url: url.toString(),
        body: init?.body ? JSON.parse(init.body as string) : null,
      });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      useProductForm(baseProps({ isProductWfEnabled: true, departments }) as never),
    );
    expect(result.current.applicantDepartmentSurrogateId).toBe("dept-a");
    act(() => result.current.setApplicantDepartmentSurrogateId("dept-b"));

    act(() => {
      result.current.formState.setItemId("ITEM-1");
      result.current.formState.setItemName("品目A");
    });

    await act(async () => {
      await result.current.handleFormSubmit({
        preventDefault: () => {},
      } as React.SyntheticEvent);
    });

    const request = calledUrls.find((c) => c.url.includes("/api/approvals/request-update"));
    expect(request!.body.applicantDepartmentSurrogateId).toBe("dept-b");
  });

  it("編集時(承認ワークフロー無効)はPUTし成功メッセージを設定する", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/products/ITEM-1");
      expect(init?.method).toBe("PUT");
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useProductForm(baseProps({ editingId: "ITEM-1", onSuccess }) as never),
    );

    await act(async () => {
      await result.current.handleFormSubmit({
        preventDefault: () => {},
      } as React.SyntheticEvent);
    });

    expect(onSuccess).toHaveBeenCalledWith("品目情報を更新しました");
  });

  it("編集中かつ承認ワークフロー有効な場合、request-statusを取得してisProductCurrentlyLockedを判定する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "PENDING" })));
    const initialData: ItemRecord = {
      id: "ITEM-1",
      name: "品目A",
      isPurchased: false,
      isSales: false,
      isService: false,
      baseUnitCode: "PCS",
      taxCategoryCode: "TAX_10",
      productBarcode: null,
      accountCode: null,
      memo: null,
      status: "temporary",
      supplierId: null,
      supplierPartNumber: null,
      attachments: [],
    };
    const { result } = renderHook(() =>
      useProductForm(
        baseProps({ editingId: "ITEM-1", initialData, isProductWfEnabled: true }) as never,
      ),
    );

    await waitFor(() => expect(result.current.isProductCurrentlyLocked).toBe(true));
  });

  it("送信失敗時はonErrorへメッセージを渡す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "登録に失敗しました" }, 400)),
    );
    const onError = vi.fn();
    const { result } = renderHook(() => useProductForm(baseProps({ onError }) as never));

    await act(async () => {
      await result.current.handleFormSubmit({
        preventDefault: () => {},
      } as React.SyntheticEvent);
    });

    expect(onError).toHaveBeenCalledWith("登録に失敗しました");
  });
});
