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

function mockAllFetches(
  fetchSpy: ReturnType<typeof vi.fn>,
  opts: { settings?: unknown[]; items?: unknown[]; warehouses?: unknown[] } = {},
) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/item-reorder-settings")) return jsonResponse(opts.settings ?? []);
    if (u.includes("/api/products")) return jsonResponse(opts.items ?? []);
    if (u.includes("/api/warehouses")) return jsonResponse(opts.warehouses ?? []);
    return jsonResponse({});
  });
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ItemReorderSettingsPage(権限ガード)", () => {
  it("権限確認中はLoadingGateを表示しAPIを呼ばない", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), loading: true });
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("権限を確認中...")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), canRead: false });
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
  });
});

describe("ItemReorderSettingsPage(CRUD)", () => {
  it("一覧を取得して品目名・倉庫名・発注点・安全在庫を表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy, {
      settings: [
        {
          id: "SET-1",
          itemId: "ITEM-1",
          itemName: "品目A",
          warehouseId: "WH-1",
          warehouseName: "本社倉庫",
          reorderPoint: 10,
          safetyStock: 20,
          memo: null,
        },
      ],
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText(/品目A/)).toBeInTheDocument());
    expect(screen.getByText(/本社倉庫/)).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("新規登録フォームで品目・倉庫を選択し保存すると/registerへPOSTする", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy, {
      items: [{ id: "ITEM-1", name: "品目A" }],
      warehouses: [{ id: "WH-1", name: "本社倉庫" }],
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await userEvent.click(screen.getByRole("button", { name: "➕ 新規個別登録・CSVインポート" }));
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "[ITEM-1] 品目A" })).toBeInTheDocument(),
    );

    const calledUrls: string[] = [];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      calledUrls.push(`${init?.method ?? "GET"} ${url.toString()}`);
      if (url.toString().includes("/register")) {
        const body = JSON.parse(init?.body as string);
        expect(body.itemId).toBe("ITEM-1");
        expect(body.warehouseId).toBe("WH-1");
        expect(body.reorderPoint).toBe(10);
        expect(body.safetyStock).toBe(20);
        return jsonResponse({ success: true, id: "SET-NEW-1" });
      }
      return jsonResponse([]);
    });

    await userEvent.selectOptions(screen.getByDisplayValue("-- 品目選択 --"), "ITEM-1");
    await userEvent.selectOptions(screen.getByDisplayValue("-- 倉庫選択 --"), "WH-1");
    await userEvent.clear(screen.getAllByRole("spinbutton")[0]);
    await userEvent.type(screen.getAllByRole("spinbutton")[0], "10");
    await userEvent.clear(screen.getAllByRole("spinbutton")[1]);
    await userEvent.type(screen.getAllByRole("spinbutton")[1], "20");
    await userEvent.click(screen.getByRole("button", { name: "保存する" }));

    await waitFor(() => expect(calledUrls.some((u) => u.includes("POST") && u.includes("/register"))).toBe(true));
  });

  it("削除確認後、対象idのDELETEを呼ぶ", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy, {
      settings: [
        {
          id: "SET-1",
          itemId: "ITEM-1",
          itemName: "品目A",
          warehouseId: "WH-1",
          warehouseName: "本社倉庫",
          reorderPoint: 10,
          safetyStock: 20,
          memo: null,
        },
      ],
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.getByText(/品目A/)).toBeInTheDocument());

    const calledUrls: string[] = [];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      calledUrls.push(`${init?.method ?? "GET"} ${url.toString()}`);
      return jsonResponse([]);
    });

    await userEvent.click(screen.getByRole("button", { name: "削除" }));

    await waitFor(() =>
      expect(calledUrls.some((u) => u === "DELETE /api/item-reorder-settings/SET-1")).toBe(true),
    );
  });

  it("canUpdate:falseの場合は編集/削除ボタンが無効になる", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), canUpdate: false, canDelete: false });
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy, {
      settings: [
        {
          id: "SET-1",
          itemId: "ITEM-1",
          itemName: "品目A",
          warehouseId: "WH-1",
          warehouseName: "本社倉庫",
          reorderPoint: 10,
          safetyStock: 20,
          memo: null,
        },
      ],
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.getByText(/品目A/)).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "編集" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "削除" })).toBeDisabled();
  });
});
