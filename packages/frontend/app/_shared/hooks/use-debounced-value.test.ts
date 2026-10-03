import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue, SEARCH_DEBOUNCE_MS } from "./use-debounced-value";

// BUG-031: 検索条件の入力を少し待ってから反映する(1文字ごとに API を呼ばない)
describe("useDebouncedValue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("最初の値は待たずに返し、入力が続いている間は古い値のまま、止まってから新しい値を返す", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: "" },
    });
    expect(result.current).toBe("");

    rerender({ v: "a" });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 100));
    rerender({ v: "ab" });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 100));
    // 入力が続いている間は変わらない
    expect(result.current).toBe("");

    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe("ab");
  });
});
