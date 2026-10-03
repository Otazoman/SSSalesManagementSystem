"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import { DisposalRecord, LocationRecord, WarehouseRecord } from "../_types";
import { UserOption } from "./useInventoryHistory";
import { ItemOption } from "../../audit/_hooks/useAuditHistory";

/**
 * 廃棄履歴タブ: ステータス・日付・作成者・品目・ロケーション・倉庫での絞り込み、
 * ページネーションを管理する。棚卸(useAuditHistory)と同様、廃棄も単一行のレコードのため
 * 明細展開フェッチは不要
 */
export function useDisposalHistory(paginationEnabled: boolean, enabled: boolean) {
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  // K-2-f: 品目・ロケーション・倉庫による検索
  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRecord[]>([]);

  const mastersLoadedRef = useRef(false);
  useEffect(() => {
    if (mastersLoadedRef.current) return;
    mastersLoadedRef.current = true;
    void (async () => {
      try {
        const [userResult, itemResult, locationResult, warehouseResult] = await Promise.all([
          apiFetch<UserOption[]>("/api/users"),
          apiFetch<ItemOption[]>("/api/products"),
          apiFetch<LocationRecord[]>("/api/locations?status=active"),
          apiFetch<WarehouseRecord[]>("/api/warehouses?status=active"),
        ]);
        setUsers(userResult);
        setItems(itemResult);
        setLocations(locationResult);
        setWarehouses(warehouseResult);
      } catch {
        // 検索条件の選択肢が取れないだけなので、履歴表示自体は継続する
      }
    })();
  }, []);

  const baseUrl = "/api/stock-disposals";
  const searchParams = new URLSearchParams();
  if (status) searchParams.set("status", status);
  if (dateFrom) searchParams.set("startDate", dateFrom);
  if (dateTo) searchParams.set("endDate", dateTo);
  if (createdBy) searchParams.set("createdBy", createdBy);
  if (itemId) searchParams.set("itemId", itemId);
  if (locationId) searchParams.set("locationId", locationId);
  if (warehouseId) searchParams.set("warehouseId", warehouseId);
  const queryString = searchParams.toString();

  const {
    items: disposals,
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
  } = usePaginatedList<DisposalRecord>(`${baseUrl}${queryString ? `?${queryString}` : ""}`, {
    paginationEnabled,
    enabled,
  });

  const clearFilters = () => {
    setStatus("");
    setDateFrom("");
    setDateTo("");
    setCreatedBy("");
    setItemId("");
    setLocationId("");
    setWarehouseId("");
  };

  return {
    status,
    setStatus,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    createdBy,
    setCreatedBy,
    itemId,
    setItemId,
    locationId,
    setLocationId,
    warehouseId,
    setWarehouseId,
    items,
    locations,
    warehouses,
    users,
    clearFilters,
    baseUrl,
    csvDownloadUrl: `${baseUrl}/csv-download${queryString ? `?${queryString}` : ""}`,
    disposals,
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
