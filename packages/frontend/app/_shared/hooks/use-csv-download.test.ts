import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCsvDownload } from "./use-csv-download";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCsvDownload", () => {
  it("成功時はcredentials付きでfetchし、aタグ経由でダウンロードを発火する", async () => {
    const blob = new Blob(["code,name"], { type: "text/csv" });
    const fetchSpy = vi.fn(async () => new Response(blob, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock-url"),
      revokeObjectURL: vi.fn(),
    });
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) =>
        tag === "a"
          ? ({ click: clickSpy, href: "", download: "" } as unknown as HTMLAnchorElement)
          : originalCreateElement(tag),
      );

    const { result } = renderHook(() => useCsvDownload({ fileNamePrefix: "units_export" }));

    await act(async () => {
      await result.current.download("/api/units/csv-download");
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/units/csv-download",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(result.current.downloading).toBe(false);

    createElementSpy.mockRestore();
  });

  it("失敗時はonErrorへメッセージを渡し、downloadingをfalseへ戻す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useCsvDownload({ fileNamePrefix: "units_export", onError }),
    );

    await act(async () => {
      await result.current.download("/api/units/csv-download");
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("CSVのダウンロードに失敗しました");
    });
    expect(result.current.downloading).toBe(false);
  });
});
