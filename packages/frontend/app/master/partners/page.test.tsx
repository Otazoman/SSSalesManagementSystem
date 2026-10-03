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
    isPartnerWfEnabled: false,
  };
}

beforeEach(() => {
  mockSearchParamsGet.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("PartnersPage(partners)", () => {
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
        if (url.toString().includes("/api/partners")) {
          return jsonResponse([
            {
              id: "CUST-001",
              name: "株式会社テスト",
              type: "CUSTOMER",
              postalCode: "100-0001",
              address: "東京都",
              creditLimit: 0,
              status: "active",
              memo: null,
              closingDay: null,
              paymentMonthOffset: null,
              paymentDay: null,
            },
          ]);
        }
        return jsonResponse({});
      }),
    );
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("CUST-001")).toBeInTheDocument());
    expect(screen.getByText("🏢 取引先マスタ")).toBeInTheDocument();
  });

  it("「新規個別登録・CSVインポート」クリックでフォームを開閉する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("読み込み中...")).not.toBeInTheDocument());

    await userEvent.click(
      screen.getByRole("button", { name: "➕ 新規個別登録・CSVインポート" }),
    );
    expect(screen.getByText("新規個別取引先登録")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByText("新規個別取引先登録")).not.toBeInTheDocument();
  });

  it("canCreate:falseの場合は新規登録ボタンが無効になる", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), canCreate: false });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("読み込み中...")).not.toBeInTheDocument());

    expect(
      screen.getByRole("button", { name: "➕ 新規個別登録・CSVインポート" }),
    ).toBeDisabled();
  });
});
