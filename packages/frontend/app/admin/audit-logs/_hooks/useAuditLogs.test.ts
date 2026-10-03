import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAuditLogs } from "./useAuditLogs";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch() {
  const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async (url) => {
      if (url.toString().includes("/api/audit-logs/resources")) {
        return jsonResponse([{ key: "units", label: "単位マスタ" }]);
      }
      if (url.toString().includes("/api/company-settings")) {
        return jsonResponse({ is_pagination_enabled: false });
      }
      if (url.toString().includes("/api/audit-logs/search")) {
        return jsonResponse({
          data: [],
          pagination: { page: 1, limit: 50, total: 0, totalPages: 1 },
        });
      }
      return jsonResponse({});
    },
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  vi.stubGlobal("alert", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAuditLogs", () => {
  it("マウント時に画面マスタ選択肢を取得し先頭に「すべて」を追加する", async () => {
    mockFetch();
    const { result } = renderHook(() => useAuditLogs());

    await waitFor(() =>
      expect(result.current.resourceOptions).toEqual([
        { key: "", label: "すべてのアプリケーション画面" },
        { key: "units", label: "単位マスタ" },
      ]),
    );
  });

  it("マウント時には検索一覧を自動取得しない(autoFetch:false)", async () => {
    const fetchSpy = mockFetch();
    renderHook(() => useAuditLogs());

    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/audit-logs/search"),
      expect.anything(),
    );
  });

  it("handleSearchで検索条件をbodyにマージしPOSTする", async () => {
    const fetchSpy = mockFetch();
    const { result } = renderHook(() => useAuditLogs());
    await waitFor(() => expect(result.current.resourceOptions.length).toBeGreaterThan(0));

    act(() => {
      result.current.setUserId("EMP001");
      result.current.setAction("CREATE");
    });

    await act(async () => {
      result.current.handleSearch();
    });

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/audit-logs/search",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const call = fetchSpy.mock.calls.find((c) =>
      c[0].toString().includes("/api/audit-logs/search"),
    );
    const body = JSON.parse((call?.[1] as RequestInit).body as string);
    // paginationEnabled:falseのため、page/limitはbodyへ混入しない
    expect(body).toEqual({
      startDate: "",
      endDate: "",
      userId: "EMP001",
      resourceKey: "",
      action: "CREATE",
    });
  });

  it("handleClearFieldsで検索条件と結果をリセットする", async () => {
    mockFetch();
    const { result } = renderHook(() => useAuditLogs());
    await waitFor(() => expect(result.current.resourceOptions.length).toBeGreaterThan(0));

    act(() => {
      result.current.setUserId("EMP001");
    });
    act(() => {
      result.current.handleClearFields();
    });

    expect(result.current.userId).toBe("");
    expect(result.current.total).toBe(0);
  });

  it("該当件数0件でCSVダウンロードを実行してもダウンロードしない(alert は出さない。BUG-037)", async () => {
    const fetchSpy = mockFetch();
    const { result } = renderHook(() => useAuditLogs());
    await waitFor(() => expect(result.current.resourceOptions.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.handleDownloadCsvFile();
    });

    expect(window.alert).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/audit-logs/csv-download"),
      expect.anything(),
    );
  });

  it("該当件数がある場合はCSVダウンロードエンドポイントを検索条件付きで呼ぶ", async () => {
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (url) => {
        if (url.toString().includes("/api/audit-logs/resources")) return jsonResponse([]);
        if (url.toString().includes("/api/company-settings"))
          return jsonResponse({ is_pagination_enabled: false });
        if (url.toString().includes("/api/audit-logs/search"))
          return jsonResponse([{ id: "1" }]);
        if (url.toString().includes("/api/audit-logs/csv-download"))
          return new Response(new Blob(["id"]), { status: 200 });
        return jsonResponse({});
      },
    );
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "a"
        ? ({ click: vi.fn(), href: "", download: "" } as unknown as HTMLAnchorElement)
        : originalCreateElement(tag),
    );

    const { result } = renderHook(() => useAuditLogs());
    act(() => {
      result.current.setUserId("EMP001");
    });
    await act(async () => {
      result.current.handleSearch();
    });
    await waitFor(() => expect(result.current.total).toBeGreaterThan(0));

    await act(async () => {
      await result.current.handleDownloadCsvFile();
    });

    const call = fetchSpy.mock.calls.find((c) =>
      c[0].toString().includes("/api/audit-logs/csv-download"),
    );
    expect(call).toBeDefined();
    expect(call?.[0].toString()).toContain("userId=EMP001");
  });
});
