// app/admin/mail-logs/_hooks/useMailLogSearch.ts
import { MailDeliveryLogRecord } from "../_types";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import { useState } from "react";

interface MailLogSearchBody {
  startDate: string;
  endDate: string;
  documentId: string;
  keyword: string;
  status: string;
}

export function useMailLogSearch() {
  const { paginationEnabled } = usePaginationSetting();

  // 検索条件フォームState
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");

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
  } = usePaginatedList<MailDeliveryLogRecord, MailLogSearchBody>(
    "/api/mail-logs/search",
    {
      paginationEnabled,
      method: "POST",
      autoFetch: false, // 画面を開いた直後には検索しない（明示的な検索ボタン押下時のみ）
      body: { startDate, endDate, documentId, keyword, status },
    },
  );

  // 検索API実行関数
  const handleSearch = (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault();
    void refetch();
  };

  // 検索条件クリア関数
  const handleClearFields = () => {
    setStartDate("");
    setEndDate("");
    setDocumentId("");
    setKeyword("");
    setStatus("");
    reset();
  };

  // 配信確認用CSVファイルダウンロード機能(検索条件に一致する全件をBackendから直接取得)
  const { download: downloadCsv, downloading: csvDownloading } = useCsvDownload({
    fileNamePrefix: "mail_delivery_log",
  });
  const handleDownloadCsvFile = async () => {
    // 0件の時は画面のボタンが押せない(BUG-037: 念のための確認のため、alert は出さない)
    if (total === 0) return;
    const params = new URLSearchParams({
      startDate,
      endDate,
      documentId,
      keyword,
      status,
    });
    await downloadCsv(`/api/mail-logs/csv-download?${params.toString()}`);
  };

  return {
    logs,
    loading,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    documentId,
    setDocumentId,
    keyword,
    setKeyword,
    status,
    setStatus,
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
