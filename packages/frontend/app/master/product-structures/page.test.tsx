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
    isItemStructureWfEnabled: false,
  };
}

function mockAllFetches(
  fetchSpy: ReturnType<typeof vi.fn>,
  opts: { structures?: unknown[] } = {},
) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/item-structures/active-parents")) return jsonResponse([]);
    if (u.includes("/api/item-structures")) return jsonResponse(opts.structures ?? []);
    if (u.includes("/api/products")) return jsonResponse([]);
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

describe("AdminProductStructuresPage", () => {
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

  it("canRead:trueの場合は一覧取得後にタイトルと構成データを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy, {
      structures: [
        {
          id: "STR-1",
          parentItemId: "TOP",
          parentItemName: "完成品A",
          childItemId: "CHILD",
          childItemName: "部品B",
          childItemStatus: "active",
          quantityRequired: 1,
          revision: "1.0",
          validFrom: "2020-01-01",
          validTo: null,
          memo: null,
          childUnitPrice: 10,
          subTotalCost: 10,
          status: "active",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("CHILD")).toBeInTheDocument());
    expect(screen.getByText("🛠️ 品目構成マスタ")).toBeInTheDocument();
  });

  it("「新規個別登録・CSVインポート」クリックでフォーム(BomForm+ツリービューア)を開閉する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    await userEvent.click(
      screen.getByRole("button", { name: "➕ 新規個別登録・CSVインポート" }),
    );
    expect(screen.getByText("新規品目構成(BOM)の登録")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByText("新規品目構成(BOM)の登録")).not.toBeInTheDocument();
  });
});
