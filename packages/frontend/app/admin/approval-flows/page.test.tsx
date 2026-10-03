import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUsePagePermissions = vi.fn();
vi.mock("../../hooks/use-page-permission", () => ({
  usePagePermissions: () => mockUsePagePermissions(),
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

function fullPermissions(overrides: Record<string, unknown> = {}) {
  return { canCreate: true, canRead: true, canUpdate: true, canDelete: true, loading: false, ...overrides };
}

function mockFetches(fetchSpy: ReturnType<typeof vi.fn>, flows: unknown[] = []) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/approval-flows")) return jsonResponse(flows);
    if (u.includes("/api/roles")) return jsonResponse([{ id: "general_user", name: "一般ユーザー" }]);
    if (u.includes("/api/permissions/screens")) {
      return jsonResponse([{ resource: "master_units", name: "単位マスタ", category: "business_master" }]);
    }
    if (u.includes("/api/departments")) return jsonResponse([]);
    return jsonResponse({});
  });
}

const activeFlow = {
  id: "f1",
  name: "購買申請_通常",
  requestType: "master_units",
  minAmount: 0,
  maxAmount: 100000,
  isActive: true,
  steps: [
    { id: "s1", stepOrder: 1, approverRoleId: "general_user", roleName: "一般ユーザー", targetDepartmentSurrogateId: null, stepName: "承認", memo: null },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("MasterApprovalFlowsPage", () => {
  it("権限確認中はLoadingGateを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions({ loading: true }));
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("セキュリティ権限の検証中... 🛡️")).toBeInTheDocument();
  });

  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions({ canRead: false }));
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
  });

  it("canRead:trueの場合は有効フローのみ一覧に表示する(デフォルトfilterStatus=active)", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions());
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy, [activeFlow]);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("購買申請_通常")).toBeInTheDocument());
    expect(screen.getByText("🔀 承認フロー定義")).toBeInTheDocument();
  });

  it("行クリックで編集フォームを開く", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions());
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy, [activeFlow]);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.getByText("購買申請_通常")).toBeInTheDocument());

    await userEvent.click(screen.getByText("購買申請_通常"));
    expect(screen.getByText("承認フロー情報の編集")).toBeInTheDocument();
  });

  it("canCreate:falseの場合は新規登録ボタンが無効になる", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions({ canCreate: false }));
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.getByText(/該当件数/)).toBeInTheDocument());

    expect(
      screen.getByRole("button", { name: "➕ 新規個別登録・CSVインポート" }),
    ).toBeDisabled();
  });
});
