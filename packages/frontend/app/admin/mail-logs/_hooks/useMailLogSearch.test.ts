import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useMailLogSearch } from "./useMailLogSearch";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch() {
  const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async (url) => {
      if (url.toString().includes("/api/company-settings")) {
        return jsonResponse({ is_pagination_enabled: false });
      }
      if (url.toString().includes("/api/mail-logs/search")) {
        return jsonResponse([]);
      }
      return jsonResponse({});
    },
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  vi.stubGlobal("alert", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMailLogSearch", () => {
  it("マウント時には自動検索しない(autoFetch:false)", async () => {
    const fetchSpy = mockFetch();
    renderHook(() => useMailLogSearch());

    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/mail-logs/search"),
      expect.anything(),
    );
  });

  it("handleSearchで検索条件をbodyに含めPOSTする", async () => {
    const fetchSpy = mockFetch();
    const { result } = renderHook(() => useMailLogSearch());

    act(() => {
      result.current.setKeyword("見積書");
      result.current.setStatus("FAILED");
    });

    await act(async () => {
      result.current.handleSearch();
    });

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/mail-logs/search",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const call = fetchSpy.mock.calls.find((c) => c[0].toString().includes("/api/mail-logs/search"));
    const body = JSON.parse((call?.[1] as RequestInit).body as string);
    expect(body).toEqual({
      startDate: "",
      endDate: "",
      documentId: "",
      keyword: "見積書",
      status: "FAILED",
    });
  });

  it("handleClearFieldsで検索条件と結果をリセットする", () => {
    mockFetch();
    const { result } = renderHook(() => useMailLogSearch());

    act(() => {
      result.current.setKeyword("見積書");
    });
    act(() => {
      result.current.handleClearFields();
    });

    expect(result.current.keyword).toBe("");
    expect(result.current.total).toBe(0);
  });

  it("該当件数0件でCSVダウンロードしても、alert は出さず、fetchしない(BUG-037)", async () => {
    const fetchSpy = mockFetch();
    const { result } = renderHook(() => useMailLogSearch());

    await act(async () => {
      await result.current.handleDownloadCsvFile();
    });

    expect(window.alert).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/mail-logs/csv-download"),
      expect.anything(),
    );
  });

  it("該当件数がある場合はCSVダウンロードエンドポイントを検索条件付きで呼ぶ", async () => {
    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (url) => {
        if (url.toString().includes("/api/company-settings"))
          return jsonResponse({ is_pagination_enabled: false });
        if (url.toString().includes("/api/mail-logs/search")) return jsonResponse([{ id: "1" }]);
        if (url.toString().includes("/api/mail-logs/csv-download"))
          return new Response(new Blob(["id"]), { status: 200 });
        return jsonResponse({});
      },
    );
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "a"
        ? ({ click: vi.fn(), href: "", download: "" } as unknown as HTMLAnchorElement)
        : originalCreateElement(tag),
    );

    const { result } = renderHook(() => useMailLogSearch());
    act(() => {
      result.current.setDocumentId("QT-1");
    });
    await act(async () => {
      result.current.handleSearch();
    });
    await waitFor(() => expect(result.current.total).toBeGreaterThan(0));

    await act(async () => {
      await result.current.handleDownloadCsvFile();
    });

    const call = fetchSpy.mock.calls.find((c) =>
      c[0].toString().includes("/api/mail-logs/csv-download"),
    );
    expect(call).toBeDefined();
    expect(call?.[0].toString()).toContain("documentId=QT-1");
  });
});
