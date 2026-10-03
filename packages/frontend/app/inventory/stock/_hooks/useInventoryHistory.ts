"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import {
  LocationRecord,
  PartnerRecord,
  ReceiptHeaderRecord,
  ReceiptItemRecord,
  ShipmentHeaderRecord,
  ShipmentItemRecord,
  WarehouseRecord,
} from "../_types";

export type HistoryType = "receipt" | "shipment";

// 作成者検索をリストボックス選択にするためのユーザー一覧(created_byはemployeeNumberを保存する
// 方式のため、選択肢のvalueもemployeeNumberに合わせる)
export interface UserOption {
  id: string;
  employeeNumber: string;
  name: string;
}

interface ReceiptDetail {
  header: ReceiptHeaderRecord;
  items: ReceiptItemRecord[];
}
interface ShipmentDetail {
  header: ShipmentHeaderRecord;
  items: ShipmentItemRecord[];
}

/**
 * 入出庫履歴タブ: 入庫/出庫の切替、ステータス・日付・作成者での絞り込み、ページネーション、
 * 行クリックでの明細(ロケーション/ロット/数量)展開表示を管理する。
 */
export function useInventoryHistory(
  paginationEnabled: boolean,
  enabled: boolean,
  initialType: HistoryType = "receipt",
) {
  const [historyType, setHistoryType] = useState<HistoryType>(initialType);
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [warehouseId, setWarehouseIdState] = useState("");
  const [locationId, setLocationId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<
    Record<string, ReceiptDetail | ShipmentDetail>
  >({});
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRecord[]>([]);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [partners, setPartners] = useState<PartnerRecord[]>([]);

  const mastersLoadedRef = useRef(false);
  useEffect(() => {
    if (mastersLoadedRef.current) return;
    mastersLoadedRef.current = true;
    void (async () => {
      try {
        const [userResult, whs, locs, partnerList] = await Promise.all([
          apiFetch<UserOption[]>("/api/users"),
          apiFetch<WarehouseRecord[]>("/api/warehouses?status=active"),
          apiFetch<LocationRecord[]>("/api/locations?status=active"),
          apiFetch<PartnerRecord[]>("/api/partners?status=active"),
        ]);
        setUsers(userResult);
        setWarehouses(whs);
        setLocations(locs);
        setPartners(partnerList);
      } catch {
        // 検索条件の選択肢が取れないだけなので、履歴表示自体は継続する
      }
    })();
  }, []);

  // 倉庫を選択している間は、その倉庫に属するロケーションのみへ選択肢を絞る
  const filteredLocations = warehouseId
    ? locations.filter((l) => l.warehouseId === warehouseId)
    : locations;

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

  const baseUrl = historyType === "receipt" ? "/api/stock-receipts" : "/api/stock-shipments";
  const searchParams = new URLSearchParams();
  if (status) searchParams.set("status", status);
  if (dateFrom) searchParams.set("startDate", dateFrom);
  if (dateTo) searchParams.set("endDate", dateTo);
  if (createdBy) searchParams.set("createdBy", createdBy);
  if (warehouseId) searchParams.set("warehouseId", warehouseId);
  if (locationId) searchParams.set("locationId", locationId);
  if (partnerId) searchParams.set("partnerId", partnerId);
  const queryString = searchParams.toString();

  const {
    items: headers,
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
  } = usePaginatedList<ReceiptHeaderRecord | ShipmentHeaderRecord>(
    `${baseUrl}${queryString ? `?${queryString}` : ""}`,
    { paginationEnabled, enabled },
  );

  const changeHistoryType = (next: HistoryType) => {
    setHistoryType(next);
    setExpandedId(null);
    setPage(1);
  };

  const clearFilters = () => {
    setStatus("");
    setDateFrom("");
    setDateTo("");
    setCreatedBy("");
    setWarehouseIdState("");
    setLocationId("");
    setPartnerId("");
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (detailCache[id]) return;

    setDetailError("");
    setDetailLoading(true);
    try {
      const detail = await apiFetch<ReceiptDetail | ShipmentDetail>(`${baseUrl}/${id}`, {
        defaultErrorMessage: "詳細の取得に失敗しました",
      });
      setDetailCache((prev) => ({ ...prev, [id]: detail }));
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : "詳細の取得に失敗しました");
    } finally {
      setDetailLoading(false);
    }
  };

  return {
    historyType,
    setHistoryType: changeHistoryType,
    status,
    setStatus,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    createdBy,
    setCreatedBy,
    warehouseId,
    setWarehouseId,
    locationId,
    setLocationId,
    partnerId,
    setPartnerId,
    users,
    warehouses,
    locations: filteredLocations,
    partners,
    clearFilters,
    baseUrl,
    csvDownloadUrl: `${baseUrl}/csv-download${queryString ? `?${queryString}` : ""}`,
    headers,
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
    expandedId,
    toggleExpand,
    detailCache,
    detailError,
    detailLoading,
  };
}
