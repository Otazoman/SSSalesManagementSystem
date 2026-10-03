"use client";

import { usePagePermissions } from "../../hooks/use-page-permission";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { StatusPillTabs } from "../../_shared/ui/StatusPillTabs";
import { ListToolbar } from "../../_shared/ui/ListToolbar";
import { useDeepLinkId } from "../../_shared/hooks/use-deep-link-id";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { Pagination } from "../../_shared/ui/Pagination";
import { usePayment } from "./_hooks/usePayment";
import { usePaymentActions } from "./_hooks/usePaymentActions";
import { PaymentSearchForm } from "./_components/PaymentSearchForm";
import { PaymentTable } from "./_components/PaymentTable";
import { CreatePaymentModal } from "./_components/CreatePaymentModal";
import { PaymentDetailModal } from "./_components/PaymentDetailModal";
import { FirmBankingExportModal } from "./_components/FirmBankingExportModal";

export default function PurchasePaymentPage() {
  const { canCreate, canRead, loading: permsLoading } = usePagePermissions();

  const {
    payments,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
    paginationEnabled,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    partners,
    message,
    setMessage,
    error,
    setError,
    isSubmitting,
    syncPayments,
    handleExportCSV,
    handleImportCSV,
  } = usePayment({ canRead, permsLoading });

  const {
    filterMode,
    setFilterMode,
    filterReconciliationStatus,
    setFilterReconciliationStatus,
    filters,
    setFilters,
    handleClearSearch,
    detail,
    handleOpenDetail,
    handleCloseDetail,
    isCreateModalOpen,
    createForm,
    candidateRecognitions,
    candidateItemReceipts,
    handleOpenCreateModal,
    handleCloseCreateModal,
    handleCreateFormPartnerChange,
    handleToggleCandidateRecognition,
    handleToggleCandidateItemReceipt,
    handleItemReceiptAmountChange,
    handleAddManualItem,
    handleRemoveManualItem,
    handleManualItemChange,
    setCreateForm,
    handleSubmitCreatePayment,
    handleRecordDisbursement,
    handleCSVImportChange,
    selectedPaymentIds,
    handleToggleSelectPayment,
    isFirmBankingModalOpen,
    firmBankingTransferDate,
    setFirmBankingTransferDate,
    firmBankingPreview,
    isFirmBankingLoading,
    handleOpenFirmBankingModal,
    handleCloseFirmBankingModal,
    handlePreviewFirmBanking,
    handleDownloadFirmBanking,
  } = usePaymentActions({
    syncPayments,
    handleImportCSV,
    setMessage,
    setError,
  });

  // 進捗確認など他画面からの`?openId=xxx`で該当の支払の詳細モーダルを開く
  useDeepLinkId(
    "openId",
    (id) => handleOpenDetail(id),
    !permsLoading && canRead,
  );

  if (permsLoading) {
    return <LoadingGate />;
  }

  if (!canRead) {
    return <AccessDeniedInline />;
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="💳 支払管理"
        description="承認済みの仕入を束ねて支払を確定し、支払消込を管理します。"
        actions={
          <>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={!canCreate}
              className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm disabled:bg-slate-100 disabled:text-slate-500 disabled:opacity-60"
            >
              📥 CSVダウンロード
            </button>
          </>
        }
      />

      <MessageBanner message={message} error={error} />

      <div className="space-y-6">
        <PaymentSearchForm
          partners={partners}
          filters={filters}
          setFilters={setFilters}
          onClear={handleClearSearch}
        />

        <ListToolbar
          filters={
            <div className="flex flex-wrap gap-1">
              <StatusPillTabs
                options={[
                  { value: "all", label: "🌐 すべて" },
                  { value: "PER_TRANSACTION", label: "都度支払" },
                  { value: "PERIODIC", label: "締め支払" },
                ]}
                value={filterMode}
                onChange={setFilterMode}
              />
              <StatusPillTabs
                options={[
                  { value: "all", label: "消込: すべて" },
                  { value: "UNRECONCILED", label: "未消込" },
                  { value: "PARTIALLY_RECONCILED", label: "一部消込" },
                  { value: "RECONCILED", label: "消込完了" },
                ]}
                value={filterReconciliationStatus}
                onChange={setFilterReconciliationStatus}
              />
            </div>
          }
          actions={
            <>
              <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
                該当件数:{" "}
                <span className="font-black text-indigo-600">{total}</span> 件
              </span>
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById("payment-csv-import-hidden-input")
                    ?.click()
                }
                disabled={!canCreate || isSubmitting}
                className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
              >
                📤 CSVインポート
              </button>
              <input
                id="payment-csv-import-hidden-input"
                type="file"
                accept=".csv"
                className="hidden"
                disabled={!canCreate || isSubmitting}
                onChange={handleCSVImportChange}
              />
              <button
                type="button"
                onClick={handleOpenFirmBankingModal}
                disabled={!canCreate || selectedPaymentIds.length === 0}
                className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                🏦 振込データ作成 ({selectedPaymentIds.length}件)
              </button>
              <button
                type="button"
                onClick={handleOpenCreateModal}
                disabled={!canCreate}
                className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm ${canCreate ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-300 text-slate-500 cursor-not-allowed"}`}
              >
                ➕ 支払を新規登録する
              </button>
            </>
          }
        />

        <PaymentTable
          payments={payments}
          partners={partners}
          onOpenDetail={handleOpenDetail}
          sortBy={sortBy}
          sortDirection={sortDirection}
          sortKeys={sortKeys}
          onSortChange={setSort}
          selectedPaymentIds={selectedPaymentIds}
          onToggleSelectPayment={handleToggleSelectPayment}
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

      <CreatePaymentModal
        isOpen={isCreateModalOpen}
        partners={partners}
        createForm={createForm}
        setCreateForm={setCreateForm}
        candidateRecognitions={candidateRecognitions}
        candidateItemReceipts={candidateItemReceipts}
        onPartnerChange={handleCreateFormPartnerChange}
        onToggleRecognition={handleToggleCandidateRecognition}
        onToggleItemReceipt={handleToggleCandidateItemReceipt}
        onItemReceiptAmountChange={handleItemReceiptAmountChange}
        onAddManualItem={handleAddManualItem}
        onRemoveManualItem={handleRemoveManualItem}
        onManualItemChange={handleManualItemChange}
        onClose={handleCloseCreateModal}
        onSubmit={handleSubmitCreatePayment}
      />

      <PaymentDetailModal
        detail={detail}
        onClose={handleCloseDetail}
        onRecordDisbursement={handleRecordDisbursement}
      />

      <FirmBankingExportModal
        isOpen={isFirmBankingModalOpen}
        selectedCount={selectedPaymentIds.length}
        transferDate={firmBankingTransferDate}
        setTransferDate={setFirmBankingTransferDate}
        preview={firmBankingPreview}
        isLoading={isFirmBankingLoading}
        onPreview={handlePreviewFirmBanking}
        onDownload={handleDownloadFirmBanking}
        onClose={handleCloseFirmBankingModal}
      />
    </div>
  );
}
