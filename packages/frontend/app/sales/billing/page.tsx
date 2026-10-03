"use client";

import { usePagePermissions } from "../../hooks/use-page-permission";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { StatusPillTabs } from "../../_shared/ui/StatusPillTabs";
import { ListToolbar } from "../../_shared/ui/ListToolbar";
import { Button } from "../../_shared/ui/Button";
import { useState } from "react";
import { useDeepLinkId } from "../../_shared/hooks/use-deep-link-id";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { Pagination } from "../../_shared/ui/Pagination";
import { useBilling } from "./_hooks/useBilling";
import { useBillingActions } from "./_hooks/useBillingActions";
import { BillingSearchForm } from "./_components/BillingSearchForm";
import { BillingTable } from "./_components/BillingTable";
import { CreateBillingModal } from "./_components/CreateBillingModal";
import { BillingDetailModal } from "./_components/BillingDetailModal";
import { CashReceiptsPanel } from "./_components/CashReceiptsPanel";

export default function SalesBillingPage() {
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    loading: permsLoading,
  } = usePagePermissions();
  // 請求一覧 / 入金(単体入金)。入金管理は請求管理の中の機能(専用メニューは持たない)
  const [tab, setTab] = useState<"billing" | "receipts">("billing");

  const {
    billings,
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
    taxCategories,
    message,
    setMessage,
    error,
    setError,
    isSubmitting,
    syncBillings,
    handleExportCSV,
    handleImportCSV,
  } = useBilling({ canRead, permsLoading });

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
    candidateInvoices,
    handleOpenCreateModal,
    handleCloseCreateModal,
    handleCreateFormPartnerChange,
    handleToggleCandidateInvoice,
    handleAddManualItem,
    handleRemoveManualItem,
    handleManualItemChange,
    setCreateForm,
    handleSubmitCreateBilling,
    handleGeneratePDF,
    handleRecordPaymentReceipt,
    handleCSVImportChange,
    handlePaymentReceiptsCSVImportChange,
    showMailModal,
    setShowMailModal,
    recipientEmail,
    setRecipientEmail,
    partnerContacts,
    selectedContactId,
    handleContactSelect,
    isMailSending,
    isEmailRestrictedToContacts,
    handleSendEmail,
    handleQuickSendEmail,
    selectedBillingIds,
    handleToggleSelectBilling,
    handleBulkMailSendAction,
  } = useBillingActions({
    syncBillings,
    handleImportCSV,
    setMessage,
    setError,
  });

  // 進捗確認など他画面からの`?openId=xxx`で該当の請求の詳細モーダルを開く
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
        title="🧮 請求管理"
        description="承認済みの売上を束ねて請求書を発行し、入金消込を管理します。請求書を介さない入金(単体入金)は「入金(単体入金)」タブで登録し、請求へ紐づけて消込できます。"
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

      <div className="flex gap-2 border-b border-slate-200">
        {(
          [
            { key: "billing", label: "🧮 請求一覧" },
            { key: "receipts", label: "💰 入金(単体入金)" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`text-sm px-4 py-2 font-bold cursor-pointer border-b-2 -mb-px ${
              tab === t.key
                ? "border-indigo-600 text-indigo-800"
                : "border-transparent text-slate-800 hover:text-indigo-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "receipts" && (
        <CashReceiptsPanel
          canCreate={canCreate}
          canUpdate={canUpdate}
          canDelete={canDelete}
        />
      )}

      <MessageBanner message={message} error={error} />

      {tab === "billing" && (
        <div className="space-y-6">
          <BillingSearchForm
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
                    { value: "PER_TRANSACTION", label: "都度請求" },
                    { value: "PERIODIC", label: "締め請求" },
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
                      .getElementById("billing-csv-import-hidden-input")
                      ?.click()
                  }
                  disabled={!canCreate || isSubmitting}
                  className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
                >
                  📤 CSVインポート
                </button>
                <input
                  id="billing-csv-import-hidden-input"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  disabled={!canCreate || isSubmitting}
                  onChange={handleCSVImportChange}
                />
                {/* BUG-060: 入金消込(入金の記録)のCSV取込 */}
                <button
                  type="button"
                  onClick={() =>
                    document
                      .getElementById("billing-payment-receipts-csv-import-hidden-input")
                      ?.click()
                  }
                  disabled={!canCreate || isSubmitting}
                  title="列: billingHeaderId,receivedDate,amount,method,memo"
                  className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
                >
                  📤 入金消込CSVインポート
                </button>
                <input
                  id="billing-payment-receipts-csv-import-hidden-input"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  disabled={!canCreate || isSubmitting}
                  onChange={handlePaymentReceiptsCSVImportChange}
                />
                <Button
                  size="sm"
                  onClick={handleBulkMailSendAction}
                  disabled={selectedBillingIds.length === 0 || isMailSending}
                >
                  {isMailSending
                    ? "SMTP送信中..."
                    : `選択した請求書を一括メール送信 (${selectedBillingIds.length}件) 🚀`}
                </Button>
                <button
                  type="button"
                  onClick={handleOpenCreateModal}
                  disabled={!canCreate}
                  className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm ${canCreate ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-300 text-slate-500 cursor-not-allowed"}`}
                >
                  ➕ 請求を新規登録する
                </button>
              </>
            }
          />

          <BillingTable
            billings={billings}
            partners={partners}
            onOpenDetail={handleOpenDetail}
            sortBy={sortBy}
            sortDirection={sortDirection}
            sortKeys={sortKeys}
            onSortChange={setSort}
            selectedBillingIds={selectedBillingIds}
            onSelectToggle={handleToggleSelectBilling}
            onSendEmail={handleQuickSendEmail}
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
      )}

      <CreateBillingModal
        isOpen={isCreateModalOpen}
        partners={partners}
        taxCategories={taxCategories}
        createForm={createForm}
        setCreateForm={setCreateForm}
        candidateInvoices={candidateInvoices}
        onPartnerChange={handleCreateFormPartnerChange}
        onToggleInvoice={handleToggleCandidateInvoice}
        onAddManualItem={handleAddManualItem}
        onRemoveManualItem={handleRemoveManualItem}
        onManualItemChange={handleManualItemChange}
        onClose={handleCloseCreateModal}
        onSubmit={handleSubmitCreateBilling}
      />

      <BillingDetailModal
        detail={detail}
        onClose={handleCloseDetail}
        onGeneratePDF={handleGeneratePDF}
        onRecordPaymentReceipt={handleRecordPaymentReceipt}
        showMailModal={showMailModal}
        setShowMailModal={setShowMailModal}
        recipientEmail={recipientEmail}
        setRecipientEmail={setRecipientEmail}
        partnerContacts={partnerContacts}
        selectedContactId={selectedContactId}
        restrictToRegisteredContacts={isEmailRestrictedToContacts}
        onContactSelect={handleContactSelect}
        onSendEmail={handleSendEmail}
        isMailSending={isMailSending}
      />
    </div>
  );
}
