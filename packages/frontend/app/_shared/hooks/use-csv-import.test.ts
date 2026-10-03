import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCsvImport } from "./use-csv-import";

function makeChangeEvent(file: File | null) {
  const input = document.createElement("input");
  input.type = "file";
  if (file) {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
  }
  return { target: input } as React.ChangeEvent<HTMLInputElement>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCsvImport", () => {
  it("ファイル未選択時は何もせずimportingもfalseのまま", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useCsvImport());

    await act(async () => {
      await result.current.importCsv("/api/units/bulk-register", makeChangeEvent(null));
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.importing).toBe(false);
  });

  it("成功時はonMessageとonSuccessを呼び、inputをリセットする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ message: "3件取り込みました" }), { status: 200 }),
      ),
    );
    const onSuccess = vi.fn();
    const onMessage = vi.fn();
    const { result } = renderHook(() => useCsvImport({ onSuccess, onMessage }));
    const event = makeChangeEvent(new File(["code,name"], "units.csv"));

    await act(async () => {
      await result.current.importCsv("/api/units/bulk-register", event);
    });

    expect(onMessage).toHaveBeenCalledWith("3件取り込みました");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(event.target.value).toBe("");
    expect(result.current.importing).toBe(false);
  });

  it("失敗時はonErrorへdata.messageを渡す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ message: "フォーマットが不正です" }), { status: 400 }),
      ),
    );
    const onError = vi.fn();
    const { result } = renderHook(() => useCsvImport({ onError }));

    await act(async () => {
      await result.current.importCsv(
        "/api/units/bulk-register",
        makeChangeEvent(new File(["broken"], "units.csv")),
      );
    });

    expect(onError).toHaveBeenCalledWith("フォーマットが不正です");
  });

  it("multipart/form-dataでcredentials付きPOSTする", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ message: "ok" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useCsvImport());

    await act(async () => {
      await result.current.importCsv(
        "/api/units/bulk-register",
        makeChangeEvent(new File(["code,name"], "units.csv")),
      );
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/units/bulk-register",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: expect.any(FormData),
      }),
    );
  });
});
