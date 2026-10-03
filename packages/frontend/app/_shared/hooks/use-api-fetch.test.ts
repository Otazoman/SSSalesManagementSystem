import { describe, it, expect, vi, afterEach } from "vitest";
import { apiFetch } from "./use-api-fetch";

function mockFetchOnce(response: Response) {
  const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () => response,
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("常にcredentials: includeを付与してfetchを呼ぶ", async () => {
    const fetchSpy = mockFetchOnce(jsonResponse({ ok: true }));

    await apiFetch("/api/units");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).credentials).toBe("include");
  });

  it("jsonオプション指定時はContent-Typeを付与しJSON文字列化したbodyを送る", async () => {
    const fetchSpy = mockFetchOnce(jsonResponse({ ok: true }));

    await apiFetch("/api/units", { method: "POST", json: { code: "PCS" } });

    const [, init] = fetchSpy.mock.calls[0];
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect((init as RequestInit).body).toBe(JSON.stringify({ code: "PCS" }));
  });

  it("成功時はJSONレスポンスをそのまま返す", async () => {
    mockFetchOnce(jsonResponse({ code: "PCS", name: "個" }));

    const data = await apiFetch<{ code: string; name: string }>("/api/units/PCS");

    expect(data).toEqual({ code: "PCS", name: "個" });
  });

  it("Content-TypeがJSONでない場合はnullを返す", async () => {
    mockFetchOnce(new Response("plain text", { status: 200 }));

    const data = await apiFetch("/api/units/csv-download");

    expect(data).toBeNull();
  });

  it("エラー時はdata.messageを優先してErrorをthrowする", async () => {
    mockFetchOnce(jsonResponse({ message: "コードが重複しています" }, { status: 400 }));

    await expect(apiFetch("/api/units/register", { method: "POST" })).rejects.toThrow(
      "コードが重複しています",
    );
  });

  it("messageが無い場合はdefaultErrorMessageを使う", async () => {
    mockFetchOnce(jsonResponse({}, { status: 500 }));

    await expect(
      apiFetch("/api/units", { defaultErrorMessage: "一覧の取得に失敗しました" }),
    ).rejects.toThrow("一覧の取得に失敗しました");
  });

  it("エラー時にmessageが無い場合はデフォルトの日本語メッセージを使う", async () => {
    mockFetchOnce(jsonResponse({}, { status: 500 }));

    await expect(apiFetch("/api/units")).rejects.toThrow("処理に失敗しました");
  });
});
