import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mockUsePagePermissions = vi.fn();
vi.mock("../../hooks/use-page-permission", () => ({
  usePagePermissions: () => mockUsePagePermissions(),
}));

const mockUsePermissionContext = vi.fn();
vi.mock("../../context/permissioncontext", () => ({
  usePermissionContext: () => mockUsePermissionContext(),
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

function mockFetch(recognitions: unknown[] = []) {
  const fetchSpy = vi.fn(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/purchase-recognitions")) return jsonResponse(recognitions);
    return jsonResponse([]);
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  mockSearchParamsGet.mockReturnValue(null);
  mockUsePermissionContext.mockReturnValue({ user: { id: "user-1", employeeNumber: "E001" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("PurchaseRecognitionsPage", () => {
  it("権限確認中はLoadingGateを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
      isPurchaseRecognitionWfEnabled: false,
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
      isPurchaseRecognitionWfEnabled: false,
      loading: false,
    });
    mockFetch();
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
  });

  it("canRead:trueの場合は見出しと空の仕入一覧を表示する(LISTビュー既定)", async () => {
    mockUsePagePermissions.mockReturnValue({
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
      isPurchaseRecognitionWfEnabled: false,
      loading: false,
    });
    mockFetch([]);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("📦 仕入管理")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("該当 0 件")).toBeInTheDocument());
  });

  it("仕入データがある場合は一覧に反映される", async () => {
    mockUsePagePermissions.mockReturnValue({
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
      isPurchaseRecognitionWfEnabled: false,
      loading: false,
    });
    mockFetch([
      {
        id: "SR-1",
        title: "テスト仕入",
        partnerId: "P-1",
        status: "DRAFT",
        documentType: "PURCHASE",
        totalAmount: 1000,
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
      isPurchaseRecognitionWfEnabled: false,
      loading: false,
    });
    mockFetch();
    const Page = await importPage();

    render(<Page />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "📥 CSVダウンロード" })).toBeDisabled(),
    );
  });
});
