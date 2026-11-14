import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// PDF の描画そのものは共有パッケージ(backend のテストで確かめている)のため、ここでは差し替える
const renderReportPdf = vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
vi.mock("report-renderer", () => ({ renderReportPdf }));

import { issueReportPdf, loadReportAsset, subscribeReportPdfIssuing } from "./issue-report-pdf";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const SOURCE = { documentType: "sales_quote", customLayout: null, fallback: { kind: "document", data: {} } };

function stubFetch(overrides: Record<string, () => Response> = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    for (const [key, make] of Object.entries(overrides)) {
      if (String(url).includes(key)) return make();
    }
    if (String(url).includes("/pdf-source")) return jsonResponse(SOURCE);
    if (String(url).includes("/api/report-assets/font")) return new Response(new Uint8Array([1, 2, 3]), { headers: { ETag: '"f1"' } });
    if (String(url).includes("/api/report-assets/")) return new Response(null, { status: 404 });
    if (String(url).endsWith("/pdf")) return jsonResponse({ success: true, message: "PDFを生成しました" });
    return new Response(null, { status: 500 });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return calls;
}

beforeEach(() => {
  renderReportPdf.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("issueReportPdf(PERF-07 B-5)", () => {
  it("データを受け取り、フォント・ロゴ・社印を読み、PDF を作って送る。応答は generate-pdf と同じ形", async () => {
    const calls = stubFetch();

    const result = await issueReportPdf("/api/quotes", "QT-1", { query: { includeOrderForm: "true" } });

    expect(result).toEqual({ success: true, message: "PDFを生成しました" });
    expect(calls.map((c) => c.url)).toEqual(
      expect.arrayContaining([
        "/api/quotes/QT-1/pdf-source?includeOrderForm=true",
        "/api/report-assets/font",
        "/api/report-assets/logo",
        "/api/report-assets/seal",
        "/api/quotes/QT-1/pdf",
      ]),
    );
    expect(renderReportPdf).toHaveBeenCalledWith(SOURCE, {
      fontBuffer: expect.any(ArrayBuffer),
      logoBuffer: null,
      sealBuffer: null,
    });
    const upload = calls.find((c) => c.url === "/api/quotes/QT-1/pdf")!;
    expect(upload.init?.method).toBe("POST");
    const file = (upload.init?.body as FormData).get("file") as File;
    expect(file.type).toBe("application/pdf");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
  });

  it("フォントが登録されていなければ、送らずにエラーにする", async () => {
    const calls = stubFetch({ "/api/report-assets/font": () => new Response(null, { status: 404 }) });

    await expect(issueReportPdf("/api/quotes", "QT-1")).rejects.toThrow("帳票用の日本語フォントが見つかりません");
    expect(calls.some((c) => c.url.endsWith("/pdf"))).toBe(false);
  });

  it("データの取得や送信のエラーは、サーバーのメッセージをそのまま投げる", async () => {
    stubFetch({ "/pdf-source": () => jsonResponse({ success: false, message: "検収書は入庫が確定(承認済み)している場合のみ発行できます" }, 400) });
    await expect(issueReportPdf("/api/stock-receipts", "R-1")).rejects.toThrow("検収書は入庫が確定(承認済み)している場合のみ発行できます");
  });

  it("作成中は「PDF を作成しています」の状態になり、終わると戻る", async () => {
    stubFetch();
    const states: boolean[] = [];
    const unsubscribe = subscribeReportPdfIssuing((issuing) => states.push(issuing));
    await issueReportPdf("/api/quotes", "QT-1");
    unsubscribe();
    expect(states).toEqual([false, true, false]);
  });
});

describe("loadReportAsset: Cache Storage と ETag(PERF-07 B-5)", () => {
  it("保存したものがあれば ETag を送り、変わっていなければ(304)保存したものを使う", async () => {
    const store = new Map<string, Response>();
    vi.stubGlobal("caches", {
      open: async () => ({
        match: async (url: string) => store.get(url)?.clone(),
        put: async (url: string, res: Response) => void store.set(url, res),
        delete: async (url: string) => store.delete(url),
      }),
    });
    const sentEtags: Array<string | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const etag = new Headers(init?.headers).get("If-None-Match");
        sentEtags.push(etag);
        if (etag === '"f1"') return new Response(null, { status: 304 });
        return new Response(new Uint8Array([7, 7, 7]), { headers: { ETag: '"f1"' } });
      }),
    );

    expect(new Uint8Array((await loadReportAsset("font"))!)).toEqual(new Uint8Array([7, 7, 7]));
    expect(new Uint8Array((await loadReportAsset("font"))!)).toEqual(new Uint8Array([7, 7, 7]));
    expect(sentEtags).toEqual([null, '"f1"']);
  });
});

describe("メール送信と PDF(PERF-07 B-6)", () => {
  it("1件の送信: 未発行なら、ブラウザで発行してから送り直す。発行済みならそのまま送る", async () => {
    const { sendWithIssuedPdf, PDF_NOT_ISSUED_MESSAGE } = await import("./issue-report-pdf");
    const calls = stubFetch();
    let attempts = 0;
    const send = vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new Error(PDF_NOT_ISSUED_MESSAGE);
      return { success: true };
    });

    expect(await sendWithIssuedPdf("/api/quotes", "QT-1", send)).toEqual({ success: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(calls.some((c) => c.url === "/api/quotes/QT-1/pdf")).toBe(true);

    const sendOk = vi.fn(async () => ({ success: true }));
    await sendWithIssuedPdf("/api/quotes", "QT-2", sendOk);
    expect(sendOk).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.url === "/api/quotes/QT-2/pdf-source")).toBe(false);
  });

  it("1件の送信: 未発行以外のエラーは、発行せずにそのまま投げる", async () => {
    const { sendWithIssuedPdf } = await import("./issue-report-pdf");
    const calls = stubFetch();
    await expect(
      sendWithIssuedPdf("/api/quotes", "QT-1", async () => {
        throw new Error("宛先がありません");
      }),
    ).rejects.toThrow("宛先がありません");
    expect(calls).toHaveLength(0);
  });

  it("一括送信: 未発行で送れなかった伝票だけを発行して送り直し、件数をまとめる", async () => {
    const { bulkSendWithIssuedPdf, PDF_NOT_ISSUED_MESSAGE } = await import("./issue-report-pdf");
    const calls = stubFetch();
    const sent: string[][] = [];
    const send = vi.fn(async (ids: string[]) => {
      sent.push(ids);
      if (sent.length === 1) {
        return {
          message: "1回目",
          results: [
            { id: "A", status: "SUCCESS" },
            { id: "B", status: "FAILED", error: PDF_NOT_ISSUED_MESSAGE },
            { id: "C", status: "FAILED", error: "宛先がありません" },
          ],
        };
      }
      return { message: "2回目", results: ids.map((id) => ({ id, status: "SUCCESS" })) };
    });

    const result = await bulkSendWithIssuedPdf("/api/quotes", ["A", "B", "C"], send);

    expect(sent).toEqual([["A", "B", "C"], ["B"]]);
    expect(calls.filter((c) => c.url.endsWith("/pdf")).map((c) => c.url)).toEqual(["/api/quotes/B/pdf"]);
    expect(result.message).toBe("メールの一括送信を予約しました。(予約: 2件 / 失敗: 1件)");
    expect(result.results).toEqual([
      { id: "A", status: "SUCCESS" },
      { id: "B", status: "SUCCESS" },
      { id: "C", status: "FAILED", error: "宛先がありません" },
    ]);
  });
});
