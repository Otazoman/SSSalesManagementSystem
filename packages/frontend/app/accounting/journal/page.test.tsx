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
  return { canRead: true, canUpdate: true, loading: false, ...overrides };
}

const FAILED_EVENT = {
  id: "E-1",
  sourceType: "purchase_order",
  sourceRefId: "PO-1",
  eventType: "PREPAYMENT",
  status: "FAILED",
  postedBatchId: null,
  retryCount: 0,
  errorMessage: "科目コードが見つかりません",
  requestedById: "EMP001",
  requestedAt: "2026-09-09T00:00:00.000Z",
  postedAt: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("JournalPostingEventsPage(権限ガード)", () => {
  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions({ canRead: false }));
    const fetchSpy = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
  });
});

describe("JournalPostingEventsPage(一覧・再転記)", () => {
  it("FAILED行に再転記ボタンを表示し、クリックするとretry APIを呼ぶ", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const u = url.toString();
      if (init?.method === "POST" && u.includes("/retry")) {
        return jsonResponse({ success: true, message: "再転記しました" });
      }
      // 伝票を選んで仕訳を作る(V-4)の一覧・取引先は、このテストの対象外
      if (u.includes("/api/journal-sources") || u.includes("/api/partners")) return jsonResponse([]);
      return jsonResponse([FAILED_EVENT]);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("🔁 再転記")).toBeInTheDocument());
    fireEvent.click(screen.getByText("🔁 再転記"));

    await waitFor(() =>
      expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/E-1/retry"))).toBe(true),
    );
  });

  it("canUpdate:falseの場合は再転記ボタンを無効化する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions({ canUpdate: false }));
    const fetchSpy = vi.fn(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/journal-sources") || u.includes("/api/partners")) return jsonResponse([]);
      return jsonResponse([FAILED_EVENT]);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("🔁 再転記")).toBeInTheDocument());
    expect(screen.getByText("🔁 再転記")).toBeDisabled();
  });
});
