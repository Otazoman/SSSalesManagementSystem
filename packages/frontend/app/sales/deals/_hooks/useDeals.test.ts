import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useDeals } from "./useDeals";

// BUG-032: 会社設定の「一覧のページ分割」が ON の時は、page・limit を付けて取得し、{data, pagination} を展開する
vi.mock("../../../_shared/hooks/use-pagination-setting", () => ({
  usePaginationSetting: () => ({ paginationEnabled: true }),
}));

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDeals(ページ分割 BUG-032)", () => {
  it("page・limit を付けて取得し、件数とページ数を持つ。ページを変えるとそのページを取得する", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.startsWith("/api/sales-deals/tasks")) return json([]);
      if (url.startsWith("/api/sales-deals")) {
        return json({ data: [{ id: "DL0001", title: "商談" }], pagination: { page: 1, limit: 50, total: 120, totalPages: 3 } });
      }
      return json([]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useDeals(true));
    await waitFor(() => expect(result.current.total).toBe(120));
    expect(result.current.totalPages).toBe(3);
    expect(result.current.rows).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/sales-deals?page=1&limit=50", expect.anything());

    act(() => result.current.setPage(2));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/api/sales-deals?page=2&limit=50", expect.anything()),
    );
  });
});
