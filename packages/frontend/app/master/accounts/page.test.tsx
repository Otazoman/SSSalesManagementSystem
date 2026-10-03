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
    isAccountWfEnabled: false,
  };
}

beforeEach(() => {
  mockSearchParamsGet.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AdminAccountsPage", () => {
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

  it("canRead:trueの場合は一覧を取得して表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.toString().includes("/api/company-settings")) {
          return jsonResponse({ is_pagination_enabled: false });
        }
        if (url.toString().includes("/api/accounts")) {
          return jsonResponse([
            { code: "1111", name: "現金", externalMappingCode: null, status: "active", memo: null },
          ]);
        }
        return jsonResponse({});
      }),
    );
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("1111")).toBeInTheDocument());
    expect(screen.getByText("📖 勘定科目マスタ")).toBeInTheDocument();
  });

  it("canCreate/canUpdateが両方falseの場合はCSVダウンロードボタンが無効になる", async () => {
    mockUsePagePermissions.mockReturnValue({
      ...basePermissions(),
      canCreate: false,
      canUpdate: false,
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    expect(screen.getByRole("button", { name: "📥 CSVダウンロード" })).toBeDisabled();
  });
});
