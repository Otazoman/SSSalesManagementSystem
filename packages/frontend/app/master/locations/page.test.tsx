import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mockUsePagePermissions = vi.fn();
vi.mock("../../hooks/use-page-permission", () => ({
  usePagePermissions: () => mockUsePagePermissions(),
}));

const mockSearchParamsGet = vi.fn<(key: string) => string | null>(() => null);
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: mockSearchParamsGet }),
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

function basePermissions() {
  return {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    loading: false,
    isLocationWfEnabled: false,
  };
}

function mockRoutes(fetchSpy: ReturnType<typeof vi.fn>, locations: unknown[] = []) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/company-settings")) return jsonResponse({ is_pagination_enabled: false });
    if (u.includes("/api/warehouses")) return jsonResponse([{ id: "WH-1", name: "本社倉庫" }]);
    if (u.includes("/api/locations")) return jsonResponse(locations);
    return jsonResponse({});
  });
}

beforeEach(() => {
  mockSearchParamsGet.mockReturnValue(null);
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AdminLocationsPage", () => {
  it("権限確認中はLoadingGateを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), loading: true });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const Page = await importPage();

    render(<Page />);
    expect(screen.getByText("権限を確認中...")).toBeInTheDocument();
  });

  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), canRead: false });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const Page = await importPage();

    render(<Page />);
    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
  });

  it("倉庫一覧・ロケーション一覧を取得し表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockRoutes(fetchSpy, [
      { id: "LOC-A-01", warehouseId: "WH-1", name: "A棚1段目", memo: null, status: "active" },
    ]);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("A棚1段目")).toBeInTheDocument());
    expect(screen.getByText("本社倉庫")).toBeInTheDocument();
  });

  it("削除確認後、対象のDELETEエンドポイントを呼ぶ", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockRoutes(fetchSpy, [
      { id: "LOC-A-01", warehouseId: "WH-1", name: "A棚1段目", memo: null, status: "suspended" },
    ]);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.getByText("A棚1段目")).toBeInTheDocument());

    const calledUrls: string[] = [];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = url.toString();
      calledUrls.push(`${init?.method ?? "GET"} ${u}`);
      if (init?.method === "DELETE") return jsonResponse({});
      if (u.includes("/api/warehouses")) return jsonResponse([{ id: "WH-1", name: "本社倉庫" }]);
      if (u.includes("/api/locations")) return jsonResponse([]);
      return jsonResponse({});
    });

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByRole("button", { name: "完全に削除 🗑️" }));

    await waitFor(() =>
      expect(calledUrls.some((u) => u === "DELETE /api/locations/LOC-A-01")).toBe(true),
    );
  });

  it("canRead:trueかつcanCreate:falseの場合はCSVダウンロードボタンが無効になる", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), canCreate: false });
    const fetchSpy = vi.fn();
    mockRoutes(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    expect(screen.getByRole("button", { name: "📥 CSVダウンロード" })).toBeDisabled();
  });
});
