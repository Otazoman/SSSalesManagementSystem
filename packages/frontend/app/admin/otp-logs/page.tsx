"use client";

import { usePagePermissions } from "../../hooks/use-page-permission";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { useOtpLogSearch } from "./_hooks/useOtpLogSearch";
import { OtpLogSearchForm } from "./_components/OtpLogSearchForm";
import { OtpLogTable } from "./_components/OtpLogTable";
import { Pagination } from "../../_shared/ui/Pagination";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";

export default function OtpDownloadLogsSearchPage() {
  const { canRead, loading: permsLoading } = usePagePermissions();

  const {
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
  } = useOtpLogSearch();

  if (permsLoading) {
    return <LoadingGate />;
  }

  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🔒 この画面を閲覧する権限がありません"
        description="管理者にお問い合わせください。"
      />
    );
  }

  return (
    <div className="w-full space-y-6">
      {/* 画面ヘッダー */}
      <PageHeader
        title="🔐 OTPダウンロードログ"
        description="各帳票(見積書・注文請書・納品書・発注書・検収書・出荷指示書・入荷指示書など)のOTPダウンロードの発行・確認履歴を独立DBから検索し、実際にダウンロードが確認されたかを追跡します。"
        actions={
          <>
            <button
              onClick={handleDownloadCsvFile}
              disabled={total === 0 || loading || csvDownloading}
              className={`text-xs border px-3 py-1.5 rounded font-bold text-white transition-colors shadow-sm ${
                total > 0 && !loading && !csvDownloading
                  ? "bg-emerald-600 hover:bg-emerald-700 cursor-pointer"
                  : "bg-slate-300 text-slate-500 border-slate-300 cursor-not-allowed"
              }`}
            >
              📥 CSVダウンロード
            </button>
          </>
        }
      />

      {/* 🔍 検索パネル */}
      <OtpLogSearchForm
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        email={email}
        setEmail={setEmail}
        partnerId={partnerId}
        setPartnerId={setPartnerId}
        partners={partners}
        subject={subject}
        setSubject={setSubject}
        documentType={documentType}
        setDocumentType={setDocumentType}
        warehouseId={warehouseId}
        setWarehouseId={setWarehouseId}
        warehouses={warehouses}
        loading={loading}
        onSubmit={handleSearch}
        onClear={handleClearFields}
      />

      {/* サブバー (該当件数表示) */}
      <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
        <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
          📊 該当件数:{" "}
          <span className="text-sm font-black text-indigo-600 font-mono">
            {total}
          </span>{" "}
          件
        </span>
      </div>

      {/* 📋 検索結果テーブル */}
      <OtpLogTable
        logs={logs}
        sortBy={sortBy}
        sortDirection={sortDirection}
        sortKeys={sortKeys}
        onSortChange={setSort}
      />

      <Pagination
        paginationEnabled={paginationEnabled}
        page={page}
        totalPages={totalPages}
        total={total}
        limit={limit}
        onPageChange={setPage}
        onLimitChange={setLimit}
      />
    </div>
  );
}
