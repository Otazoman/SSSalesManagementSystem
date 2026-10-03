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
  return {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    loading: false,
    ...overrides,
  };
}

function mockCompanySettingsAndRoles(fetchSpy: ReturnType<typeof vi.fn>, roles: unknown[] = []) {
  fetchSpy.mockImplementation(async (url: string) => {
    if (url.toString().includes("/api/company-settings")) {
      return jsonResponse({ is_pagination_enabled: false });
    }
    if (url.toString().includes("/api/roles")) {
      return jsonResponse(roles);
    }
    return jsonResponse({});
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AdminRolesPage", () => {
  it("権限確認中はLoadingGateを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions({ loading: true }));
    const fetchSpy = vi.fn();
    mockCompanySettingsAndRoles(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("ユーザー権限を確認中...")).toBeInTheDocument();
  });

  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions({ canRead: false }));
    const fetchSpy = vi.fn();
    mockCompanySettingsAndRoles(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🛡️ アクセス拒否")).toBeInTheDocument();
  });

  it("canRead:trueの場合はロール一覧を取得して表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions());
    const fetchSpy = vi.fn();
    mockCompanySettingsAndRoles(fetchSpy, [
      { id: "admin", name: "管理者", description: null, createdAt: "" },
    ]);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("管理者")).toBeInTheDocument());
    expect(screen.getByText("🛡️ 役職・ロールマスタ")).toBeInTheDocument();
  });

  it("行クリックで編集フォームを開く", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions());
    const fetchSpy = vi.fn();
    mockCompanySettingsAndRoles(fetchSpy, [
      { id: "finance_checker", name: "経理検収担当", description: "説明", createdAt: "" },
    ]);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.getByText("経理検収担当")).toBeInTheDocument());

    await userEvent.click(screen.getByText("経理検収担当"));
    expect(screen.getByText("業務ロール情報の編集")).toBeInTheDocument();
  });

  it("canCreate:falseの場合は新規登録ボタンが無効になる", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions({ canCreate: false }));
    const fetchSpy = vi.fn();
    mockCompanySettingsAndRoles(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.getByText(/該当件数/)).toBeInTheDocument());

    expect(
      screen.getByRole("button", { name: "➕ 新規個別登録・CSVインポート" }),
    ).toBeDisabled();
  });
});
