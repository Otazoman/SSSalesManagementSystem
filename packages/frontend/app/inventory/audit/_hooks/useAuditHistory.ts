"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import { AuditRecord } from "../_types";
import { UserOption } from "../../stock/_hooks/useInventoryHistory";
import { LocationRecord } from "../../stock/_types";

// 品目検索用の選択肢(/api/productsの最小限のフィールドのみ使用)
export interface ItemOption {
  id: string;
  name: string;
}

/**
 * 棚卸履歴タブ: ステータス・日付・作成者・品目・ロケーションでの絞り込み、ページネーションを管理する。
 * 入出庫履歴(useInventoryHistory)と異なり、棚卸はヘッダー+明細ではなく単一行のレコードのため、
 * 行クリックでの明細展開フェッチ(detailCache等)は不要(一覧の行自体が全項目を持つ)
 */
export function useAuditHistory(paginationEnabled: boolean, enabled: boolean) {
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  // 追加要望J-2-j: 品目・ロケーションによる検索
  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [locations, setLocations] = useState<LocationRecord[]>([]);

  const mastersLoadedRef = useRef(false);
  useEffect(() => {
    if (mastersLoadedRef.current) return;
    mastersLoadedRef.current = true;
    void (async () => {
      try {
        const [userResult, itemResult, locationResult] = await Promise.all([
          apiFetch<UserOption[]>("/api/users"),
          apiFetch<ItemOption[]>("/api/products"),
          apiFetch<LocationRecord[]>("/api/locations?status=active"),
        ]);
        setUsers(userResult);
        setItems(itemResult);
        setLocations(locationResult);
      } catch {
        // 検索条件の選択肢が取れないだけなので、履歴表示自体は継続する
      }
    })();
  }, []);

  const baseUrl = "/api/stock-audits";
  const searchParams = new URLSearchParams();
  if (status) searchParams.set("status", status);
  if (dateFrom) searchParams.set("startDate", dateFrom);
  if (dateTo) searchParams.set("endDate", dateTo);
  if (createdBy) searchParams.set("createdBy", createdBy);
  if (itemId) searchParams.set("itemId", itemId);
  if (locationId) searchParams.set("locationId", locationId);
  const queryString = searchParams.toString();

  const {
    items: audits,
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
  } = usePaginatedList<AuditRecord>(`${baseUrl}${queryString ? `?${queryString}` : ""}`, {
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
    items,
    locations,
    users,
    clearFilters,
    baseUrl,
    csvDownloadUrl: `${baseUrl}/csv-download${queryString ? `?${queryString}` : ""}`,
    audits,
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
