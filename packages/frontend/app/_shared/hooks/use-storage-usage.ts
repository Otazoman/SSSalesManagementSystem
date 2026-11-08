"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./use-api-fetch";

/**
 * REQ-001: 使用容量の取得(D1・R2 の管理画面)。autoLoad なら enabled になった時に1回取得し、load で取り直す。
 * R2 は全ファイルを一覧して数えるため、autoLoad にせずボタンで load する
 */
export function useStorageUsage<T>(url: string, { autoLoad, enabled }: { autoLoad: boolean; enabled: boolean }) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(autoLoad);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!autoLoad || !enabled) return;
    let cancelled = false;
    apiFetch<T>(url, { defaultErrorMessage: "使用容量の取得に失敗しました" })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "使用容量の取得に失敗しました");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, autoLoad, enabled]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await apiFetch<T>(url, { defaultErrorMessage: "使用容量の取得に失敗しました" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "使用容量の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [url]);

  return { data, loading, error, load };
}
