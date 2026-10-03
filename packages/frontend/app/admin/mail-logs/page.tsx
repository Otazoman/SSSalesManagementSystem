"use client";

import { useMailLogSearch } from "./_hooks/useMailLogSearch";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { MailLogSearchForm } from "./_components/MailLogSearchForm";
import { MailLogTable } from "./_components/MailLogTable";
import { Pagination } from "../../_shared/ui/Pagination";

export default function MailDeliveryLogsSearchPage() {
  const {
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
  } = useMailLogSearch();

  return (
    <div className="w-full space-y-6">
      {/* 画面ヘッダー */}
      <PageHeader
        title="🛡️ メール送信履歴ログ"
        description="独立ログデータベースよりシステムから外部へ配信された全リレーメールの到達状態、およびエラーログをリアルタイム追跡します。"
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
      <MailLogSearchForm
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        documentId={documentId}
        setDocumentId={setDocumentId}
        keyword={keyword}
        setKeyword={setKeyword}
        status={status}
        setStatus={setStatus}
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
      <MailLogTable
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
