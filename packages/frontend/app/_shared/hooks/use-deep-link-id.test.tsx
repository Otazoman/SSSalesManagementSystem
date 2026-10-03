import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

let currentParam: string | null = null;
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (key: string) => (key === "openId" ? currentParam : null) }),
}));

import { useDeepLinkId } from "./use-deep-link-id";

beforeEach(() => {
  currentParam = null;
  window.history.replaceState({}, "", "/sales/billing");
});

describe("useDeepLinkId", () => {
  it("IDが指定され ready になったら1回だけ onOpen を呼び、URLからparamを除去する", () => {
    currentParam = "B-1";
    window.history.replaceState({}, "", "/sales/billing?openId=B-1&openKind=receipt&keep=1");
    const onOpen = vi.fn();
    const { rerender } = renderHook(() => useDeepLinkId("openId", onOpen, true, ["openKind"]));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toBe("B-1");
    expect((onOpen.mock.calls[0][1] as URLSearchParams).get("openKind")).toBe("receipt");
    expect(window.location.search).toBe("?keep=1");

    rerender();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("ready になるまで開かない", () => {
    currentParam = "B-1";
    const onOpen = vi.fn();
    const { rerender } = renderHook(({ ready }) => useDeepLinkId("openId", onOpen, ready), {
      initialProps: { ready: false },
    });
    expect(onOpen).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("paramが無ければ何もしない", () => {
    const onOpen = vi.fn();
    renderHook(() => useDeepLinkId("openId", onOpen, true));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
