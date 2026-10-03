import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mockUsePagePermissions = vi.fn();
vi.mock("../../hooks/use-page-permission", () => ({
  usePagePermissions: () => mockUsePagePermissions(),
}));

const mockUsePermissionContext = vi.fn();
vi.mock("../../context/permissioncontext", () => ({
  usePermissionContext: () => mockUsePermissionContext(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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

beforeEach(() => {
  mockUsePermissionContext.mockReturnValue({ user: { id: "user-1" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("WorkflowHistoryPage", () => {
  it("権限確認中はLoadingGateを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({ canRead: false, loading: true });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ histories: [] })));
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("権限を確認中...")).toBeInTheDocument();
  });

  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({ canRead: false, loading: false });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ histories: [] })));
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
  });

  it("canRead:trueの場合は見出しと空の履歴一覧を表示する", async () => {
    mockUsePagePermissions.mockReturnValue({ canRead: true, loading: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.toString().includes("/api/company-settings")) {
          return jsonResponse({ is_pagination_enabled: false });
        }
        if (url.toString().includes("/api/workflow-tasks/history")) {
          return jsonResponse({ histories: [] });
        }
        if (url.toString().includes("/api/permissions/screens")) {
          return jsonResponse([]);
        }
        if (url.toString().includes("/api/users")) {
          // page.tsxはuserMaster.length===0の間テーブルを「読み込み中」扱いにするため、
          // 空配列だと恒久的にloadingのままになる(既存仕様)。テストでは1件返す。
          return jsonResponse([{ id: "user-1", name: "テストユーザー" }]);
        }
        return jsonResponse({});
      }),
    );
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("📜 申請履歴・進捗一覧")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("該当する決裁履歴はありません。")).toBeInTheDocument(),
    );
  });
});
