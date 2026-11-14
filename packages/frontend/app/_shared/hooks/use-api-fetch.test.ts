import { describe, it, expect, vi, afterEach } from "vitest";
import { apiFetch, apiFetchShared, clearSharedApiCache, ApiFetchError } from "./use-api-fetch";

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

// PERF-06: 画面のあちこちから呼ばれる GET(会社設定・画面の一覧・プロフィール)を30秒間まとめる
describe("apiFetchShared", () => {
  afterEach(() => {
    clearSharedApiCache();
    vi.useRealTimers();
  });

  function stubFetch(handler: () => Response) {
    const fetchSpy = vi.fn(async () => handler());
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  it("同じ URL は30秒間まとめて1回だけ取得し、同時の呼び出しも1回にまとめる", async () => {
    const fetchSpy = stubFetch(() => jsonResponse({ company_name: "A社" }));

    const [a, b] = await Promise.all([
      apiFetchShared<{ company_name: string }>("/api/company-settings"),
      apiFetchShared<{ company_name: string }>("/api/company-settings"),
    ]);
    const c = await apiFetchShared<{ company_name: string }>("/api/company-settings");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect([a.company_name, b.company_name, c.company_name]).toEqual(["A社", "A社", "A社"]);
    expect(fetchSpy.mock.calls[0]).toEqual(["/api/company-settings", { credentials: "include" }]);
  });

  it("呼び出し元ごとに別のオブジェクトを返す(書き換えても他に影響しない)", async () => {
    stubFetch(() => jsonResponse({ company_name: "A社" }));
    const a = await apiFetchShared<{ company_name: string }>("/api/company-settings");
    a.company_name = "書き換え";
    const b = await apiFetchShared<{ company_name: string }>("/api/company-settings");
    expect(b.company_name).toBe("A社");
  });

  it("30秒を過ぎたら取り直す", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchSpy = stubFetch(() => jsonResponse({}));
    await apiFetchShared("/api/permissions/screens");
    vi.setSystemTime(Date.now() + 30_001);
    await apiFetchShared("/api/permissions/screens");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("失敗した応答はまとめず、ステータスを持ったエラーにする", async () => {
    const fetchSpy = stubFetch(() => jsonResponse({ message: "ログインが必要です" }, { status: 401 }));
    const error = await apiFetchShared("/api/auth/profile").catch((e) => e);
    expect(error).toBeInstanceOf(ApiFetchError);
    expect(error).toMatchObject({ message: "ログインが必要です", status: 401 });

    await apiFetchShared("/api/auth/profile").catch(() => {});
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("clearSharedApiCache で、指定した URL(省略時は全て)を取り直す", async () => {
    const fetchSpy = stubFetch(() => jsonResponse({}));
    await apiFetchShared("/api/company-settings");
    await apiFetchShared("/api/auth/profile");
    clearSharedApiCache("/api/company-settings");
    await apiFetchShared("/api/company-settings");
    await apiFetchShared("/api/auth/profile");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    clearSharedApiCache();
    await apiFetchShared("/api/auth/profile");
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});
