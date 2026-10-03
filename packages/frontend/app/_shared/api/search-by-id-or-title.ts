import { apiFetch } from "../hooks/use-api-fetch";
import { ApiListResponse } from "./response-types";

// BUG-064: 一覧APIの検索条件(id・title)は「両方に一致」するものだけを返すため、1つの検索欄の文字を両方に
// 入れると、番号で探しても件名が一致せず0件になっていた。番号での検索・件名での検索を別々に問い合わせ、
// 結果を重複なしでまとめる(検索の文字が無ければ1回だけ問い合わせる)。baseUrl は "?" を含む一覧のURL
export async function fetchListByIdOrTitle<T extends { id: string }>(baseUrl: string, search: string): Promise<T[]> {
  const toList = (data: T[] | ApiListResponse<T>) => (Array.isArray(data) ? data : data.data);
  if (!search) return toList(await apiFetch<T[] | ApiListResponse<T>>(baseUrl));

  const encoded = encodeURIComponent(search);
  const [byId, byTitle] = await Promise.all([
    apiFetch<T[] | ApiListResponse<T>>(`${baseUrl}&id=${encoded}`),
    apiFetch<T[] | ApiListResponse<T>>(`${baseUrl}&title=${encoded}`),
  ]);
  const merged = new Map<string, T>();
  for (const row of [...toList(byId), ...toList(byTitle)]) {
    if (!merged.has(row.id)) merged.set(row.id, row);
  }
  return [...merged.values()];
}
