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
    isPartnerContactWfEnabled: false,
  };
}

function mockRoutes(fetchSpy: ReturnType<typeof vi.fn>, contacts: unknown[] = []) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/company-settings")) return jsonResponse({ is_pagination_enabled: false });
    if (u.includes("/api/partners")) return jsonResponse([{ id: "P1", name: "取引先A", status: "active" }]);
    if (u.includes("/api/users")) return jsonResponse([]);
    if (u.includes("/api/partner-contacts")) return jsonResponse(contacts);
    return jsonResponse({});
  });
}

beforeEach(() => {
  mockSearchParamsGet.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AdminPartnerContactsPage", () => {
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

  it("canRead:trueの場合は担当者一覧を取得して表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockRoutes(fetchSpy, [
      {
        id: "C1",
        customerId: "P1",
        partnerId: "P1",
        contactType: "CUSTOMER_CONTACT",
        internalUserId: null,
        name: "田中太郎",
        email: null,
        phone: null,
        fax: null,
        departmentName: null,
        isEmailTarget: false,
        memo: null,
        status: "active",
      },
    ]);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("田中太郎")).toBeInTheDocument());
    expect(screen.getByText("📇 取引先担当者マスタ")).toBeInTheDocument();
  });

  it("canCreate:falseの場合はCSVダウンロードボタンが無効になる", async () => {
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
