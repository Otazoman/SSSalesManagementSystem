import { useState, useEffect, useCallback } from "react";
import { DepartmentRecord, FilterStatus } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";

interface UseDepartmentSyncProps {
  filterStatus: FilterStatus;
  targetDate: string;
  canRead: boolean;
  loadingPermissions: boolean;
}

export function useDepartmentSync({
  filterStatus,
  targetDate,
  canRead,
  loadingPermissions,
}: UseDepartmentSyncProps) {
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);

  const syncMasterData = useCallback(async () => {
    if (loadingPermissions || !canRead) return;

    try {
      // 💡 targetDate が空文字（クリア時）の場合は、本日の日付（sv-SE形式: YYYY-MM-DD）を補完する
      const effectiveDate = targetDate.trim()
        ? targetDate
        : new Date().toLocaleDateString("sv-SE");

      const params = new URLSearchParams({
        status: filterStatus,
        targetDate: `${effectiveDate}T00:00:00.000Z`,
      });

      const data = await apiFetch<DepartmentRecord[]>(
        `/api/departments?${params.toString()}`,
      );
      setDepartments(data);
    } catch (err) {
      console.error("部署マスタ同期エラー:", err);
      setDepartments([]);
    }
  }, [filterStatus, targetDate, canRead, loadingPermissions]);

  useEffect(() => {
    if (loadingPermissions) return;
    void syncMasterData();
  }, [syncMasterData]);

  return {
    departments,
    syncMasterData,
  };
}
