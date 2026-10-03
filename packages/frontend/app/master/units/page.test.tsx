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

// page.tsxをdynamic importする(next/navigationのmockがhoistされた後に読み込ませるため)
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

function fullPermissions(overrides: Partial<ReturnType<typeof basePermissions>> = {}) {
  return { ...basePermissions(), ...overrides };
}

function basePermissions() {
  return {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    loading: false,
    isUnitWfEnabled: false,
  };
}

beforeEach(() => {
  mockSearchParamsGet.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AdminUnitsPage(units)", () => {
  it("権限確認中はLoadingGateを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), loading: true });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("権限を確認中...")).toBeInTheDocument();
  });

  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions({ canRead: false }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
  });

  it("canRead:trueの場合は一覧を取得して表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.toString().includes("/api/company-settings")) {
          return jsonResponse({ is_pagination_enabled: false });
        }
        if (url.toString().includes("/api/units")) {
          return jsonResponse([{ code: "PCS", name: "個", status: "active" }]);
        }
        return jsonResponse({});
      }),
    );
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("PCS")).toBeInTheDocument());
    expect(screen.getByText("📐 単位マスタ")).toBeInTheDocument();
  });

  it("「新規個別登録・CSVインポート」クリックでフォームを開閉する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions());
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("読み込み中...")).not.toBeInTheDocument());

    expect(screen.queryByText("新規個別単位登録")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "➕ 新規個別登録・CSVインポート" }),
    );
    expect(screen.getByText("新規個別単位登録")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByText("新規個別単位登録")).not.toBeInTheDocument();
  });

  it("canCreate:falseの場合は新規登録ボタンが無効になる", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions({ canCreate: false }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("読み込み中...")).not.toBeInTheDocument());

    expect(
      screen.getByRole("button", { name: "➕ 新規個別登録・CSVインポート" }),
    ).toBeDisabled();
  });

  it("?editId=xxxがある場合は該当単位の編集フォームを自動で開く", async () => {
    mockSearchParamsGet.mockReturnValue("PCS");
    mockUsePagePermissions.mockReturnValue(fullPermissions());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.toString().includes("/api/units")) {
          return jsonResponse([{ code: "PCS", name: "個", status: "active" }]);
        }
        return jsonResponse({});
      }),
    );
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("単位情報の編集")).toBeInTheDocument());
  });
});
