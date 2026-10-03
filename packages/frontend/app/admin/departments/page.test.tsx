import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUsePagePermissions = vi.fn();
vi.mock("../../hooks/use-page-permission", () => ({
  usePagePermissions: () => mockUsePagePermissions(),
}));

const mockUsePermissionContext = vi.fn();
vi.mock("../../context/permissioncontext", () => ({
  usePermissionContext: () => mockUsePermissionContext(),
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

function fullPermissions(overrides: Record<string, unknown> = {}) {
  return {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    loading: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockUsePermissionContext.mockReturnValue({
    user: { name: "テストユーザー", roleId: "admin" },
    flatScreens: [],
    loading: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AdminDepartmentsPage", () => {
  it("権限確認中はLoadingGateを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions({ loading: true }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("ユーザー権限を確認中...")).toBeInTheDocument();
  });

  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions({ canRead: false }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("アクセス権限エラー")).toBeInTheDocument();
  });

  it("canRead:trueの場合は組織一覧を取得して表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          { id: "0001", name: "本社", parentDepartmentId: null, memo: null, validFrom: "2020-01-01T00:00:00.000Z", validTo: null },
        ]),
      ),
    );
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("本社")).toBeInTheDocument());
    expect(screen.getByText("🏢 組織・部署マスタ")).toBeInTheDocument();
  });

  it("「新規部署登録・CSVインポート」クリックでフォームを開閉する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions());
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.getByText(/該当組織数/)).toBeInTheDocument());

    await userEvent.click(
      screen.getByRole("button", { name: "➕ 新規部署登録・CSVインポート" }),
    );
    expect(screen.getByText("新規部署・組織階層定義")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByText("新規部署・組織階層定義")).not.toBeInTheDocument();
  });

  it("ログインユーザー名をヘッダーに表示する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions());
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText(/テストユーザー/)).toBeInTheDocument();
  });
});
