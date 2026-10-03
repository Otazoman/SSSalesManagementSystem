import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
    isProductWfEnabled: false,
  };
}

function mockAllFetches(fetchSpy: ReturnType<typeof vi.fn>, opts: { items?: unknown[] } = {}) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/company-settings")) return jsonResponse({ is_pagination_enabled: false });
    if (u.includes("/api/partners")) return jsonResponse([]);
    if (u.includes("/api/units")) return jsonResponse([]);
    if (u.includes("/api/accounts")) return jsonResponse([]);
    if (u.includes("/api/tax-categories")) return jsonResponse([]);
    if (u.includes("/api/products")) return jsonResponse(opts.items ?? []);
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

describe("AdminProductsPage", () => {
  it("権限確認中はLoadingGateを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), loading: true });
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("権限を確認中...")).toBeInTheDocument();
  });

  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), canRead: false });
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
  });

  it("canRead:trueの場合は一覧取得後にタイトルと品目を表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy, {
      items: [
        {
          id: "ITEM-1",
          name: "品目A",
          isPurchased: false,
          isSales: true,
          isService: false,
          baseUnitCode: "PCS",
          taxCategoryCode: "TAX_10",
          productBarcode: null,
          accountCode: null,
          memo: null,
          status: "active",
          supplierId: null,
          supplierPartNumber: null,
        },
      ],
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("品目A")).toBeInTheDocument());
    expect(screen.getByText("📦 品目マスタ")).toBeInTheDocument();
  });

  it("マウント時に/api/productsへのフェッチは1回のみ発生する(過去の二重フェッチ不具合の回帰防止)", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.queryByText("読み込み中...")).not.toBeInTheDocument());

    const productsCalls = fetchSpy.mock.calls.filter((c) =>
      c[0].toString().includes("/api/products?"),
    );
    expect(productsCalls).toHaveLength(1);
  });

  it("「新規品目個別登録・CSVインポート」クリックでフォームを開閉する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    await userEvent.click(
      screen.getByRole("button", { name: "➕ 新規品目個別登録・CSVインポート" }),
    );
    expect(screen.getByText("新規個別品目登録")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByText("新規個別品目登録")).not.toBeInTheDocument();
  });
});
