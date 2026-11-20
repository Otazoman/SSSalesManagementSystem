import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useWorkflowHistory } from "./useWorkflowHistory";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.toString().includes("/api/company-settings")) {
      return jsonResponse({ is_pagination_enabled: false });
    }
    return handler(url.toString(), init);
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useWorkflowHistory", () => {
  it("loadingPermissions中・canRead:false・userId未定の間はfetchしない", async () => {
    const fetchSpy = mockFetch(() => jsonResponse({ histories: [] }));

    renderHook(() =>
      useWorkflowHistory({ userId: undefined, canRead: true, loadingPermissions: false }),
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/workflow-tasks/history"),
      expect.anything(),
    );
  });

  it("初期状態はstatus=ACTIVE_TASKSで検索し、page/limitは常に送る(会社設定のページングが無効でも50件ずつ。PERF-02)", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ histories: [] });
    });

    renderHook(() =>
      useWorkflowHistory({ userId: "user-1", canRead: true, loadingPermissions: false }),
    );

    await waitFor(() => expect(capturedUrl).toContain("/api/workflow-tasks/history"));
    expect(capturedUrl).toContain("status=ACTIVE_TASKS");
    expect(capturedUrl).toContain("page=1");
    expect(capturedUrl).toContain("limit=50");
    expect(capturedUrl).not.toContain("limit=500");
  });

  it("{data,pagination,counts}形式(ページング済み)のレスポンスをそのまま反映する", async () => {
    mockFetch(() =>
      jsonResponse({
        data: [{ logId: "L1" }],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        isAdmin: true,
        counts: { approved: 1, remanded: 0, pending: 0, canceled: 0 },
      }),
    );

    const { result } = renderHook(() =>
      useWorkflowHistory({ userId: "user-1", canRead: true, loadingPermissions: false }),
    );

    await waitFor(() => expect(result.current.loadingData).toBe(false));
    expect(result.current.histories).toEqual([{ logId: "L1" }]);
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.total).toBe(1);
    expect(result.current.counts.approved).toBe(1);
  });

  it("画面を開いた時の履歴 API の呼び出しは1回(会社設定の読み込みを待って呼び直さない。PERF-02・PERF-06)", async () => {
    const calledUrls: string[] = [];
    const fetchSpy = mockFetch((url) => {
      calledUrls.push(url);
      return jsonResponse({
        data: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
        counts: { approved: 0, remanded: 0, pending: 0, canceled: 0 },
      });
    });

    const { result } = renderHook(() =>
      useWorkflowHistory({ userId: "user-1", canRead: true, loadingPermissions: false }),
    );
    await waitFor(() => expect(result.current.loadingData).toBe(false));
    await new Promise((r) => setTimeout(r, 20));

    expect(calledUrls.filter((u) => u.includes("/api/workflow-tasks/history"))).toHaveLength(1);
    expect(
      fetchSpy.mock.calls.filter(([u]) => String(u).includes("/api/company-settings")),
    ).toHaveLength(0);
  });

  it("handleClearFiltersはfiltersを初期値(ACTIVE_TASKS)へ戻す", async () => {
    mockFetch(() => jsonResponse({ histories: [] }));
    const { result } = renderHook(() =>
      useWorkflowHistory({ userId: "user-1", canRead: true, loadingPermissions: false }),
    );
    await waitFor(() => expect(result.current.loadingData).toBe(false));

    act(() => {
      result.current.setFilters((prev) => ({ ...prev, status: "APPROVED" }));
    });
    expect(result.current.filters.status).toBe("APPROVED");

    act(() => {
      result.current.handleClearFilters();
    });
    expect(result.current.filters.status).toBe("ACTIVE_TASKS");
  });

  it("handleCancelRequestは/api/workflow-tasks/cancelへPOSTし、成功後に再取得する", async () => {
    const calledUrls: string[] = [];
    mockFetch((url) => {
      calledUrls.push(url);
      return jsonResponse({ histories: [] });
    });

    const { result } = renderHook(() =>
      useWorkflowHistory({ userId: "user-1", canRead: true, loadingPermissions: false }),
    );
    await waitFor(() => expect(result.current.loadingData).toBe(false));

    await act(async () => {
      await result.current.handleCancelRequest("target-1", "log-1");
    });

    expect(calledUrls.some((u) => u.includes("/api/workflow-tasks/cancel"))).toBe(true);
    expect(
      calledUrls.filter((u) => u.includes("/api/workflow-tasks/history")).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("handleCancelRequest失敗時はエラーをrethrowする", async () => {
    mockFetch((url) => {
      if (url.includes("/api/workflow-tasks/cancel")) {
        return jsonResponse({ message: "取下げに失敗しました" }, 400);
      }
      return jsonResponse({ histories: [] });
    });

    const { result } = renderHook(() =>
      useWorkflowHistory({ userId: "user-1", canRead: true, loadingPermissions: false }),
    );
    await waitFor(() => expect(result.current.loadingData).toBe(false));

    await expect(result.current.handleCancelRequest("target-1", "log-1")).rejects.toThrow(
      "取下げに失敗しました",
    );
  });
});
