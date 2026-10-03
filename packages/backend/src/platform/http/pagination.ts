/**
 * 一覧APIのページネーション共通ヘルパー。
 * 既存コードには一切ページネーションの概念が存在せず(docs/target-architecture.md 2.1参照)、
 * 全一覧APIが無制限に全件返却している。Phase1では新設のみ行い、
 * 既存の一覧APIへの適用はPhase2で1機能ずつ行う(未指定時は全件相当を維持する後方互換設計とする)。
 */
export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginationMeta extends PaginationParams {
  total: number;
  totalPages: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * クエリパラメータ(文字列 or undefined)からpage/limitを安全にパースする。
 * 未指定・不正値(0以下・非整数・非数値)はデフォルトにフォールバックし、
 * limitはMAX_LIMITで上限を切る(D1無料枠の読み取り行数を無意味に消費しないため)。
 */
export function parsePaginationParams(query: {
  page?: string;
  limit?: string;
}): PaginationParams {
  const page = toPositiveInt(query.page, DEFAULT_PAGE);
  const requestedLimit = toPositiveInt(query.limit, DEFAULT_LIMIT);
  const limit = Math.min(requestedLimit, MAX_LIMIT);
  return { page, limit };
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return fallback;
  return n;
}

/** Drizzleの.offset()にそのまま渡せるoffset値を計算する */
export function toOffset(params: PaginationParams): number {
  return (params.page - 1) * params.limit;
}

/** 一覧APIのレスポンスに添えるページネーションメタ情報を組み立てる */
export function buildPaginationMeta(
  params: PaginationParams,
  total: number,
): PaginationMeta {
  const totalPages = params.limit > 0 ? Math.ceil(total / params.limit) : 0;
  return { ...params, total, totalPages };
}
