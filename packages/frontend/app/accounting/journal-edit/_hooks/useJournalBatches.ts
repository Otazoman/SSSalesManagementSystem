"use client";

import { useState, useCallback, useRef } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { ApiListResponse } from "../../../_shared/api/response-types";
import { JournalBatchRecord } from "../_types";

// K-6-3: purchase/payment/_hooks/usePayment.tsと同じ構成(一覧+ページング+ヘッダクリックソート)
export function useJournalBatches() {
  const { paginationEnabled } = usePaginationSetting();
  const [batches, setBatches] = useState<JournalBatchRecord[]>([]);
  const [page, setPageState] = useState(1);
  const [limit, setLimitState] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const lastFiltersRef = useRef<Record<string, string>>({});

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [sortKeys, setSortKeys] = useState<{ key: string; direction: "asc" | "desc" }[]>([]);
  const setSort = useCallback((key: string, additive = false) => {
    setSortKeys((prev) => {
      if (additive) {
        const index = prev.findIndex((s) => s.key === key);
        if (index === -1) return [...prev, { key, direction: "asc" }];
        return prev.map((s, i) =>
          i === index ? { key, direction: s.direction === "asc" ? "desc" : "asc" } : s,
        );
      }
      const isOnlyKey = prev.length === 1 && prev[0].key === key;
      return isOnlyKey
        ? [{ key, direction: prev[0].direction === "asc" ? "desc" : "asc" }]
        : [{ key, direction: "asc" }];
    });
  }, []);

  const syncBatches = useCallback(
    async (filters: Record<string, string>, overrides?: { page?: number; limit?: number }) => {
      lastFiltersRef.current = filters;
      const effectivePage = overrides?.page ?? page;
      const effectiveLimit = overrides?.limit ?? limit;

      setLoading(true);
      try {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
          if (value && value !== "all") {
            params.append(key, value);
          }
        });
        if (paginationEnabled) {
          params.append("page", String(effectivePage));
          params.append("limit", String(effectiveLimit));
        }
        if (sortKeys.length > 0) {
          params.append("sortBy", sortKeys.map((s) => s.key).join(","));
          params.append("sortOrder", sortKeys.map((s) => s.direction).join(","));
        }

        const data = await apiFetch<JournalBatchRecord[] | ApiListResponse<JournalBatchRecord>>(
          `/api/journal-batches?${params.toString()}`,
        );

        if (Array.isArray(data)) {
          setBatches(data);
          setTotal(data.length);
          setTotalPages(1);
        } else {
          setBatches(data.data);
          setTotal(data.pagination.total);
          setTotalPages(data.pagination.totalPages);
        }

        if (overrides?.page !== undefined) setPageState(overrides.page);
        if (overrides?.limit !== undefined) setLimitState(overrides.limit);
      } catch (err) {
        setError(err instanceof Error ? err.message : "仕訳バッチ一覧の取得に失敗しました");
      } finally {
        setLoading(false);
      }
    },
    [paginationEnabled, page, limit, sortKeys],
  );

  const setPage = useCallback(
    (nextPage: number) => {
      void syncBatches(lastFiltersRef.current, { page: nextPage });
    },
    [syncBatches],
  );

  const setLimit = useCallback(
    (nextLimit: number) => {
      void syncBatches(lastFiltersRef.current, { limit: nextLimit, page: 1 });
    },
    [syncBatches],
  );

  return {
    batches,
    loading,
    sortBy: sortKeys[0]?.key ?? null,
    sortDirection: sortKeys[0]?.direction ?? "asc",
    sortKeys,
    setSort,
    paginationEnabled,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    message,
    setMessage,
    error,
    setError,
    syncBatches,
  };
}
