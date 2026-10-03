import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { PROGRESS_STAGE_KEYS, ProgressRow, ProgressStageKey, ProgressStageStatus } from "./_types";

const mockUsePagePermissions = vi.fn();
vi.mock("../hooks/use-page-permission", () => ({
  usePagePermissions: () => mockUsePagePermissions(),
}));

function importPage() {
  return import("./page").then((mod) => mod.default);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeRow(rootId: string): ProgressRow {
  const stages = Object.fromEntries(PROGRESS_STAGE_KEYS.map((k) => [k, []])) as unknown as ProgressRow["stages"];
  stages.sales_order = [{ id: rootId, status: "APPROVED", assigneeName: null, approval: null, completed: false }];
  const stageStatuses = Object.fromEntries(
    PROGRESS_STAGE_KEYS.map((k) => [k, { state: k === "sales_order" ? "IN_PROGRESS" : "NONE", manual: false }]),
  ) as Record<ProgressStageKey, ProgressStageStatus>;
  return {
    rootKind: "sales_order",
    rootId,
    partnerName: "テスト商事",
    title: `${rootId}の件名`,
    projectName: null,
    stages,
    stageStatuses,
    caseState: "IN_PROGRESS",
    nextSteps: [],
    assignments: {},
  };
}

function mockFetch() {
  const fetchSpy = vi.fn(async (url: string) => {
    const u = url.toString();
    if (u.startsWith("/api/progress?")) {
      const params = new URL(u, "http://localhost").searchParams;
      if (params.get("offset") === "30") {
        return jsonResponse({ items: [makeRow("SO-2")], total: null, page: 1, pageSize: 30, nextOffset: null });
      }
      if (params.get("state") === "all") {
        return jsonResponse({ items: [makeRow("SO-1"), makeRow("SO-9")], total: 2, page: 1, pageSize: 30, nextOffset: null });
      }
      return jsonResponse({ items: [makeRow("SO-1")], total: null, page: 1, pageSize: 30, nextOffset: 30 });
    }
    if (u.includes("/api/partners")) return jsonResponse([]);
    if (u.includes("/api/users")) return jsonResponse([]);
    return jsonResponse([]);
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

const calledUrls = (spy: ReturnType<typeof mockFetch>) => spy.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  mockUsePagePermissions.mockReturnValue({ canCreate: true, canRead: true, canUpdate: true, canDelete: true, loading: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ProgressPage(追加要望M-2)", () => {
  it("既定は進行中のみを取得し、案件の件名と完了/進行中バッジを表示する", async () => {
    const spy = mockFetch();
    const Page = await importPage();
    render(<Page />);

    await waitFor(() => expect(screen.getByText("SO-1の件名")).toBeInTheDocument());
    const progressCalls = calledUrls(spy).filter((u) => u.startsWith("/api/progress?"));
    expect(progressCalls[0]).toContain("state=in_progress");
    expect(screen.queryByText("SO-9の件名")).toBeNull();
  });

  it("「さらに読み込む」で続き(nextOffset)を取得して一覧の末尾に追加する", async () => {
    const spy = mockFetch();
    const Page = await importPage();
    render(<Page />);
    await waitFor(() => expect(screen.getByText("さらに読み込む")).toBeInTheDocument());

    fireEvent.click(screen.getByText("さらに読み込む"));
    await waitFor(() => expect(screen.getByText("SO-2の件名")).toBeInTheDocument());
    expect(screen.getByText("SO-1の件名")).toBeInTheDocument();
    expect(calledUrls(spy).some((u) => u.includes("offset=30"))).toBe(true);
    expect(screen.queryByText("さらに読み込む")).toBeNull(); // 続きなし
  });

  it("「完了した案件も表示」を選ぶとstate=allで取得し、総件数付きのページングになる", async () => {
    const spy = mockFetch();
    const Page = await importPage();
    render(<Page />);
    await waitFor(() => expect(screen.getByText("SO-1の件名")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("完了した案件も表示"));
    await waitFor(() => expect(screen.getByText("SO-9の件名")).toBeInTheDocument());
    expect(calledUrls(spy).some((u) => u.startsWith("/api/progress?") && u.includes("state=all"))).toBe(true);
    expect(screen.queryByText("さらに読み込む")).toBeNull();
  });

  it("複合検索の条件(件名・伝票番号・キーワード・見積起点)を検索リクエストに反映する", async () => {
    const spy = mockFetch();
    const Page = await importPage();
    render(<Page />);
    await waitFor(() => expect(screen.getByText("SO-1の件名")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("案件をまとめて検索"), { target: { value: "太陽光" } });
    fireEvent.change(screen.getAllByPlaceholderText("部分一致")[0], { target: { value: "パネル" } }); // 件名
    fireEvent.change(screen.getByPlaceholderText("見積〜支払の伝票番号"), { target: { value: "PO-1" } });
    fireEvent.click(screen.getByLabelText("見積起点の案件のみ"));
    fireEvent.click(screen.getByText("検索"));

    await waitFor(() => {
      const last = calledUrls(spy).filter((u) => u.startsWith("/api/progress?")).at(-1) ?? "";
      const params = new URL(last, "http://localhost").searchParams;
      expect(params.get("q")).toBe("太陽光");
      expect(params.get("title")).toBe("パネル");
      expect(params.get("docNumber")).toBe("PO-1");
      expect(params.get("fromQuote")).toBe("true");
      expect(params.get("state")).toBe("in_progress");
    });
  });
});
