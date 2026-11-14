// 163箇所に散らばる生fetch()呼び出しの共通口。
// `credentials: "include"`の付与漏れ（既存で最低12箇所確認）・エラー整形（`data.message`、
// 無ければdefaultErrorMessageでErrorを投げる既存パターン）を一本化する。
// BUG-041: API のエラー応答は全て`{ success: false, message }`にそろえたため、`data.error`は見ない。

export interface ApiFetchOptions extends Omit<RequestInit, "body" | "credentials"> {
  /** JSON bodyとして送信したいオブジェクト。指定するとContent-Type: application/jsonが自動付与される */
  json?: unknown;
  /** FormData等、JSON化せずそのまま送りたい場合はこちらを使う（Content-Typeは自動付与しない） */
  body?: BodyInit | null;
  /** レスポンスがエラー、かつbodyにmessageが無い場合のフォールバックメッセージ */
  defaultErrorMessage?: string;
}

/**
 * 既存コード全体で繰り返されている
 * 「fetch → !res.ok なら data.message を使って throw new Error(...)」パターンの共通実装。
 * レスポンスはJSONを想定（CSVダウンロード等バイナリ応答はこの関数を使わず個別に扱う）。
 */
export async function apiFetch<T = unknown>(
  url: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { json, body, defaultErrorMessage = "処理に失敗しました", headers, ...rest } = options;

  const finalHeaders = new Headers(headers);
  let finalBody = body;
  if (json !== undefined) {
    finalHeaders.set("Content-Type", "application/json");
    finalBody = JSON.stringify(json);
  }

  const res = await fetch(url, {
    ...rest,
    headers: finalHeaders,
    body: finalBody,
    credentials: "include",
  });

  const contentType = res.headers.get("Content-Type") || "";
  const data = contentType.includes("application/json")
    ? await res.json().catch(() => null)
    : null;

  if (!res.ok) {
    const body = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    const message = typeof body?.message === "string" ? body.message : defaultErrorMessage;
    throw new Error(message);
  }

  return data as T;
}

// ==========================================
// PERF-06: 画面のあちこちから同じ GET が呼ばれる API(会社設定・画面の一覧・プロフィール)を、30秒間まとめる。
// 1画面を開くと同じ API が2〜3回呼ばれ、Backend の CPU 時間(無料プランの上限)を使っていたため。
// 対象は参照だけの GET に限る(編集画面は今までどおり apiFetch / fetch で最新を読む)。
// 会社設定の保存・ログイン・ログアウトなど、内容が変わる時は clearSharedApiCache で破棄する。
// ==========================================

const SHARED_CACHE_TTL_MS = 30_000;
const sharedCache = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();

/** 失敗した応答のエラー(HTTP のステータスを持つ。401 でログイン画面へ移る、などの判定に使う) */
export class ApiFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiFetchError";
  }
}

// 呼び出し元が書き換えても他に影響しないよう、毎回複製して返す
function cloneData<T>(data: T): T {
  return data === null || data === undefined ? data : structuredClone(data);
}

/**
 * 同じ URL の GET を30秒間まとめる apiFetch。同時の呼び出しも1回の通信にまとめる。
 * 失敗した応答はまとめない(次の呼び出しで取り直す)。
 */
export function apiFetchShared<T = unknown>(
  url: string,
  options: { defaultErrorMessage?: string } = {},
): Promise<T> {
  const now = Date.now();
  const cached = sharedCache.get(url);
  if (cached && cached.expiresAt > now) {
    return cached.promise.then((data) => cloneData(data as T));
  }

  const { defaultErrorMessage = "処理に失敗しました" } = options;
  const promise = (async () => {
    const res = await fetch(url, { credentials: "include" });
    const contentType = res.headers.get("Content-Type") || "";
    const data = contentType.includes("application/json")
      ? await res.json().catch(() => null)
      : null;
    if (!res.ok) {
      const body = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
      const message = typeof body?.message === "string" ? body.message : defaultErrorMessage;
      throw new ApiFetchError(message, res.status);
    }
    return data;
  })();

  sharedCache.set(url, { expiresAt: now + SHARED_CACHE_TTL_MS, promise });
  promise.catch(() => {
    if (sharedCache.get(url)?.promise === promise) sharedCache.delete(url);
  });
  return promise.then((data) => cloneData(data as T));
}

/** apiFetchShared でまとめた結果を破棄する(url を省略すると全て) */
export function clearSharedApiCache(url?: string): void {
  if (url === undefined) sharedCache.clear();
  else sharedCache.delete(url);
}
