import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUsePagePermissions = vi.fn();
vi.mock("../../hooks/use-page-permission", () => ({
  usePagePermissions: () => mockUsePagePermissions(),
}));

const mockUsePermissionContext = vi.fn();
vi.mock("../../context/permissioncontext", () => ({
  usePermissionContext: () => mockUsePermissionContext(),
}));

async function importPage() {
  const mod = await import("./page");
  return mod.default;
}

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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("WorkflowTasksPage", () => {
  it("権限確認中はLoadingGateを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({ canRead: false, canUpdate: false, loading: true });
    mockFetch(() => jsonResponse([]));
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("権限を確認中...")).toBeInTheDocument();
  });

  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({ canRead: false, canUpdate: false, loading: false });
    mockFetch(() => jsonResponse([]));
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
  });

  it("canRead:trueの場合は見出しと未決済タスク一覧を表示する", async () => {
    mockUsePagePermissions.mockReturnValue({ canRead: true, canUpdate: true, loading: false });
    mockFetch(() => jsonResponse([{ logId: "L1", targetName: "個", createdAt: "2026-01-01" }]));
    const Page = await importPage();

    render(<Page />);

    expect(
      screen.getByText("📥 承認タスク管理(未処理・判定)"),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("個")).toBeInTheDocument());
  });

  it("tasksが0件の場合はBulkActionPanelを表示しない", async () => {
    mockUsePagePermissions.mockReturnValue({ canRead: true, canUpdate: true, loading: false });
    mockFetch(() => jsonResponse([]));
    const Page = await importPage();

    render(<Page />);

    await waitFor(() =>
      expect(
        screen.getByText("現在、あなた宛ての未決済承認タスクはありません。📥"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "🚀 一括承認する" })).not.toBeInTheDocument();
  });

  it("チェックボックス選択後、一括承認を実行するとmy-pendingを再取得する", async () => {
    const fetchSpy = mockFetch((url) => {
      if (url.includes("/api/workflow-tasks/bulk-approve")) {
        return jsonResponse({ message: "1件を一括承認しました" });
      }
      return jsonResponse([{ logId: "L1", targetName: "個", createdAt: "2026-01-01" }]);
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("個")).toBeInTheDocument());
    const rowCheckbox = screen.getAllByRole("checkbox")[1];
    await userEvent.click(rowCheckbox);
    await userEvent.click(screen.getByRole("button", { name: "🚀 一括承認する" }));

    await waitFor(() => expect(screen.getByText("1件を一括承認しました")).toBeInTheDocument());
    expect(
      fetchSpy.mock.calls.filter((c) => c[0].toString().includes("/api/workflow-tasks/my-pending"))
        .length,
    ).toBe(2);
  });
});
