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
