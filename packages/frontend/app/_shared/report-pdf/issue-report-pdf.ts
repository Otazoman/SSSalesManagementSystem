// PERF-07 B-5: 帳票 PDF をブラウザで作って発行する共通処理。
// 以前は「POST /api/<帳票>/:id/generate-pdf」でサーバーが PDF を作っていたが、無料プランの CPU 時間の上限に収まらないため、
// 1. GET  /api/<帳票>/:id/pdf-source でデータを受け取り
// 2. フォント・ロゴ・社印(/api/report-assets/*)を読み込み(Cache Storage に保存し、ETag で変わっていないかを確かめる)
// 3. 共有パッケージ report-renderer の renderReportPdf で PDF を作り(サーバーと同じ描画のコード)
// 4. POST /api/<帳票>/:id/pdf で送る(サーバーは検証して保存し、generate-pdf と同じ後処理をする)
// 応答は generate-pdf と同じ形のため、呼び出し元は apiFetch(generate-pdf) をこの関数に置き換えるだけでよい。
import type { ReportPdfAssets, ReportPdfSource } from "report-renderer";
import { apiFetch } from "../hooks/use-api-fetch";

const ASSET_CACHE_NAME = "report-assets-v1";

// 作成中の件数(「PDF を作成しています」の表示に使う)
let issuingCount = 0;
const listeners = new Set<(issuing: boolean) => void>();
function setIssuing(delta: number) {
  issuingCount = Math.max(0, issuingCount + delta);
  for (const listener of listeners) listener(issuingCount > 0);
}
export function subscribeReportPdfIssuing(listener: (issuing: boolean) => void): () => void {
  listeners.add(listener);
  listener(issuingCount > 0);
  return () => {
    listeners.delete(listener);
  };
}

async function openAssetCache(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(ASSET_CACHE_NAME);
  } catch {
    return null;
  }
}

/**
 * フォント・ロゴ・社印を読み込む。Cache Storage に保存したものがあれば ETag を送り、変わっていなければ(304)それを使う。
 * 登録されていない(404)時は null(ロゴ・社印は無いことがある)。
 */
export async function loadReportAsset(name: "font" | "logo" | "seal"): Promise<ArrayBuffer | null> {
  const url = `/api/report-assets/${name}`;
  const cache = await openAssetCache();
  const cached = cache ? await cache.match(url) : undefined;
  const headers = new Headers();
  const etag = cached?.headers.get("ETag");
  if (etag) headers.set("If-None-Match", etag);

  const res = await fetch(url, { credentials: "include", headers, cache: "no-store" });
  if (res.status === 304 && cached) return cached.arrayBuffer();
  if (res.status === 404) {
    await cache?.delete(url);
    return null;
  }
  if (!res.ok) throw new Error("帳票のフォント・画像の読み込みに失敗しました");
  if (cache) await cache.put(url, res.clone()).catch(() => {});
  return res.arrayBuffer();
}

async function loadReportAssets(): Promise<ReportPdfAssets> {
  const [fontBuffer, logoBuffer, sealBuffer] = await Promise.all([
    loadReportAsset("font"),
    loadReportAsset("logo"),
    loadReportAsset("seal"),
  ]);
  if (!fontBuffer) {
    throw new Error("帳票用の日本語フォントが見つかりません。フォントをアップロードしてください");
  }
  return { fontBuffer, logoBuffer, sealBuffer };
}

/**
 * 帳票 PDF をブラウザで作って発行する。apiBase は帳票の API(例: "/api/quotes")。
 * query は pdf-source に付ける指定(見積書の includeOrderForm など)。応答は generate-pdf と同じ形。
 */
export async function issueReportPdf<T = { success: boolean; message?: string }>(
  apiBase: string,
  id: string,
  options: { query?: Record<string, string>; defaultErrorMessage?: string } = {},
): Promise<T> {
  const defaultErrorMessage = options.defaultErrorMessage ?? "PDF の発行に失敗しました";
  const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : "";
  const encodedId = encodeURIComponent(id);
  setIssuing(1);
  try {
    const [source, assets, renderer] = await Promise.all([
      apiFetch<ReportPdfSource>(`${apiBase}/${encodedId}/pdf-source${query}`, { defaultErrorMessage }),
      loadReportAssets(),
      // PDF を作るライブラリ(pdf-lib など)は大きいため、発行する時に初めて読み込む
      import("report-renderer"),
    ]);
    const pdf = await renderer.renderReportPdf(source, assets);
    const form = new FormData();
    form.append("file", new Blob([pdf as BlobPart], { type: "application/pdf" }), `${id}.pdf`);
    return await apiFetch<T>(`${apiBase}/${encodedId}/pdf`, { method: "POST", body: form, defaultErrorMessage });
  } finally {
    setIssuing(-1);
  }
}

/**
 * 複数の帳票 PDF を順にブラウザで作って発行する(以前の POST /bulk-generate-pdf と同じ。1件の失敗が他に影響しない)。
 * 応答も以前と同じ形({ message, results })にする
 */
export async function issueReportPdfs(
  apiBase: string,
  ids: string[],
  options: { defaultErrorMessage?: string } = {},
): Promise<{ success: true; message: string; results: Array<{ id: string; success: boolean; message: string }> }> {
  const results: Array<{ id: string; success: boolean; message: string }> = [];
  for (const id of ids) {
    try {
      const result = await issueReportPdf<{ message?: string }>(apiBase, id, options);
      results.push({ id, success: true, message: result.message ?? "" });
    } catch (err) {
      results.push({ id, success: false, message: err instanceof Error ? err.message : "PDF生成に失敗しました" });
    }
  }
  const successCount = results.filter((r) => r.success).length;
  return { success: true, message: `${results.length}件中${successCount}件のPDFを生成・送信しました`, results };
}

// ==========================================
// PERF-07 B-6: メール送信と PDF。サーバーはメール送信の時に PDF を作らず、未発行なら「先に PDF を発行してください」を返す。
// 画面は、その時だけブラウザで PDF を発行してから送り直す(利用者の操作は今までと同じ)。
// ==========================================

/** サーバーが返す「PDF が未発行」の理由(backend の各 *-mail.service.ts と同じ文言) */
export const PDF_NOT_ISSUED_MESSAGE = "先に PDF を発行してください";

/** 1件のメール送信。PDF が未発行なら、ブラウザで発行してから送り直す */
export async function sendWithIssuedPdf<T>(
  apiBase: string,
  id: string,
  send: () => Promise<T>,
): Promise<T> {
  try {
    return await send();
  } catch (err) {
    if (!(err instanceof Error) || err.message !== PDF_NOT_ISSUED_MESSAGE) throw err;
  }
  await issueReportPdf(apiBase, id);
  return send();
}

type BulkSendResult = {
  message?: string;
  results?: Array<{ id: string; status: string; error?: string }>;
};

/**
 * 一括のメール送信。PDF が未発行で送れなかった伝票だけを、ブラウザで発行してから送り直す。
 * 応答は一括送信と同じ形にし、件数のメッセージは2回分を合わせたものにする
 */
export async function bulkSendWithIssuedPdf<R extends BulkSendResult>(
  apiBase: string,
  ids: string[],
  send: (ids: string[]) => Promise<R>,
): Promise<R> {
  const first = await send(ids);
  const notIssued = (first.results ?? [])
    .filter((r) => r.status === "FAILED" && r.error === PDF_NOT_ISSUED_MESSAGE)
    .map((r) => r.id);
  if (notIssued.length === 0) return first;

  const issued: string[] = [];
  for (const id of notIssued) {
    try {
      await issueReportPdf(apiBase, id);
      issued.push(id);
    } catch {
      // 発行できなかった伝票は、最初の結果(未発行で失敗)のままにする
    }
  }
  if (issued.length === 0) return first;

  const second = await send(issued);
  const retried = new Map((second.results ?? []).map((r) => [r.id, r]));
  const results = (first.results ?? []).map((r) => retried.get(r.id) ?? r);
  const failed = results.filter((r) => r.status === "FAILED").length;
  return {
    ...second,
    results,
    message: `メールの一括送信を予約しました。(予約: ${results.length - failed}件 / 失敗: ${failed}件)`,
  };
}
