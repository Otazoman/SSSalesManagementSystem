import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAccounts } from "./useAccounts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function defaultProps() {
  return { canRead: true, canCreate: true, canUpdate: true, canDelete: true, loading: false };
}

function mockInitialFetches(fetchSpy: ReturnType<typeof vi.fn>, accounts: unknown[] = []) {
  fetchSpy.mockImplementation(async (url: string) => {
    if (url.toString().includes("/api/company-settings")) {
      return jsonResponse({ is_pagination_enabled: false });
    }
    if (url.toString().includes("/api/accounts")) {
      return jsonResponse(accounts);
    }
    return jsonResponse({});
  });
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAccounts", () => {
  it("初期表示: 会社設定・一覧を取得し、検索ステータス初期値はactive", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, [{ code: "1111", name: "現金", status: "active" }]);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useAccounts(defaultProps()));

    await waitFor(() => expect(result.current.accounts.length).toBe(1));
    expect(result.current.searchStatus).toBe("active");
  });

  it("承認ワークフロー有効時はsearchStatusの初期値がtemporaryになる", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useAccounts({ ...defaultProps(), isAccountWfEnabled: true }),
    );

    await waitFor(() => expect(result.current.searchStatus).toBe("temporary"));
  });

  it("handleClearSearchは検索条件をリセットする", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAccounts(defaultProps()));
    await waitFor(() => expect(result.current.accounts).toEqual([]));

    act(() => {
      result.current.setSearchCode("1111");
      result.current.setSearchName("現金");
      result.current.setSearchStatus("suspended");
    });
    act(() => {
      result.current.handleClearSearch();
    });

    expect(result.current.searchCode).toBe("");
    expect(result.current.searchName).toBe("");
    expect(result.current.searchStatus).toBe("active");
  });

  it("承認ワークフロー無効の新規登録: /api/accounts/registerへPOSTする", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAccounts(defaultProps()));
    await waitFor(() => expect(result.current.accounts).toEqual([]));

    const calledUrls: string[] = [];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      calledUrls.push(url.toString());
      if (url.toString().includes("/api/accounts/register")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({});
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.handleSubmit({
        code: "1111",
        name: "現金",
        externalMappingCode: "",
        status: "active",
        memo: "",
      });
    });

    expect(calledUrls.some((u) => u.includes("/api/accounts/register"))).toBe(true);
    expect(result.current.message).toBe("新しい勘定科目を新規登録しました");
  });

  it("登録権限が無い場合はfetchせずエラーメッセージを設定する", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAccounts({ ...defaultProps(), canCreate: false }));
    await waitFor(() => expect(result.current.accounts).toEqual([]));

    fetchSpy.mockClear();
    await act(async () => {
      await result.current.handleSubmit({
        code: "1111",
        name: "現金",
        externalMappingCode: "",
        status: "active",
        memo: "",
      });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.error).toBe("登録する権限がありません");
  });

  it("承認ワークフロー有効の変更: PUTで仮登録後、request-updateへUPDATEを申請する", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, [
      { code: "1111", name: "現金", externalMappingCode: null, status: "active", memo: null },
    ]);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      useAccounts({ ...defaultProps(), isAccountWfEnabled: true }),
    );
    await waitFor(() => expect(result.current.accounts.length).toBe(1));

    act(() => {
      result.current.setEditingAccount(result.current.accounts[0]);
    });

    const calledUrls: { url: string; body: unknown }[] = [];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      calledUrls.push({ url: url.toString(), body: init?.body ? JSON.parse(init.body as string) : null });
      return jsonResponse({});
    });

    await act(async () => {
      await result.current.handleSubmit({
        code: "1111",
        name: "現金その他",
        externalMappingCode: "",
        status: "active",
        memo: "",
      });
    });

    const preSave = calledUrls.find((c) => c.url.includes("/api/accounts/1111"));
    expect(preSave).toBeDefined();
    expect((preSave!.body as { status: string }).status).toBe("temporary");
    const request = calledUrls.find((c) => c.url.includes("/api/approvals/request-update"));
    expect(request).toBeDefined();
    expect((request!.body as { requestType: string }).requestType).toBe("UPDATE");
    expect(result.current.message).toBe(
      "勘定科目の変更承認をワークフローへ申請しました(承認待ちロック)",
    );
  });

  it("追加要望F: 複数部署所属時、選択中の申請部署をrequest-updateのペイロードに含める", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const departments = [
      { surrogateId: "dept-a", id: "D001", name: "営業統括部" },
      { surrogateId: "dept-b", id: "D002", name: "人事総務部" },
    ];
    const { result } = renderHook(() =>
      useAccounts({ ...defaultProps(), isAccountWfEnabled: true, departments }),
    );
    await waitFor(() => expect(result.current.accounts).toEqual([]));
    expect(result.current.applicantDepartmentSurrogateId).toBe("dept-a");
    act(() => result.current.setApplicantDepartmentSurrogateId("dept-b"));

    const calledUrls: { url: string; body: any }[] = [];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      calledUrls.push({
        url: url.toString(),
        body: init?.body ? JSON.parse(init.body as string) : null,
      });
      return jsonResponse({});
    });

    await act(async () => {
      await result.current.handleSubmit({
        code: "1111",
        name: "現金",
        externalMappingCode: "",
        status: "active",
        memo: "",
      });
    });

    const request = calledUrls.find((c) => c.url.includes("/api/approvals/request-update"));
    expect(request!.body.applicantDepartmentSurrogateId).toBe("dept-b");
  });

  it("削除確認でキャンセルした場合はDELETEを呼ばない", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, [
      { code: "1111", name: "現金", externalMappingCode: null, status: "active", memo: null },
    ]);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAccounts(defaultProps()));
    await waitFor(() => expect(result.current.accounts.length).toBe(1));

    fetchSpy.mockClear();
    await act(async () => {
      await result.current.handleDelete(result.current.accounts[0]);
    });

    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/accounts/1111"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("無効化(承認ワークフロー無効)は/suspendエンドポイントを呼ぶ", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, [
      { code: "1111", name: "現金", externalMappingCode: null, status: "active", memo: null },
    ]);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAccounts(defaultProps()));
    await waitFor(() => expect(result.current.accounts.length).toBe(1));

    const calledUrls: string[] = [];
    fetchSpy.mockImplementation(async (url: string) => {
      calledUrls.push(url.toString());
      return jsonResponse({});
    });

    await act(async () => {
      await result.current.handleSuspend(result.current.accounts[0]);
    });

    expect(calledUrls.some((u) => u.includes("/api/accounts/1111/suspend"))).toBe(true);
    expect(result.current.message).toBe("勘定科目を無効化しました");
  });

  it("CSVダウンロードは検索条件をクエリに含めてリクエストする", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAccounts(defaultProps()));
    await waitFor(() => expect(result.current.accounts).toEqual([]));

    act(() => {
      result.current.setSearchCode("1111");
    });

    const blob = new Blob(["code,name"], { type: "text/csv" });
    fetchSpy.mockImplementation(async () => new Response(blob, { status: 200 }));
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) =>
        tag === "a" ? ({ click: vi.fn(), href: "", download: "" } as unknown as HTMLAnchorElement) : originalCreateElement(tag),
      );

    await act(async () => {
      await result.current.handleDownloadCsv();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/accounts/csv-download?code=1111"),
      expect.anything(),
    );
    createElementSpy.mockRestore();
  });
});
