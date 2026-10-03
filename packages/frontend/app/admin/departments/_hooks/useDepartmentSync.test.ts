import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDepartmentSync } from "./useDepartmentSync";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDepartmentSync", () => {
  it("loadingPermissions:trueの間はfetchしない", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() =>
      useDepartmentSync({
        filterStatus: "active",
        targetDate: "2026-09-01",
        canRead: true,
        loadingPermissions: true,
      }),
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("canRead:falseの場合はfetchしない", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() =>
      useDepartmentSync({
        filterStatus: "active",
        targetDate: "2026-09-01",
        canRead: false,
        loadingPermissions: false,
      }),
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("filterStatus/targetDateをクエリに付与してfetchし、結果をdepartmentsへ反映する", async () => {
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => jsonResponse([{ id: "0001", name: "本社" }]),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useDepartmentSync({
        filterStatus: "active",
        targetDate: "2026-09-01",
        canRead: true,
        loadingPermissions: false,
      }),
    );

    await waitFor(() => expect(result.current.departments.length).toBe(1));
    const [url] = fetchSpy.mock.calls[0];
    expect(url.toString()).toContain("status=active");
    expect(url.toString()).toContain("targetDate=2026-09-01T00%3A00%3A00.000Z");
  });

  it("targetDateが空文字の場合は当日日付を補完する", async () => {
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => jsonResponse([]),
    );
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() =>
      useDepartmentSync({
        filterStatus: "all",
        targetDate: "",
        canRead: true,
        loadingPermissions: false,
      }),
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url] = fetchSpy.mock.calls[0];
    expect(url.toString()).toMatch(/targetDate=\d{4}-\d{2}-\d{2}T00%3A00%3A00\.000Z/);
  });

  it("取得失敗時はdepartmentsを空配列にフォールバックする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    const { result } = renderHook(() =>
      useDepartmentSync({
        filterStatus: "active",
        targetDate: "2026-09-01",
        canRead: true,
        loadingPermissions: false,
      }),
    );

    await waitFor(() => expect(result.current.departments).toEqual([]));
  });
});
