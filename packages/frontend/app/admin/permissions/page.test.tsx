import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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
  return { canRead: true, canCreate: true, canUpdate: true, loading: false, ...overrides };
}

const screens = [{ resource: "master_units", name: "単位マスタ", category: "master" }];
const permissions = [
  { id: "master_units:menu", resource: "master_units", action: "menu", name: "単位マスタ [メニュー表示]", description: null },
  { id: "master_units:read", resource: "master_units", action: "read", name: "単位マスタ [閲覧 (R)]", description: null },
  { id: "master_units:create", resource: "master_units", action: "create", name: "単位マスタ [登録 (C)]", description: null },
  { id: "master_units:update", resource: "master_units", action: "update", name: "単位マスタ [編集 (U)]", description: null },
  { id: "master_units:delete", resource: "master_units", action: "delete", name: "単位マスタ [削除 (D)]", description: null },
];
const roles = [
  { id: "admin", name: "管理者" },
  { id: "general_user", name: "一般ユーザー" },
];

function mockFetches(fetchSpy: ReturnType<typeof vi.fn>) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/permissions/screens")) return jsonResponse(screens);
    if (u.includes("/api/permissions/role/")) return jsonResponse(["master_units:read"]);
    if (u.includes("/api/roles")) return jsonResponse(roles);
    if (u.includes("/api/permissions")) return jsonResponse(permissions);
    return jsonResponse({});
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("MasterPermissionsPage", () => {
  it("権限確認中はLoadingGateを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions({ loading: true }));
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("ユーザー権限を確認中...")).toBeInTheDocument();
  });

  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions({ canRead: false }));
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🛡️ アクセス拒否")).toBeInTheDocument();
  });

  it("canRead:trueの場合はマトリクス画面を表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions());
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getAllByText("単位マスタ").length).toBeGreaterThan(0));
    expect(screen.getByText("🛡️ 画面・権限マスタ")).toBeInTheDocument();
  });

  it("canUpdate:falseの場合は読み取り専用の警告文を表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions({ canUpdate: false }));
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() =>
      expect(screen.getByText(/編集権限\(update\)がないため、読み取り専用/)).toBeInTheDocument(),
    );
  });
});
