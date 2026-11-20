import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { TemporaryHolding } from "../_types/temporary-holdings";

// REQ-011(2): 一時保管の一覧と、倉庫・取引先の名前(選択肢・表示用)
export interface HoldingFilters {
  category: string;
  status: string;
  warehouseId: string;
  keyword: string;
}

export const EMPTY_HOLDING_FILTERS: HoldingFilters = { category: "all", status: "HOLDING", warehouseId: "", keyword: "" };

export interface NamedOption {
  id: string;
  name: string;
}

export function holdingsQuery(filters: HoldingFilters): string {
  const params = new URLSearchParams();
  if (filters.category !== "all") params.set("category", filters.category);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.warehouseId) params.set("warehouseId", filters.warehouseId);
  if (filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
  return params.toString();
}

export function useTemporaryHoldings(enabled: boolean) {
  const [filters, setFilters] = useState<HoldingFilters>(EMPTY_HOLDING_FILTERS);
  const [holdings, setHoldings] = useState<TemporaryHolding[]>([]);
  const [warehouses, setWarehouses] = useState<NamedOption[]>([]);
  const [partners, setPartners] = useState<NamedOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void Promise.all([
      apiFetch<NamedOption[]>("/api/warehouses?status=active").catch(() => []),
      apiFetch<NamedOption[] | { data: NamedOption[] }>("/api/partners").catch(() => []),
    ]).then(([w, p]) => {
      if (cancelled) return;
      setWarehouses(Array.isArray(w) ? w : []);
      setPartners(Array.isArray(p) ? p : p.data || []);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const query = holdingsQuery(filters);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const rows = await apiFetch<TemporaryHolding[]>(`/api/temporary-holdings${query ? `?${query}` : ""}`, {
          defaultErrorMessage: "一時保管の一覧の取得に失敗しました",
        });
        if (!cancelled) {
          setHoldings(rows);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "一時保管の一覧の取得に失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, query, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const nameOf = (list: NamedOption[], id: string | null) => (id ? (list.find((o) => o.id === id)?.name ?? id) : "");

  return {
    filters,
    setFilters,
    holdings,
    warehouses,
    partners,
    loading,
    error,
    reload,
    query,
    warehouseName: (id: string | null) => nameOf(warehouses, id),
    partnerName: (id: string | null) => nameOf(partners, id),
  };
}
