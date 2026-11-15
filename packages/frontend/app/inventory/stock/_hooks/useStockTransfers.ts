import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { LocationRecord, ProductRecord, WarehouseRecord } from "../_types";
import { StockTransfer } from "../_types/stock-transfers";

// REQ-006: 倉庫間移動の一覧と、倉庫・ロケーション・品目の名前
export function useStockTransfers(enabled: boolean) {
  const [status, setStatus] = useState("open");
  const [warehouseId, setWarehouseId] = useState("");
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRecord[]>([]);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void Promise.all([
      apiFetch<WarehouseRecord[]>("/api/warehouses?status=active").catch(() => []),
      apiFetch<LocationRecord[]>("/api/locations?status=active").catch(() => []),
      apiFetch<ProductRecord[]>("/api/products?status=active").catch(() => []),
    ]).then(([w, l, p]) => {
      if (cancelled) return;
      setWarehouses((Array.isArray(w) ? w : []).filter((x) => x.warehouseType !== "DIRECT"));
      setLocations(Array.isArray(l) ? l : []);
      setProducts(Array.isArray(p) ? p : []);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const params = new URLSearchParams();
    // 「進行中」は出庫の承認待ち・輸送中・一部入庫
    if (status !== "all" && status !== "open") params.set("status", status);
    if (warehouseId) params.set("warehouseId", warehouseId);
    void (async () => {
      setLoading(true);
      try {
        const rows = await apiFetch<StockTransfer[]>(`/api/stock-transfers${params.size ? `?${params}` : ""}`, {
          defaultErrorMessage: "倉庫間移動の一覧の取得に失敗しました",
        });
        if (cancelled) return;
        setTransfers(
          status === "open" ? rows.filter((t) => ["SHIPPING_PENDING", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(t.status)) : rows,
        );
        setError("");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "倉庫間移動の一覧の取得に失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, status, warehouseId, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  return {
    status,
    setStatus,
    warehouseId,
    setWarehouseId,
    transfers,
    warehouses,
    locations,
    products,
    loading,
    error,
    reload,
    warehouseName: (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? id ?? "",
    productName: (id: string) => products.find((p) => p.id === id)?.name ?? id,
    locationName: (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name ?? id) : ""),
  };
}
