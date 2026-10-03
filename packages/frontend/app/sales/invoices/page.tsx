"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useEffect, useState } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { StatusPillTabs } from "../../_shared/ui/StatusPillTabs";
import { ListToolbar } from "../../_shared/ui/ListToolbar";
import { Button } from "../../_shared/ui/Button";
import { SavedSummaryModal } from "../../_shared/ui/SavedSummaryModal";
import { useSearchParams } from "next/navigation";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { usePermissionContext } from "../../context/permissioncontext";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { Pagination } from "../../_shared/ui/Pagination";
import { useSalesInvoices } from "./_hooks/useSalesInvoices";
import { useSalesInvoiceListActions } from "./_hooks/useSalesInvoiceListActions";
import { useSalesInvoiceSaveActions } from "./_hooks/useSalesInvoiceSaveActions";
import { SalesInvoiceSearchForm } from "./_components/SalesInvoiceSearchForm";
import { SalesInvoiceTable } from "./_components/SalesInvoiceTable";
import { SalesInvoiceForm } from "./_components/SalesInvoiceForm";
import { SalesInvoicePreview } from "./_components/SalesInvoicePreview";

export default function SalesInvoicesPage() {
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    isSalesInvoiceWfEnabled,
    departments: applicantDepartments = [],
    loading: permsLoading,
  } = usePagePermissions();

  const { user: currentUser } = usePermissionContext();

  const [applicantDepartmentSurrogateId, setApplicantDepartmentSurrogateId] =
    useState<string | null>(null);
  useEffect(() => {
    if (
      applicantDepartmentSurrogateId === null &&
      applicantDepartments.length > 0
    ) {
      setApplicantDepartmentSurrogateId(applicantDepartments[0].surrogateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicantDepartments]);

  const {
    invoices,
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
    departments,
    products,
    userMaster,
    units,
    taxCategories,
    accounts,
    projects,
    message,
    setMessage,
    error,
    setError,
    isSubmitting,
    setIsSubmitting,
    syncInvoices,
    handleImportCSV,
    handleExportCSV,
    handleDeleteInvoice,
    handleSubmitForApproval,
    isMailSending,
    handleBulkMailSend,
    handleSingleMailSend,
    fetchSpecialPrice,
  } = useSalesInvoices({ canRead, permsLoading });

  const {
    viewMode,
    setViewMode,
    filterStatus,
    setFilterStatus,
    selectedInvoiceIds,
    setSelectedInvoiceIds,
    previewInvoice,
    setPreviewInvoice,
    editingId,
    setEditingId,
    invoiceId,
    setInvoiceId,
    initialFormData,
    filters,
    setFilters,
    handleClearSearch,
    handleOpenNewForm,
    handleOpenEditForm,
    handleIssueRedSlip,
    redSlipSource,
    handleOpenPreview,
    handleCSVImportChange,
    handleGeneratePDF,
    handleSubmitForApprovalAction,
    handleDeleteAction,
    handleBulkMailSendAction,
  } = useSalesInvoiceListActions({
    canDelete,
    syncInvoices,
    handleImportCSV,
    handleDeleteInvoice,
    handleSubmitForApproval,
    handleBulkMailSend,
    setMessage,
    setError,
    applicantDepartmentSurrogateId,
  });

  const {
    savedInvoiceSummary,
    setSavedInvoiceSummary,
    handleFormSubmitAction,
    handleSubmitApprovedEditAction,
  } = useSalesInvoiceSaveActions({
    partners,
    editingId,
    setEditingId,
    setInvoiceId,
    setViewMode,
    filters,
    filterStatus,
    syncInvoices,
    setError,
    setMessage,
    setIsSubmitting,
    applicantDepartmentSurrogateId,
  });

  const urlSearchParams = useSearchParams();
  const urlEditId = urlSearchParams.get("editId");

  useEffect(() => {
    if (urlEditId) {
      void handleOpenEditForm(urlEditId);
      const url = new URL(window.location.href);
      url.searchParams.delete("editId");
      window.history.replaceState({}, "", url.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlEditId]);

  const guard = useDiscardGuard(`${viewMode}-${editingId}`);

  if (permsLoading) {
    return <LoadingGate />;
  }

  if (!canRead) {
    return <AccessDeniedInline />;
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="📈 売上管理"
        description="受注に基づく売上、または単独での売上計上の新規登録・修正、決裁・承認申請および返品/値引/赤伝の起票を行います。"
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
            {viewMode === "FORM" && (
              <button
                type="button"
                onClick={async () => {
                  if ((await guard.confirmDiscard())) setViewMode("LIST");
                }}
                className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm"
              >
                ↩ 一覧画面へ戻る
              </button>
            )}
          </>
        }
      />

      <MessageBanner message={message} error={error} />

      {viewMode === "LIST" ? (
        <div className="space-y-6">
          <SalesInvoiceSearchForm
            partners={partners}
            products={products}
            userMaster={userMaster}
            filters={filters}
            setFilters={setFilters}
            onClear={handleClearSearch}
          />

          <ListToolbar
            filters={
              <StatusPillTabs
                options={[
                  { value: "all", label: "🌐 すべて" },
                  { value: "DRAFT", label: "⚪ 下書き" },
                  { value: "PENDING_APPROVAL", label: "🟡 承認申請中" },
                  { value: "APPROVED", label: "🟢 承認済み" },
                  { value: "PENDING_DELETION", label: "🔴 削除申請中" },
                ]}
                value={filterStatus}
                onChange={setFilterStatus}
              />
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
                    document.getElementById("csv-import-hidden-input")?.click()
                  }
                  disabled={!canCreate || isSubmitting || isSalesInvoiceWfEnabled}
                  title={
                    isSalesInvoiceWfEnabled
                      ? "承認機能有効時はCSVインポートを利用できません"
                      : undefined
                  }
                  className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
                >
                  📤 CSVインポート
                </button>
                <input
                  id="csv-import-hidden-input"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  disabled={!canCreate || isSubmitting || isSalesInvoiceWfEnabled}
                  onChange={handleCSVImportChange}
                />
                <Button
                  size="sm"
                  onClick={handleBulkMailSendAction}
                  disabled={selectedInvoiceIds.length === 0 || isMailSending}
                >
                  {isMailSending
                    ? "SMTP送信中..."
                    : `選択した売上計上書を一括メール送信 (${selectedInvoiceIds.length}件) 🚀`}
                </Button>
                <button
                  type="button"
                  onClick={handleOpenNewForm}
                  disabled={!canCreate}
                  className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm ${canCreate ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-300 text-slate-500 cursor-not-allowed"}`}
                >
                  ➕ 売上を新規計上・申請する
                </button>
              </>
            }
          />

          <SalesInvoiceTable
            invoices={invoices}
            partners={partners}
            userMaster={userMaster}
            selectedInvoiceIds={selectedInvoiceIds}
            onSelectToggle={(id) =>
              setSelectedInvoiceIds((prev) =>
                prev.includes(id)
                  ? prev.filter((item) => item !== id)
                  : [...prev, id],
              )
            }
            onOpenEditForm={handleOpenEditForm}
            onIssueRedSlip={handleIssueRedSlip}
            canCreate={canCreate}
            onDeleteInvoice={handleDeleteAction}
            onOpenPreview={handleOpenPreview}
            canUpdate={canUpdate}
            canDelete={canDelete}
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
      ) : (
        <div className="contents" {...guard.scopeProps}>
          <SalesInvoiceForm
            editingId={editingId}
            invoiceId={invoiceId}
            partners={partners}
            products={products}
            userMaster={userMaster}
            units={units}
            taxCategories={taxCategories}
            accounts={accounts}
            projects={projects}
            onBackToList={() => setViewMode("LIST")}
            onSubmit={handleFormSubmitAction}
            isSubmitting={isSubmitting}
            isSalesInvoiceWfEnabled={isSalesInvoiceWfEnabled}
            onSubmitForApproval={handleSubmitForApprovalAction}
            onSubmitApprovedEdit={handleSubmitApprovedEditAction}
            onGeneratePDF={handleGeneratePDF}
            fetchSpecialPrice={fetchSpecialPrice}
            initialData={initialFormData}
            redSlipSource={redSlipSource}
            handleSingleMailSend={handleSingleMailSend}
            isMailSending={isMailSending}
            currentUserEmployeeNumber={currentUser?.employeeNumber}
            departments={departments}
            applicantDepartments={applicantDepartments}
            applicantDepartmentSurrogateId={applicantDepartmentSurrogateId}
            setApplicantDepartmentSurrogateId={
              setApplicantDepartmentSurrogateId
            }
          />
        </div>
      )}

      {savedInvoiceSummary && (
        <SavedSummaryModal
          title="売上データを保存しました"
          codeLabel="売上管理コード"
          partnerLabel="取引先名"
          summary={savedInvoiceSummary}
          previewLabel="👁️ 保存した売上をプレビューで確認"
          approveLabel={
            isSalesInvoiceWfEnabled
              ? "🚀 このまま承認を申請する"
              : "✅ このまま確定する"
          }
          onPreview={() => {
            const targetId = savedInvoiceSummary.id;
            setSavedInvoiceSummary(null);
            void handleOpenPreview(targetId);
          }}
          onApprove={() => {
            const targetId = savedInvoiceSummary.id;
            setSavedInvoiceSummary(null);
            void handleSubmitForApprovalAction(targetId);
          }}
          onContinue={() => setSavedInvoiceSummary(null)}
          onBackToList={() => {
            setSavedInvoiceSummary(null);
            setViewMode("LIST");
          }}
        />
      )}

      <SalesInvoicePreview
        previewInvoice={previewInvoice}
        onClose={() => setPreviewInvoice(null)}
      />
    </div>
  );
}
