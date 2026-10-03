import { describe, it, expect, vi, afterEach } from "vitest";
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

function fullPermissions(overrides: Record<string, unknown> = {}) {
  return { canCreate: true, canRead: true, canUpdate: true, canDelete: true, loading: false, ...overrides };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("MasterProjectsPage", () => {
  it("権限確認中はLoadingGateを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({ ...fullPermissions(), loading: true });
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
        if (url.toString().includes("/api/projects")) {
          return jsonResponse([{ id: "PJ-001", name: "サンプルPJ", memo: null, startDate: null, endDate: null, status: "active" }]);
        }
        return jsonResponse({});
      }),
    );
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("PJ-001")).toBeInTheDocument());
    expect(screen.getByText("🗂️ プロジェクトマスタ")).toBeInTheDocument();
  });

  it("「新規個別登録・CSVインポート」クリックでフォームを開閉する", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions());
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("読み込み中...")).not.toBeInTheDocument());

    expect(screen.queryByText("新規個別プロジェクト登録")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "➕ 新規個別登録・CSVインポート" }),
    );
    expect(screen.getByText("新規個別プロジェクト登録")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByText("新規個別プロジェクト登録")).not.toBeInTheDocument();
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

  it("行クリックで編集フォームが開く", async () => {
    mockUsePagePermissions.mockReturnValue(fullPermissions());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.toString().includes("/api/projects")) {
          return jsonResponse([{ id: "PJ-001", name: "サンプルPJ", memo: null, startDate: null, endDate: null, status: "active" }]);
        }
        return jsonResponse({});
      }),
    );
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.getByText("PJ-001")).toBeInTheDocument());

    await userEvent.click(screen.getByText("PJ-001"));
    expect(screen.getByText("プロジェクト情報の編集")).toBeInTheDocument();
  });
});
