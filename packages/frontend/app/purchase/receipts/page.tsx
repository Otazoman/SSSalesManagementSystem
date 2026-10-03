"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useEffect, useState } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { StatusPillTabs } from "../../_shared/ui/StatusPillTabs";
import { ListToolbar } from "../../_shared/ui/ListToolbar";
import { SavedSummaryModal } from "../../_shared/ui/SavedSummaryModal";
import { useSearchParams } from "next/navigation";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { usePermissionContext } from "../../context/permissioncontext";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { Pagination } from "../../_shared/ui/Pagination";
import { usePurchaseRecognitions } from "./_hooks/usePurchaseRecognitions";
import { usePurchaseRecognitionListActions } from "./_hooks/usePurchaseRecognitionListActions";
import { usePurchaseRecognitionSaveActions } from "./_hooks/usePurchaseRecognitionSaveActions";
import { PurchaseRecognitionSearchForm } from "./_components/PurchaseRecognitionSearchForm";
import { PurchaseRecognitionTable } from "./_components/PurchaseRecognitionTable";
import { PurchaseRecognitionForm } from "./_components/PurchaseRecognitionForm";
import { PurchaseRecognitionPreview } from "./_components/PurchaseRecognitionPreview";

// Item10: sales/invoices/page.tsxと完全に対称な構成(売上の購買側)。仕入管理
// (screens.ts上の既存プレースホルダー resource="purchase_receipts", path="/purchase/receipts")の
// 実装画面としてこのパスに配置する
export default function PurchaseRecognitionsPage() {
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    isPurchaseRecognitionWfEnabled,
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
    recognitions,
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
    syncRecognitions,
    handleImportCSV,
    handleExportCSV,
    handleDeleteRecognition,
    handleSubmitForApproval,
  } = usePurchaseRecognitions({ canRead, permsLoading });

  const {
    viewMode,
    setViewMode,
    filterStatus,
    setFilterStatus,
    previewRecognition,
    setPreviewRecognition,
    editingId,
    setEditingId,
    recognitionId,
    setRecognitionId,
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
  } = usePurchaseRecognitionListActions({
    canDelete,
    syncRecognitions,
    handleImportCSV,
    handleDeleteRecognition,
    handleSubmitForApproval,
    setMessage,
    setError,
    applicantDepartmentSurrogateId,
  });

  const {
    savedRecognitionSummary,
    setSavedRecognitionSummary,
    handleFormSubmitAction,
    handleSubmitApprovedEditAction,
  } = usePurchaseRecognitionSaveActions({
    partners,
    editingId,
    setEditingId,
    setRecognitionId,
    setViewMode,
    filters,
    filterStatus,
    syncRecognitions,
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
        title="📦 仕入管理"
        description="発注に基づく仕入、または単独での仕入計上の新規登録・修正、決裁・承認申請および返品/値引/赤伝の起票を行います。"
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
          <PurchaseRecognitionSearchForm
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
                  disabled={
                    !canCreate || isSubmitting || isPurchaseRecognitionWfEnabled
                  }
                  title={
                    isPurchaseRecognitionWfEnabled
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
                  disabled={
                    !canCreate || isSubmitting || isPurchaseRecognitionWfEnabled
                  }
                  onChange={handleCSVImportChange}
                />
                <button
                  type="button"
                  onClick={handleOpenNewForm}
                  disabled={!canCreate}
                  className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm ${canCreate ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-300 text-slate-500 cursor-not-allowed"}`}
                >
                  ➕ 仕入を新規計上・申請する
                </button>
              </>
            }
          />

          <PurchaseRecognitionTable
            recognitions={recognitions}
            partners={partners}
            userMaster={userMaster}
            onOpenEditForm={handleOpenEditForm}
            onIssueRedSlip={handleIssueRedSlip}
            canCreate={canCreate}
            onDeleteRecognition={handleDeleteAction}
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
          <PurchaseRecognitionForm
            editingId={editingId}
            recognitionId={recognitionId}
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
            isPurchaseRecognitionWfEnabled={isPurchaseRecognitionWfEnabled}
            onSubmitForApproval={handleSubmitForApprovalAction}
            onSubmitApprovedEdit={handleSubmitApprovedEditAction}
            onGeneratePDF={handleGeneratePDF}
            initialData={initialFormData}
            redSlipSource={redSlipSource}
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

      {savedRecognitionSummary && (
        <SavedSummaryModal
          title="仕入データを保存しました"
          codeLabel="仕入管理コード"
          partnerLabel="仕入先名"
          summary={savedRecognitionSummary}
          previewLabel="👁️ 保存した仕入をプレビューで確認"
          approveLabel={
            isPurchaseRecognitionWfEnabled
              ? "🚀 このまま承認を申請する"
              : "✅ このまま確定する"
          }
          onPreview={() => {
            const targetId = savedRecognitionSummary.id;
            setSavedRecognitionSummary(null);
            void handleOpenPreview(targetId);
          }}
          onApprove={() => {
            const targetId = savedRecognitionSummary.id;
            setSavedRecognitionSummary(null);
            void handleSubmitForApprovalAction(targetId);
          }}
          onContinue={() => setSavedRecognitionSummary(null)}
          onBackToList={() => {
            setSavedRecognitionSummary(null);
            setViewMode("LIST");
          }}
        />
      )}

      <PurchaseRecognitionPreview
        previewRecognition={previewRecognition}
        onClose={() => setPreviewRecognition(null)}
      />
    </div>
  );
}
