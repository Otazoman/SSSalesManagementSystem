import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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

function mockFetch(billings: unknown[] = []) {
  const fetchSpy = vi.fn(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/sales-billing")) return jsonResponse(billings);
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

describe("SalesBillingPage", () => {
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

  it("canRead:trueの場合は見出しと空の請求一覧を表示する", async () => {
    mockFetch([]);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🧮 請求管理")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("該当 0 件")).toBeInTheDocument());
  });

  it("請求データがある場合は一覧に反映される", async () => {
    mockFetch([
      {
        id: "BL-1",
        title: "9月度請求",
        partnerId: "P-1",
        billingDate: "2026-09-01T00:00:00.000Z",
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

  it("請求を新規登録するボタンから作成モーダルを開閉できる", async () => {
    mockFetch([]);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("該当 0 件")).toBeInTheDocument());

    screen.getByRole("button", { name: "➕ 請求を新規登録する" }).click();
    expect(await screen.findByText("🧮 請求の新規登録")).toBeInTheDocument();

    screen.getByRole("button", { name: "キャンセル" }).click();
    await waitFor(() => expect(screen.queryByText("🧮 請求の新規登録")).not.toBeInTheDocument());
  });
});
