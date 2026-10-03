"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import { ShipmentInstructionHeaderRecord } from "../_types";
import { UserOption } from "./useInventoryHistory";

// Item6 Phase6-4: 出荷指示一覧タブ。ステータス・日付・作成者での絞り込み、ページネーションを管理する。
// 廃棄履歴(useDisposalHistory)と同様のパターン
export function useShipmentInstructionHistory(paginationEnabled: boolean, enabled: boolean) {
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const result = await apiFetch<UserOption[]>("/api/users");
        setUsers(result);
      } catch {
        // 作成者リストボックスの候補が取れないだけなので、履歴表示自体は継続する
      }
    })();
  }, []);

  const baseUrl = "/api/shipment-instructions";
  const searchParams = new URLSearchParams();
  if (status) searchParams.set("status", status);
  if (dateFrom) searchParams.set("startDate", dateFrom);
  if (dateTo) searchParams.set("endDate", dateTo);
  if (createdBy) searchParams.set("createdBy", createdBy);
  const queryString = searchParams.toString();

  const {
    items: instructions,
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
  } = usePaginatedList<ShipmentInstructionHeaderRecord>(
    `${baseUrl}${queryString ? `?${queryString}` : ""}`,
    { paginationEnabled, enabled },
  );

  const clearFilters = () => {
    setStatus("");
    setDateFrom("");
    setDateTo("");
    setCreatedBy("");
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
    users,
    clearFilters,
    baseUrl,
    csvDownloadUrl: `${baseUrl}/csv-download${queryString ? `?${queryString}` : ""}`,
    instructions,
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
