"use client";

import { useAuditLogs } from "./_hooks/useAuditLogs";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { FilterForm } from "./_components/FilterForm";
import { ResultSummary } from "./_components/ResultSummary";
import { LogTable } from "./_components/LogTable";
import { Pagination } from "../../_shared/ui/Pagination";

export default function AuditLogsSearchPage() {
  const {
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
  } = useAuditLogs();

  return (
    <div className="w-full space-y-6">
      {/* 画面ヘッダー */}
      <PageHeader
        title="🛡️ 操作ログ"
        description="隔離データベースより全ユーザーの操作証跡をリアルタイム追跡します。マスタ結合により画面名を分かりやすく表示します。"
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
      <FilterForm
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        userId={userId}
        setUserId={setUserId}
        action={action}
        setAction={setAction}
        resourceKey={resourceKey}
        setResourceKey={setResourceKey}
        resourceOptions={resourceOptions}
        loading={loading}
        onSubmit={handleSearch}
        onClear={handleClearFields}
      />

      {/* サブバー (該当件数表示) */}
      <ResultSummary count={total} />

      {/* 📋 データ一覧テーブル */}
      <LogTable
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
