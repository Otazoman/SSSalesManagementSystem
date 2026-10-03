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
    isBusinessLocationWfEnabled: false,
  };
}

function mockRoutes(fetchSpy: ReturnType<typeof vi.fn>, businessLocations: unknown[] = []) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/company-settings")) return jsonResponse({ is_pagination_enabled: false });
    if (u.includes("/api/business-locations")) return jsonResponse(businessLocations);
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

describe("AdminBusinessLocationsPage", () => {
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

  it("営業拠点一覧を取得して表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockRoutes(fetchSpy, [
      {
        id: "BL-1",
        name: "東京営業所",
        postalCode: null,
        address: null,
        phoneNumber: null,
        status: "active",
        memo: null,
      },
    ]);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("東京営業所")).toBeInTheDocument());
  });

  it("CSVインポート(FileReaderでテキスト化しJSON POST {csvData})が正しいbodyでbulk-registerを呼ぶ", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockRoutes(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    await userEvent.click(
      screen.getByRole("button", { name: "➕ 新規個別登録・CSVインポート" }),
    );

    const calledRequests: { url: string; body: unknown }[] = [];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = url.toString();
      calledRequests.push({ url: u, body: init?.body ? JSON.parse(init.body as string) : null });
      if (u === "/api/business-locations/bulk-register") {
        return jsonResponse({ message: "CSVインポートが成功しました" });
      }
      if (u.includes("/api/business-locations")) return jsonResponse([]);
      return jsonResponse({});
    });

    const csvContent = "id,name\nBL-9,新規拠点";
    const file = new File([csvContent], "business_locations.csv", { type: "text/csv" });
    const fileInput = screen
      .getByText("CSVファイルを選択")
      .closest("label")!
      .querySelector("input[type=file]") as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    await waitFor(() =>
      expect(screen.getByText("CSVインポートが成功しました")).toBeInTheDocument(),
    );
    const bulkRegister = calledRequests.find((r) => r.url === "/api/business-locations/bulk-register");
    expect(bulkRegister).toBeDefined();
    expect((bulkRegister!.body as { csvData: string }).csvData).toBe(csvContent);
  });

  it("承認ワークフロー有効時はCSVインポートを行わない", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), isBusinessLocationWfEnabled: true });
    const fetchSpy = vi.fn();
    mockRoutes(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    await userEvent.click(
      screen.getByRole("button", { name: "➕ 新規個別登録・CSVインポート" }),
    );

    expect(screen.getByText("※承認機能が有効な間は利用できません")).toBeInTheDocument();
  });

  it("CSVダウンロードは検索条件をクエリに含めてリクエストする", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockRoutes(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    const blob = new Blob(["id,name"], { type: "text/plain" });
    fetchSpy.mockImplementation(async () => new Response(blob, { status: 200 }));
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) =>
        tag === "a" ? ({ click: vi.fn(), href: "", download: "" } as unknown as HTMLAnchorElement) : originalCreateElement(tag),
      );

    await userEvent.click(screen.getByRole("button", { name: "📥 CSVダウンロード" }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/business-locations/csv-download?status=active"),
        expect.anything(),
      ),
    );
    createElementSpy.mockRestore();
  });

  it("住所が入力されているとGoogleMapへのリンクを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockRoutes(fetchSpy, [
      {
        id: "BL-1",
        name: "東京営業所",
        postalCode: "100-0001",
        address: "東京都千代田区千代田1-1",
        phoneNumber: null,
        status: "active",
        memo: null,
      },
    ]);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    const mapLink = await screen.findByRole("link", { name: /地図で見る/ });
    expect(mapLink).toHaveAttribute(
      "href",
      expect.stringContaining("https://www.google.com/maps/search/?api=1&query="),
    );
  });
});
