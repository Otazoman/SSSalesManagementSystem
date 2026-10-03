import { useState, useCallback, useEffect } from "react";
import { useDebouncedValue } from "./use-debounced-value";
import { ApiListResponse } from "../api/response-types";
import { apiFetch } from "./use-api-fetch";

interface UsePaginatedListOptions<TBody> {
  /** 会社設定`is_pagination_enabled`の値。falseの間はpage/limitを送らず従来通り全件取得する */
  paginationEnabled: boolean;
  /** 1ページの初期件数。Backend側`DEFAULT_LIMIT`（50件、platform/http/pagination.ts）に合わせる */
  defaultLimit?: number;
  /** falseの間はfetchしない（権限確認中など） */
  enabled?: boolean;
  /**
   * false の場合、マウント時・検索条件変更時の自動フェッチを行わない
   * （audit-logs/mail-logs等、明示的な検索ボタン押下でのみ検索する画面向け）。
   * デフォルトtrue（従来通りの自動フェッチ）。
   */
  autoFetch?: boolean;
  /** GET: baseUrlにpage/limitをクエリ付与。POST: bodyにpage/limitをマージして送信 */
  method?: "GET" | "POST";
  /** method: "POST" の場合の検索条件本体（page/limitはこのhookが自動でマージする） */
  body?: TBody;
}

type SortDirection = "asc" | "desc";

export interface SortKey {
  key: string;
  direction: SortDirection;
}

interface RefetchOverrides {
  page?: number;
  limit?: number;
  sortKeys?: SortKey[];
}

/**
 * 一覧系APIの page/limit 状態管理＋フェッチを1箇所に集約する共通hook。
 * Backendが返す`{data, pagination}`エンベロープ・従来通りの配列レスポンスの両方に対応する
 * （`paginationEnabled`が無効な間、Backendはpage/limit未指定時は配列をそのまま返す後方互換設計のため）。
 */
export function usePaginatedList<T, TBody = undefined>(
  baseUrl: string,
  {
    paginationEnabled,
    defaultLimit = 50,
    enabled = true,
    autoFetch = true,
    method = "GET",
    body,
  }: UsePaginatedListOptions<TBody>,
) {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(defaultLimit);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // 追加要望D(ヘッダクリックソート)。未設定の間は既存動作と完全に同じリクエストになる。
  // 追加要望J-1-a(複合ソート): 配列で複数キーを保持する。Shift+クリックで2番目以降のキーを追加する
  // (DataTable.tsxのヘッダクリックハンドラがe.shiftKeyをsetSortの第2引数として渡す)
  const [sortKeys, setSortKeysState] = useState<SortKey[]>([]);

  // bodyはfeature側で毎レンダー新規オブジェクトとして渡されることが多いため、
  // 値の変化のみをuseCallbackの依存として検知する（参照の変化では再生成しない）
  const latestBodyKey = method === "POST" ? JSON.stringify(body ?? null) : "";

  // BUG-031: 入力するとすぐ絞り込む画面(autoFetch)では、検索条件(URL・body)の変化を少し待ってから検索する
  // (1文字ごとに API を呼ばない)。ボタンで検索する画面(autoFetch:false)は、押した時点の条件でそのまま検索する
  const debouncedBaseUrl = useDebouncedValue(baseUrl);
  const debouncedBodyKey = useDebouncedValue(latestBodyKey);
  const requestUrl = autoFetch ? debouncedBaseUrl : baseUrl;
  const bodyKey = autoFetch ? debouncedBodyKey : latestBodyKey;
  const requestBody = autoFetch ? (JSON.parse(debouncedBodyKey || "null") as TBody | null) : body;

  const fetchList = useCallback(
    async (overrides?: RefetchOverrides) => {
      if (!enabled) return;

      const effectivePage = overrides?.page ?? page;
      const effectiveLimit = overrides?.limit ?? limit;
      const effectiveSortKeys = overrides?.sortKeys ?? sortKeys;

      setLoading(true);
      setError("");
      try {
        let data: T[] | ApiListResponse<T>;
        // 追加要望J-1-a(複合ソート): 複数キーはカンマ区切りでsortBy/sortOrderに詰める
        // (`platform/http/sort.ts`のbuildOrderBy/applyInMemorySortがカンマ区切りをパースする)
        const sortParams =
          effectiveSortKeys.length > 0
            ? {
                sortBy: effectiveSortKeys.map((s) => s.key).join(","),
                sortOrder: effectiveSortKeys.map((s) => s.direction).join(","),
              }
            : undefined;

        if (method === "POST") {
          const postBody = {
            ...(requestBody as object),
            ...(paginationEnabled ? { page: effectivePage, limit: effectiveLimit } : {}),
            ...(sortParams ?? {}),
          };
          data = await apiFetch<T[] | ApiListResponse<T>>(requestUrl, {
            method: "POST",
            json: postBody,
            defaultErrorMessage: "一覧の取得に失敗しました",
          });
        } else {
          const queryParts: string[] = [];
          if (paginationEnabled) {
            queryParts.push(`page=${effectivePage}`, `limit=${effectiveLimit}`);
          }
          if (sortParams) {
            queryParts.push(
              `sortBy=${encodeURIComponent(sortParams.sortBy)}`,
              `sortOrder=${sortParams.sortOrder}`,
            );
          }
          const url =
            queryParts.length > 0
              ? `${requestUrl}${requestUrl.includes("?") ? "&" : "?"}${queryParts.join("&")}`
              : requestUrl;
          data = await apiFetch<T[] | ApiListResponse<T>>(url, {
            defaultErrorMessage: "一覧の取得に失敗しました",
          });
        }

        if (Array.isArray(data)) {
          setItems(data);
          setTotal(data.length);
          setTotalPages(1);
        } else {
          setItems(data.data);
          setTotal(data.pagination.total);
          setTotalPages(data.pagination.totalPages);
        }

        if (overrides?.page !== undefined) setPage(overrides.page);
        if (overrides?.limit !== undefined) setLimit(overrides.limit);
        if (overrides?.sortKeys !== undefined) {
          setSortKeysState(overrides.sortKeys);
        }
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestUrl, paginationEnabled, page, limit, enabled, method, bodyKey, sortKeys],
  );

  useEffect(() => {
    if (!autoFetch) return;
    void fetchList();
  }, [fetchList, autoFetch]);

  // ページ送り（autoFetch:falseの画面でも、page stateの更新を待たず即座に正しいページで再取得できるようoverrideを使う）
  const changePage = useCallback(
    (nextPage: number) => {
      if (autoFetch) {
        setPage(nextPage);
      } else {
        void fetchList({ page: nextPage });
      }
    },
    [autoFetch, fetchList],
  );

  // limitを変更したら1ページ目に戻す
  const changeLimit = useCallback(
    (nextLimit: number) => {
      if (autoFetch) {
        setLimit(nextLimit);
        setPage(1);
      } else {
        void fetchList({ limit: nextLimit, page: 1 });
      }
    },
    [autoFetch, fetchList],
  );

  // ヘッダクリックソート: 通常クリックは単一キーに置き換え、同じ列の再クリックで昇順⇔降順トグル。
  // 追加要望J-1-a(複合ソート): Shift+クリック(additive=true)の場合は既存のキー配列に追加・トグルし、
  // 他のキーは維持する(Excelの複数キーソートと同じ操作感)。キー数に上限は設けない。
  // ソート条件が変わったら1ページ目に戻す（limit変更時と同じ扱い）。
  // autoFetch:false の画面(audit-logs等、明示的な検索ボタン押下でのみ検索する画面)では、
  // state更新を待たず即座に新しいソート条件で再取得できるようoverrideを使う(changePage/changeLimitと同じ方針)
  const setSort = useCallback(
    (key: string, additive = false) => {
      let next: SortKey[];
      if (additive) {
        const index = sortKeys.findIndex((s) => s.key === key);
        if (index === -1) {
          next = [...sortKeys, { key, direction: "asc" }];
        } else {
          next = sortKeys.map((s, i) =>
            i === index
              ? { key, direction: s.direction === "asc" ? ("desc" as const) : ("asc" as const) }
              : s,
          );
        }
      } else {
        const isOnlyKey = sortKeys.length === 1 && sortKeys[0].key === key;
        next = isOnlyKey
          ? [
              {
                key,
                direction:
                  sortKeys[0].direction === "asc" ? ("desc" as const) : ("asc" as const),
              },
            ]
          : [{ key, direction: "asc" as const }];
      }

      if (autoFetch) {
        setSortKeysState(next);
        setPage(1);
      } else {
        void fetchList({ sortKeys: next, page: 1 });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoFetch, fetchList, sortKeys],
  );

  // 検索結果をクリアする（autoFetch:falseの画面で「条件リセット」時に結果も空にしたい場合に使う）
  const reset = useCallback(() => {
    setItems([]);
    setTotal(0);
    setTotalPages(1);
    setError("");
  }, []);

  return {
    items,
    page,
    setPage: changePage,
    limit,
    setLimit: changeLimit,
    total,
    totalPages,
    loading,
    error,
    refetch: fetchList,
    reset,
    // 後方互換: 先頭キー(プライマリキー)を単一ソートとして扱う既存の利用側(DataTable.tsxのsortBy/sortDirection)に
    // そのまま渡せるようにする。複数キーの見た目(▲②等)を出したい場合はsortKeysを使う
    sortBy: sortKeys[0]?.key ?? null,
    sortDirection: sortKeys[0]?.direction ?? "asc",
    sortKeys,
    setSort,
  };
}
