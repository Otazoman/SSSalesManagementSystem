import { useState, useEffect } from "react";
import { OtpDownloadLogRecord, PartnerLookup, WarehouseLookup } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";

interface OtpLogSearchBody {
  startDate: string;
  endDate: string;
  email: string;
  partnerId: string;
  subject: string;
  documentType: string;
  warehouseId: string;
}

export function useOtpLogSearch() {
  const { paginationEnabled } = usePaginationSetting();

  // 検索条件フォームState
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [email, setEmail] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [subject, setSubject] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [warehouseId, setWarehouseId] = useState("");

  // 💡 取引先・倉庫はリストボックス選択式にするため、各マスタから一覧を取得する
  // (過去のOTPログが停止/廃止済みの取引先・倉庫を参照している場合にも検索できるよう全件取得)
  const [partners, setPartners] = useState<PartnerLookup[]>([]);
  useEffect(() => {
    apiFetch<PartnerLookup[]>("/api/partners?status=all")
      .then(setPartners)
      .catch((err) => {
        console.error("取引先マスタの取得に失敗しました", err);
      });
  }, []);

  const [warehouses, setWarehouses] = useState<WarehouseLookup[]>([]);
  useEffect(() => {
    apiFetch<WarehouseLookup[]>("/api/warehouses?status=all")
      .then(setWarehouses)
      .catch((err) => {
        console.error("倉庫マスタの取得に失敗しました", err);
      });
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
  } = usePaginatedList<OtpDownloadLogRecord, OtpLogSearchBody>(
    "/api/otp-logs/search",
    {
      paginationEnabled,
      method: "POST",
      autoFetch: false, // 画面を開いた直後には検索しない（明示的な検索ボタン押下時のみ）
      body: { startDate, endDate, email, partnerId, subject, documentType, warehouseId },
    },
  );

  const handleSearch = (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault();
    void refetch();
  };

  const handleClearFields = () => {
    setStartDate("");
    setEndDate("");
    setEmail("");
    setPartnerId("");
    setSubject("");
    setDocumentType("");
    setWarehouseId("");
    reset();
  };

  const { download: downloadCsv, downloading: csvDownloading } = useCsvDownload({
    fileNamePrefix: "otp_download_log",
  });
  const handleDownloadCsvFile = async () => {
    // 0件の時は画面のボタンが押せない(BUG-037: 念のための確認のため、alert は出さない)
    if (total === 0) return;
    const params = new URLSearchParams({
      startDate,
      endDate,
      email,
      partnerId,
      subject,
      documentType,
      warehouseId,
    });
    await downloadCsv(`/api/otp-logs/csv-download?${params.toString()}`);
  };

  return {
    logs,
    loading,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    email,
    setEmail,
    partnerId,
    setPartnerId,
    partners,
    subject,
    setSubject,
    documentType,
    setDocumentType,
    warehouseId,
    setWarehouseId,
    warehouses,
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
