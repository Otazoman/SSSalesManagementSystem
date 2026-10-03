import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const mockUsePagePermissions = vi.fn();
vi.mock("../../hooks/use-page-permission", () => ({
  usePagePermissions: () => mockUsePagePermissions(),
}));

function importPage() {
  return import("./page").then((mod) => mod.default);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(payments: unknown[] = []) {
  const fetchSpy = vi.fn(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/purchase-payments")) return jsonResponse(payments);
    if (u.includes("/api/partners")) return jsonResponse([]);
    return jsonResponse([]);
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  mockUsePagePermissions.mockReturnValue({
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    loading: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("PurchasePaymentPage", () => {
  it("権限確認中はLoadingGateを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
      loading: true,
    });
    mockFetch();
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("権限を確認中...")).toBeInTheDocument();
  });

  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
      loading: false,
    });
    mockFetch();
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
  });

  it("canRead:trueの場合は見出しと空の支払一覧を表示する", async () => {
    mockFetch([]);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("💳 支払管理")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("該当 0 件")).toBeInTheDocument());
  });

  it("支払データがある場合は一覧に反映される", async () => {
    mockFetch([
      {
        id: "PM-1",
        title: "9月度支払",
        partnerId: "P-1",
        paymentDate: "2026-09-01T00:00:00.000Z",
        mode: "PER_TRANSACTION",
        status: "DRAFT",
        totalAmount: 11000,
        taxAmount: 1000,
        reconciledAmount: 0,
        reconciliationStatus: "UNRECONCILED",
      },
    ]);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("該当 1 件")).toBeInTheDocument());
  });

  it("canCreate:falseの場合はCSVダウンロードボタンが無効になる", async () => {
    mockUsePagePermissions.mockReturnValue({
      canCreate: false,
      canRead: true,
      canUpdate: true,
      canDelete: true,
      loading: false,
    });
    mockFetch();
    const Page = await importPage();

    render(<Page />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "📥 CSVダウンロード" })).toBeDisabled(),
    );
  });

  it("支払を新規登録するボタンから作成モーダルを開閉できる", async () => {
    mockFetch([]);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("該当 0 件")).toBeInTheDocument());

    screen.getByRole("button", { name: "➕ 支払を新規登録する" }).click();
    expect(await screen.findByText("💳 支払の新規登録")).toBeInTheDocument();

    screen.getByRole("button", { name: "キャンセル" }).click();
    await waitFor(() => expect(screen.queryByText("💳 支払の新規登録")).not.toBeInTheDocument());
  });

  it("列見出しをクリック→別の列をShift+クリックすると複合ソートのクエリが送られる", async () => {
    const fetchSpy = mockFetch([]);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("該当 0 件")).toBeInTheDocument());

    fireEvent.click(screen.getByText("支払コード"));
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some((c) => String(c[0]).includes("sortBy=id")),
      ).toBe(true),
    );

    fetchSpy.mockClear();
    fireEvent.click(screen.getByText("モード"), { shiftKey: true });

    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          (c) => String(c[0]).includes("sortBy=id%2Cmode") || String(c[0]).includes("sortBy=id,mode"),
        ),
      ).toBe(true),
    );
  });

  it("ファームバンキング: 支払を選択し確認するとpreview APIを呼び、結果を表示する", async () => {
    const paymentRow = {
      id: "PM-1",
      title: "9月度支払",
      partnerId: "P-1",
      paymentDate: "2026-09-01T00:00:00.000Z",
      mode: "PER_TRANSACTION",
      status: "DRAFT",
      totalAmount: 11000,
      taxAmount: 1000,
      reconciledAmount: 0,
      reconciliationStatus: "UNRECONCILED",
    };
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const u = url.toString();
      if (init?.method === "POST" && u.includes("/firm-banking-preview")) {
        return jsonResponse({ recordCount: 1, totalAmount: 11000, warnings: [] });
      }
      if (u.includes("/api/purchase-payments")) return jsonResponse([paymentRow]);
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("該当 1 件")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByText("🏦 振込データ作成 (1件)"));
    expect(await screen.findByText("🏦 ファームバンキングデータ作成")).toBeInTheDocument();

    fireEvent.click(screen.getByText("内容を確認する"));

    await waitFor(() =>
      expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/firm-banking-preview"))).toBe(
        true,
      ),
    );
    expect(await screen.findByText("1 件")).toBeInTheDocument();
  });
});
