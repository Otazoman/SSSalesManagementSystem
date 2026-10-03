"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import { LocationRecord, ProductRecord, StockRecord, WarehouseRecord } from "../_types";

/**
 * 在庫照会タブ: 倉庫/ロケーション/商品/品質区分での絞り込み(マスタから選択式)とページネーションを管理する。
 */
export function useStockInquiry(paginationEnabled: boolean, enabled: boolean) {
  const [warehouses, setWarehouses] = useState<WarehouseRecord[]>([]);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [masterError, setMasterError] = useState("");

  const [warehouseId, setWarehouseIdState] = useState("");
  const [locationId, setLocationId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qualityStatus, setQualityStatus] = useState("");

  // マスタの初回読み込みが完了しているかをrefで管理する(タブを開いた時に1回だけ取得すればよく、
  // 再取得のたびにレンダーをトリガーする必要はないためstateではなくrefを使う)
  const mastersLoadedRef = useRef(false);
  useEffect(() => {
    if (!enabled || mastersLoadedRef.current) return;
    mastersLoadedRef.current = true;
    void (async () => {
      try {
        const [whs, locs, prods] = await Promise.all([
          apiFetch<WarehouseRecord[]>("/api/warehouses?status=active"),
          apiFetch<LocationRecord[]>("/api/locations?status=active"),
          apiFetch<ProductRecord[]>("/api/products?status=active"),
        ]);
        setWarehouses(whs);
        setLocations(locs);
        setProducts(prods);
      } catch (err: unknown) {
        setMasterError(err instanceof Error ? err.message : "マスタ情報の取得に失敗しました");
      }
    })();
  }, [enabled]);

  // 倉庫を選択している間は、その倉庫に属するロケーションのみへ選択肢を絞る
  const filteredLocations = warehouseId
    ? locations.filter((l) => l.warehouseId === warehouseId)
    : locations;

  // 倉庫の選択が変わった時、選択中のロケーションがその倉庫に属さなくなったらクリアする。
  // (setStateをイベントハンドラ内で行う。useEffectでの反応的なクリアはしない)
  const setWarehouseId = (nextWarehouseId: string) => {
    setWarehouseIdState(nextWarehouseId);
    if (
      locationId &&
      nextWarehouseId &&
      !locations.some((l) => l.id === locationId && l.warehouseId === nextWarehouseId)
    ) {
      setLocationId("");
    }
  };

  const searchParams = new URLSearchParams();
  if (warehouseId) searchParams.set("warehouseId", warehouseId);
  if (locationId) searchParams.set("locationId", locationId);
  if (itemId) searchParams.set("itemId", itemId);
  if (qualityStatus) searchParams.set("qualityStatus", qualityStatus);
  const queryString = searchParams.toString();

  const {
    items: stocks,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    loading,
    refetch,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<StockRecord>(`/api/stocks${queryString ? `?${queryString}` : ""}`, {
    paginationEnabled,
    enabled,
  });

  const clearFilters = () => {
    setWarehouseIdState("");
    setLocationId("");
    setItemId("");
    setQualityStatus("");
  };

  return {
    warehouses,
    locations: filteredLocations,
    products,
    masterError,
    warehouseId,
    setWarehouseId,
    locationId,
    setLocationId,
    itemId,
    setItemId,
    qualityStatus,
    setQualityStatus,
    clearFilters,
    stocks,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    loading,
    refetch,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  };
}
