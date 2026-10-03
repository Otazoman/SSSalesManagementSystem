import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useWorkflowTasks } from "./useWorkflowTasks";

const mockUsePagePermissions = vi.fn();
vi.mock("../../../hooks/use-page-permission", () => ({
  usePagePermissions: () => mockUsePagePermissions(),
}));

const mockUsePermissionContext = vi.fn();
vi.mock("../../../context/permissioncontext", () => ({
  usePermissionContext: () => mockUsePermissionContext(),
}));

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
    if (url.toString().includes("/api/permissions/screens")) {
      return jsonResponse([]);
    }
    if (url.toString().includes("/api/users")) {
      return jsonResponse([]);
    }
    return handler(url.toString(), init);
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  mockUsePermissionContext.mockReturnValue({ user: { id: "user-1" } });
  mockUsePagePermissions.mockReturnValue({ canRead: true, canUpdate: true, loading: false });
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useWorkflowTasks", () => {
  it("自分宛ての未決済一覧(my-pending)を取得する", async () => {
    const fetchSpy = mockFetch(() => jsonResponse([{ logId: "L1", targetName: "個" }]));

    const { result } = renderHook(() => useWorkflowTasks());

    await waitFor(() => expect(result.current.tasks.length).toBe(1));
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/workflow-tasks/my-pending?userId=user-1"),
      expect.anything(),
    );
  });

  it("canRead:falseの場合はmy-pendingをfetchしない", async () => {
    mockUsePagePermissions.mockReturnValue({ canRead: false, canUpdate: false, loading: false });
    const fetchSpy = mockFetch(() => jsonResponse([]));

    renderHook(() => useWorkflowTasks());

    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/workflow-tasks/my-pending"),
      expect.anything(),
    );
  });

  it("handleSelectAll(true)で全件、(false)で全解除する", async () => {
    mockFetch(() =>
      jsonResponse([
        { logId: "L1", targetName: "A" },
        { logId: "L2", targetName: "B" },
      ]),
    );
    const { result } = renderHook(() => useWorkflowTasks());
    await waitFor(() => expect(result.current.tasks.length).toBe(2));

    act(() => result.current.handleSelectAll(true));
    expect(result.current.selectedLogIds).toEqual(["L1", "L2"]);

    act(() => result.current.handleSelectAll(false));
    expect(result.current.selectedLogIds).toEqual([]);
  });

  it("handleSelectOneはトグル動作する", async () => {
    mockFetch(() => jsonResponse([{ logId: "L1", targetName: "A" }]));
    const { result } = renderHook(() => useWorkflowTasks());
    await waitFor(() => expect(result.current.tasks.length).toBe(1));

    act(() => result.current.handleSelectOne("L1"));
    expect(result.current.selectedLogIds).toEqual(["L1"]);

    act(() => result.current.handleSelectOne("L1"));
    expect(result.current.selectedLogIds).toEqual([]);
  });

  it("canUpdate:falseの場合、handleActionはエラーを設定しAPIを呼ばない", async () => {
    mockUsePagePermissions.mockReturnValue({ canRead: true, canUpdate: false, loading: false });
    const fetchSpy = mockFetch(() => jsonResponse([{ logId: "L1", targetName: "A" }]));
    const { result } = renderHook(() => useWorkflowTasks());
    await waitFor(() => expect(result.current.tasks.length).toBe(1));

    await act(async () => {
      await result.current.handleAction(result.current.tasks[0], "approve");
    });

    expect(result.current.error).toBe("決裁する権限がありません");
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/workflow-tasks/approve"),
      expect.anything(),
    );
  });

  it("確認ダイアログでキャンセルした場合はhandleActionが何もしない", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const fetchSpy = mockFetch(() => jsonResponse([{ logId: "L1", targetName: "A" }]));
    const { result } = renderHook(() => useWorkflowTasks());
    await waitFor(() => expect(result.current.tasks.length).toBe(1));

    await act(async () => {
      await result.current.handleAction(result.current.tasks[0], "approve");
    });

    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/workflow-tasks/approve"),
      expect.anything(),
    );
  });

  it("handleAction(approve)成功時は承認メッセージを設定し一覧を再取得する", async () => {
    const calledUrls: string[] = [];
    mockFetch((url) => {
      calledUrls.push(url);
      if (url.includes("/api/workflow-tasks/approve")) {
        return jsonResponse({});
      }
      return jsonResponse([{ logId: "L1", targetName: "単位マスタ" }]);
    });
    const { result } = renderHook(() => useWorkflowTasks());
    await waitFor(() => expect(result.current.tasks.length).toBe(1));

    await act(async () => {
      await result.current.handleAction(result.current.tasks[0], "approve");
    });

    expect(result.current.message).toBe("「単位マスタ」の申請を承認しました");
    expect(calledUrls.filter((u) => u.includes("/api/workflow-tasks/my-pending")).length).toBe(2);
  });

  it("handleBulkActionは選択0件の場合エラーを設定しAPIを呼ばない", async () => {
    const fetchSpy = mockFetch(() => jsonResponse([]));
    const { result } = renderHook(() => useWorkflowTasks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleBulkAction("bulk-approve");
    });

    expect(result.current.error).toBe("一括処理を行うリクエストが選択されていません");
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/workflow-tasks/bulk-approve"),
      expect.anything(),
    );
  });

  it("handleBulkAction成功時はselectedLogIds/bulkCommentをリセットする", async () => {
    mockFetch((url) => {
      if (url.includes("/api/workflow-tasks/bulk-approve")) {
        return jsonResponse({ message: "2件を一括承認しました" });
      }
      return jsonResponse([
        { logId: "L1", targetName: "A" },
        { logId: "L2", targetName: "B" },
      ]);
    });
    const { result } = renderHook(() => useWorkflowTasks());
    await waitFor(() => expect(result.current.tasks.length).toBe(2));

    act(() => {
      result.current.handleSelectAll(true);
      result.current.setBulkComment("承認します");
    });

    await act(async () => {
      await result.current.handleBulkAction("bulk-approve");
    });

    expect(result.current.message).toBe("2件を一括承認しました");
    expect(result.current.selectedLogIds).toEqual([]);
    expect(result.current.bulkComment).toBe("");
  });

  it("toggleExpandTaskはトグル動作する", async () => {
    mockFetch(() => jsonResponse([{ logId: "L1", targetName: "A" }]));
    const { result } = renderHook(() => useWorkflowTasks());
    await waitFor(() => expect(result.current.tasks.length).toBe(1));

    act(() => result.current.toggleExpandTask("L1"));
    expect(result.current.expandedTaskId).toBe("L1");

    act(() => result.current.toggleExpandTask("L1"));
    expect(result.current.expandedTaskId).toBeNull();
  });
});
