"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { JournalPostingEventRecord } from "../_types";

export function useJournalPostingEvents(enabled: boolean = true) {
  const [events, setEvents] = useState<JournalPostingEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // ヘッダクリックソート(追加要望D)。追加要望J-1-a(複合ソート): Shift+クリック(additive)で
  // 複数キーを追加できるよう、`_shared/hooks/use-paginated-list.ts`と同じ設計(キー配列)に合わせる
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

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (sortKeys.length > 0) {
        params.set("sortBy", sortKeys.map((s) => s.key).join(","));
        params.set("sortOrder", sortKeys.map((s) => s.direction).join(","));
      }
      const data = await apiFetch<JournalPostingEventRecord[]>(
        `/api/journal-posting-events?${params.toString()}`,
      );
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "仕訳起票イベントの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [sortKeys]);

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      await reload();
    })();
  }, [enabled, reload]);

  // ユーザー確認済み方針: 転記の自動再試行(バッチ)は行わない。この操作(人が明示的に押す)
  // だけが、失敗した仕訳を再試行する唯一の経路
  const retry = useCallback(
    async (eventId: string) => {
      setRetryingId(eventId);
      setMessage("");
      setError("");
      try {
        const result = await apiFetch<{ success: boolean; message: string }>(
          `/api/journal-posting-events/${eventId}/retry`,
          { method: "POST", defaultErrorMessage: "再転記に失敗しました" },
        );
        if (result.success) {
          setMessage(result.message);
        } else {
          setError(result.message);
        }
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "再転記に失敗しました");
      } finally {
        setRetryingId(null);
      }
    },
    [reload],
  );

  return {
    events,
    loading,
    retryingId,
    message,
    error,
    retry,
    reload,
    sortBy: sortKeys[0]?.key ?? null,
    sortDirection: sortKeys[0]?.direction ?? "asc",
    sortKeys,
    setSort,
  };
}
