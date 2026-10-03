import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
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

function basePermissions() {
  return { canCreate: true, canRead: true, canUpdate: true, canDelete: true, loading: false };
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TaxCategoriesPage(権限ガード)", () => {
  it("権限確認中はLoadingGateを表示しAPIを呼ばない", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), loading: true });
    const fetchSpy = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("権限を確認中...")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("canRead:falseの場合はAccessDeniedInlineを表示しAPIを呼ばない(元々権限ガード自体が欠落していた画面のための重点確認)", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), canRead: false });
    const fetchSpy = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("canRead:trueの場合は一覧を取得して表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          { code: "TAX_10", name: "10%標準税率", taxType: "STANDARD", taxRate: 0.1, validFrom: null, validTo: null },
        ]),
      ),
    );
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("TAX_10")).toBeInTheDocument());
    expect(screen.getByText("10%")).toBeInTheDocument();
  });

  it("canUpdate:falseの場合は行クリックしても編集フォームが開かず編集/削除ボタンが無効になる", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), canUpdate: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          { code: "TAX_10", name: "10%標準税率", taxType: "STANDARD", taxRate: 0.1, validFrom: null, validTo: null },
        ]),
      ),
    );
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.getByText("TAX_10")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "編集" })).toBeDisabled();
    await userEvent.click(screen.getByText("TAX_10"));
    expect(screen.queryByText("新規消費税区分の追加")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("TAX_10")).not.toBeInTheDocument();
  });

  it("canDelete:falseの場合は削除ボタンが無効になる", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), canDelete: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          { code: "TAX_10", name: "10%標準税率", taxType: "STANDARD", taxRate: 0.1, validFrom: null, validTo: null },
        ]),
      ),
    );
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.getByText("TAX_10")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "削除" })).toBeDisabled();
  });

  it("削除確認後、対象コードのDELETEを呼ぶ", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        jsonResponse([
          { code: "TAX_10", name: "10%標準税率", taxType: "STANDARD", taxRate: 0.1, validFrom: null, validTo: null },
        ]),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.getByText("TAX_10")).toBeInTheDocument());

    const calledUrls: string[] = [];
    fetchSpy.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      calledUrls.push(`${init?.method ?? "GET"} ${url.toString()}`);
      return jsonResponse([]);
    });

    await userEvent.click(screen.getByRole("button", { name: "削除" }));

    await waitFor(() =>
      expect(calledUrls.some((u) => u === "DELETE /api/tax-categories/TAX_10")).toBe(true),
    );
  });
});

// BUG-039: 他のマスタと同じく、CSVダウンロード・CSVインポート・テンプレートがある
describe("TaxCategoriesPage(CSV BUG-039)", () => {
  it("登録・更新の両方の権限がある場合は、CSVインポートとテンプレートを表示し、CSVを選ぶと bulk-register へ送る", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn(async (url: string) =>
      url.includes("/bulk-register")
        ? jsonResponse({ success: true, message: "CSVから 1 件の消費税区分を登録・更新しました" })
        : jsonResponse([]),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();
    const { container } = render(<Page />);
    expect(screen.getByText("📥 CSVダウンロード")).toBeInTheDocument();
    expect(screen.getByText("📄 テンプレート")).toBeInTheDocument();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["code,name,taxType,taxRate\n"], "tax.csv", { type: "text/csv" }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/tax-categories/bulk-register",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("CSVから 1 件の消費税区分を登録・更新しました")).toBeInTheDocument(),
    );
  });

  it("更新の権限が無い場合は、CSVインポートを表示しない(CSVダウンロードは表示する)", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), canUpdate: false });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const Page = await importPage();
    render(<Page />);
    expect(screen.getByText("📥 CSVダウンロード")).toBeInTheDocument();
    expect(screen.queryByText("📤 CSVインポート")).toBeNull();
  });
});
