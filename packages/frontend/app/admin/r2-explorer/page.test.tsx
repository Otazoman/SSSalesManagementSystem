import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

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

function basePermissions(overrides: Record<string, unknown> = {}) {
  return { canRead: true, canUpdate: true, canDelete: true, loading: false, ...overrides };
}

const BUCKETS = [
  { key: "system", label: "システム(フォント・ロゴ・印影ほか)" },
  { key: "quotes", label: "見積添付" },
];

const LIST_RESULT = {
  currentPrefix: "",
  parentPrefix: null,
  items: [
    { name: "docs", path: "docs/", type: "folder" },
    { name: "a.pdf", path: "a.pdf", type: "file", size: 2048, contentType: "application/pdf" },
  ],
};

function buildFetchSpy(overrides: { onDelete?: () => Response } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = url.toString();
    if (u.includes("/api/r2-explorer/buckets")) return jsonResponse(BUCKETS);
    if (init?.method === "POST" && u.includes("/objects/delete")) {
      return overrides.onDelete ? overrides.onDelete() : jsonResponse({ success: true, message: "ファイルを削除しました" });
    }
    if (u.includes("/api/r2-explorer/objects")) return jsonResponse(LIST_RESULT);
    return jsonResponse({});
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("R2ExplorerPage(権限ガード)", () => {
  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions({ canRead: false }));
    vi.stubGlobal("fetch", buildFetchSpy());
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
  });
});

describe("R2ExplorerPage(一覧・削除)", () => {
  it("バケット一覧とファイル一覧を表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    vi.stubGlobal("fetch", buildFetchSpy());
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("見積添付")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("a.pdf", { exact: false })).toBeInTheDocument());
    expect(screen.getByText("docs", { exact: false })).toBeInTheDocument();
  });

  it("削除ボタンをクリックし確認するとdelete APIを呼ぶ", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = buildFetchSpy();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("🗑️ 削除")).toBeInTheDocument());
    fireEvent.click(screen.getByText("🗑️ 削除"));

    await waitFor(() =>
      expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/objects/delete"))).toBe(true),
    );
  });

  it("canDelete:falseの場合は削除ボタンを無効化する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions({ canDelete: false }));
    vi.stubGlobal("fetch", buildFetchSpy());
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("🗑️ 削除")).toBeInTheDocument());
    expect(screen.getByText("🗑️ 削除")).toBeDisabled();
  });
});
