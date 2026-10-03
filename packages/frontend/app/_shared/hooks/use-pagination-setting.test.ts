import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePaginationSetting } from "./use-pagination-setting";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePaginationSetting", () => {
  it("取得完了までloading:trueかつpaginationEnabled:falseを返す", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    const { result } = renderHook(() => usePaginationSetting());

    expect(result.current.loading).toBe(true);
    expect(result.current.paginationEnabled).toBe(false);
  });

  it("is_pagination_enabled:trueを取得したらpaginationEnabledがtrueになる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ is_pagination_enabled: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    const { result } = renderHook(() => usePaginationSetting());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.paginationEnabled).toBe(true);
  });

  it("取得失敗時はpaginationEnabled:falseにフォールバックする(既存動作を変えない安全側)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    const { result } = renderHook(() => usePaginationSetting());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.paginationEnabled).toBe(false);
  });
});
