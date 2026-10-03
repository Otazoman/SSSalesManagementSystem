import type { PaginationMeta } from "./pagination";

/**
 * ページネーション対応の一覧レスポンスの共通envelope型。
 * Phase1では型・組み立てヘルパーの新設のみ行う。既存の一覧APIのレスポンス形状は
 * Phase2で機能ごとに個別に移行するまで変化しない(=既存のAPIレスポンス形式を今回変更しない)。
 */
export interface ApiListResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

/** 一覧データとページネーションメタ情報から ApiListResponse を組み立てる */
export function buildListResponse<T>(
  data: T[],
  pagination: PaginationMeta,
): ApiListResponse<T> {
  return { data, pagination };
}
