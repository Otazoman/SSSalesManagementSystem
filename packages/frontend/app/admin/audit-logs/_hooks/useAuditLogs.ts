import { useState, useEffect } from "react";
import { AuditLogRecord, ResourceOption } from "../_types/index";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";

interface AuditLogSearchBody {
  startDate: string;
  endDate: string;
  userId: string;
  resourceKey: string;
  action: string;
}

export function useAuditLogs() {
  const { paginationEnabled } = usePaginationSetting();

  const [resourceOptions, setResourceOptions] = useState<ResourceOption[]>([]);

  // 検索条件 State
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [resourceKey, setResourceKey] = useState("");

  // アプリケーション画面マスタの取得
  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const data = await apiFetch<ResourceOption[]>("/api/audit-logs/resources");
        setResourceOptions([
          { key: "", label: "すべてのアプリケーション画面" },
          ...data,
        ]);
      } catch (err) {
        console.error("マスタ選択肢の取得に失敗:", err);
      }
    };
    void fetchOptions();
  }, []);

  const {
    items: logs,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    loading,
    refetch,
    reset,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<AuditLogRecord, AuditLogSearchBody>(
    "/api/audit-logs/search",
    {
      paginationEnabled,
      method: "POST",
      autoFetch: false, // 画面を開いた直後には検索しない（明示的な検索ボタン押下時のみ）
      body: { startDate, endDate, userId, resourceKey, action },
    },
  );

  // 検索API実行（検索ボタン押下時のみ）
  const handleSearch = (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault();
    void refetch();
  };

  // 条件クリア
  const handleClearFields = () => {
    setStartDate("");
    setEndDate("");
    setUserId("");
    setAction("");
    setResourceKey("");
    reset();
  };

  // CSVダウンロード(検索条件に一致する全件をBackendから直接取得。ページ制限の影響を受けない)
  const { download: downloadCsv, downloading: csvDownloading } = useCsvDownload({
    fileNamePrefix: "audit_log",
  });
  const handleDownloadCsvFile = async () => {
    // 0件の時は画面のボタンが押せない(BUG-037: 念のための確認のため、alert は出さない)
    if (total === 0) return;
    const params = new URLSearchParams({
      startDate,
      endDate,
      userId,
      resourceKey,
      action,
    });
    await downloadCsv(`/api/audit-logs/csv-download?${params.toString()}`);
  };

  return {
    logs,
    resourceOptions,
    loading,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    userId,
    setUserId,
    action,
    setAction,
    resourceKey,
    setResourceKey,
    handleSearch,
    handleClearFields,
    handleDownloadCsvFile,
    csvDownloading,
    paginationEnabled,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  };
}
