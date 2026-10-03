import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePaginatedList } from "./use-paginated-list";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePaginatedList", () => {
  it("条件(URL)が続けて変わっても、入力が止まってから最後の条件で1回だけ検索する(BUG-031)", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchSpy);

    const { rerender } = renderHook(({ url }) => usePaginatedList(url, { paginationEnabled: false }), {
      initialProps: { url: "/api/partners?name=" },
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    rerender({ url: "/api/partners?name=a" });
    rerender({ url: "/api/partners?name=ab" });
    rerender({ url: "/api/partners?name=abc" });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(fetchSpy).toHaveBeenLastCalledWith("/api/partners?name=abc", expect.anything());
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/partners?name=a", expect.anything());
  });

  it("paginationEnabled:falseの間はpage/limitクエリを付与せず、配列レスポンスをそのまま件数として扱う", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([{ code: "PCS" }, { code: "KG" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      usePaginatedList("/api/units", { paginationEnabled: false }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchSpy).toHaveBeenCalledWith("/api/units", expect.anything());
    expect(result.current.items).toEqual([{ code: "PCS" }, { code: "KG" }]);
    expect(result.current.total).toBe(2);
    expect(result.current.totalPages).toBe(1);
  });

  it("paginationEnabled:trueの場合はpage/limitをクエリ付与し、{data,pagination}エンベロープを展開する", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        data: [{ code: "PCS" }],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      usePaginatedList("/api/units", { paginationEnabled: true }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchSpy).toHaveBeenCalledWith("/api/units?page=1&limit=50", expect.anything());
    expect(result.current.items).toEqual([{ code: "PCS" }]);
    expect(result.current.total).toBe(1);
  });

  it("baseUrlに既存クエリがある場合は&で連結する", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } }));
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() =>
      usePaginatedList("/api/units?status=active", { paginationEnabled: true }),
    );

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/units?status=active&page=1&limit=50",
        expect.anything(),
      ),
    );
  });

  it("enabled:falseの間はfetchしない(権限確認中の既存パターン)", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() => usePaginatedList("/api/units", { paginationEnabled: false, enabled: false }));

    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("autoFetch:falseの場合はマウント時に自動フェッチせず、changePageで即座に再取得する", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ data: [{ code: "A" }], pagination: { page: 2, limit: 50, total: 51, totalPages: 2 } }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      usePaginatedList("/api/audit-logs", { paginationEnabled: true, autoFetch: false }),
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalled();

    await act(async () => {
      result.current.setPage(2);
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/audit-logs?page=2&limit=50", expect.anything());
    await waitFor(() => expect(result.current.page).toBe(2));
  });

  it("method:POSTの場合はbodyへpage/limitをマージしてJSON送信する", async () => {
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        jsonResponse({ data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() =>
      usePaginatedList<{ code: string }, { keyword: string }>("/api/audit-logs/search", {
        paginationEnabled: true,
        body: { keyword: "PCS" },
        method: "POST",
      }),
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      keyword: "PCS",
      page: 1,
      limit: 50,
    });
  });

  it("resetは一覧・件数・エラーをクリアする", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ code: "PCS" }])));

    const { result } = renderHook(() =>
      usePaginatedList("/api/units", { paginationEnabled: false }),
    );

    await waitFor(() => expect(result.current.items.length).toBe(1));

    act(() => {
      result.current.reset();
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it("setSort呼び出し後はsortBy/sortOrderをクエリに付与する(GET)", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([{ code: "PCS" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      usePaginatedList("/api/units", { paginationEnabled: false }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setSort("name");
    });

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenLastCalledWith(
        "/api/units?sortBy=name&sortOrder=asc",
        expect.anything(),
      ),
    );
    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortDirection).toBe("asc");
  });

  it("同じキーで再度setSortを呼ぶとsortOrderがdescにトグルされる", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([{ code: "PCS" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      usePaginatedList("/api/units", { paginationEnabled: false }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setSort("name");
    });
    await waitFor(() => expect(result.current.sortDirection).toBe("asc"));

    await act(async () => {
      result.current.setSort("name");
    });

    await waitFor(() => expect(result.current.sortDirection).toBe("desc"));
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/units?sortBy=name&sortOrder=desc",
      expect.anything(),
    );
  });

  it("method:POSTの場合はbodyへsortBy/sortOrderをマージする", async () => {
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => jsonResponse({ data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      usePaginatedList<{ code: string }, { keyword: string }>("/api/audit-logs/search", {
        paginationEnabled: true,
        body: { keyword: "PCS" },
        method: "POST",
      }),
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    await act(async () => {
      result.current.setSort("name");
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const [, init] = fetchSpy.mock.calls[1];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      keyword: "PCS",
      page: 1,
      limit: 50,
      sortBy: "name",
      sortOrder: "asc",
    });
  });

  it("追加要望J-1-a: additive(Shift+クリック)でsetSortを呼ぶと既存のキーを維持したまま2番目のキーを追加する", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([{ code: "PCS" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      usePaginatedList("/api/units", { paginationEnabled: false }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setSort("name");
    });
    await waitFor(() => expect(result.current.sortKeys).toEqual([{ key: "name", direction: "asc" }]));

    await act(async () => {
      result.current.setSort("code", true);
    });

    await waitFor(() =>
      expect(result.current.sortKeys).toEqual([
        { key: "name", direction: "asc" },
        { key: "code", direction: "asc" },
      ]),
    );
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/units?sortBy=name%2Ccode&sortOrder=asc,asc",
      expect.anything(),
    );
    // 後方互換: 先頭キー(プライマリ)がsortBy/sortDirectionに反映される
    expect(result.current.sortBy).toBe("name");
  });

  it("追加要望J-1-a: 既に追加済みのキーをadditiveで再指定すると、そのキーの方向だけトグルし位置は変えない", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([{ code: "PCS" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      usePaginatedList("/api/units", { paginationEnabled: false }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setSort("name");
    });
    await act(async () => {
      result.current.setSort("code", true);
    });
    await waitFor(() =>
      expect(result.current.sortKeys).toEqual([
        { key: "name", direction: "asc" },
        { key: "code", direction: "asc" },
      ]),
    );

    await act(async () => {
      result.current.setSort("name", true);
    });

    await waitFor(() =>
      expect(result.current.sortKeys).toEqual([
        { key: "name", direction: "desc" },
        { key: "code", direction: "asc" },
      ]),
    );
  });

  it("追加要望J-1-a: 複数キー指定中に通常クリック(additiveなし)すると単一キーに置き換わる", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([{ code: "PCS" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      usePaginatedList("/api/units", { paginationEnabled: false }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setSort("name");
    });
    await act(async () => {
      result.current.setSort("code", true);
    });
    await waitFor(() => expect(result.current.sortKeys).toHaveLength(2));

    await act(async () => {
      result.current.setSort("code");
    });

    await waitFor(() => expect(result.current.sortKeys).toEqual([{ key: "code", direction: "asc" }]));
  });

  it("取得失敗時はerrorにメッセージを設定しloadingをfalseへ戻す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "一覧の取得に失敗しました" }, 500)),
    );

    const { result } = renderHook(() =>
      usePaginatedList("/api/units", { paginationEnabled: false }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("一覧の取得に失敗しました");
  });
});
