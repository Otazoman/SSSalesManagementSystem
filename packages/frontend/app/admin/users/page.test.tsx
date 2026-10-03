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

function mockFetches(
  fetchSpy: ReturnType<typeof vi.fn>,
  { users = [], departments = [], roles = [] }: { users?: unknown[]; departments?: unknown[]; roles?: unknown[] } = {},
) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/company-settings")) return jsonResponse({ is_pagination_enabled: false });
    if (u.includes("/api/departments")) return jsonResponse(departments);
    if (u.includes("/api/roles")) return jsonResponse(roles);
    if (u.includes("/api/users")) return jsonResponse(users);
    return jsonResponse({});
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AdminUsersPage", () => {
  it("canRead:falseの場合はAccessDeniedInlineを表示する(loading表示は無い設計)", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions({ canRead: false }));
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
  });

  it("canRead:trueの場合はユーザー一覧・部署・ロールの選択肢を取得して表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions());
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy, {
      users: [
        {
          id: "u1",
          employeeNumber: "EMP001",
          name: "山田 太郎",
          email: "yamada@example.com",
          isActive: true,
          relations: [],
        },
      ],
      departments: [{ id: "d1", name: "開発部" }],
      roles: [{ id: "general_user", name: "一般", description: "" }],
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("山田 太郎")).toBeInTheDocument());
    expect(screen.getByText("👥 ユーザー管理")).toBeInTheDocument();
  });

  it("行クリックで編集フォームを開き、部署・ロールの選択肢がフォームへ渡る", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions());
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy, {
      users: [
        {
          id: "u1",
          employeeNumber: "EMP001",
          name: "山田 太郎",
          email: "yamada@example.com",
          isActive: true,
          relations: [{ departmentId: "d1", departmentName: "開発部", roleId: "general_user", roleName: "一般" }],
        },
      ],
      departments: [{ id: "d1", name: "開発部" }],
      roles: [{ id: "general_user", name: "一般", description: "" }],
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.getByText("山田 太郎")).toBeInTheDocument());

    await userEvent.click(screen.getByText("山田 太郎"));
    expect(screen.getByText("ユーザー情報の編集")).toBeInTheDocument();
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
