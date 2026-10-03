"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useEffect, useState } from "react";
import { SavedSummaryModal } from "../../_shared/ui/SavedSummaryModal";
import { useSearchParams } from "next/navigation";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { usePermissionContext } from "../../context/permissioncontext";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { Pagination } from "../../_shared/ui/Pagination";
import { Button } from "../../_shared/ui/Button";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { ListToolbar } from "../../_shared/ui/ListToolbar";
import { StatusPillTabs } from "../../_shared/ui/StatusPillTabs";
import { useQuotes } from "./_hooks/useQuotes";
import { useQuoteListActions } from "./_hooks/useQuoteListActions";
import { useQuoteSaveActions } from "./_hooks/useQuoteSaveActions";
import { QuoteSearchForm } from "./_components/QuoteSearchForm";
import { QuoteTable } from "./_components/QuoteTable";
import { QuoteForm } from "./_components/QuoteForm";
import { QuotePreview } from "./_components/QuotePreview";

const STATUS_OPTIONS = [
  { value: "all", label: "🌐 すべて" },
  { value: "DRAFT", label: "⚪ 下書き" },
  { value: "PENDING_APPROVAL", label: "🟡 承認申請中" },
  { value: "APPROVED", label: "🟢 承認済み" },
  { value: "PENDING_DELETION", label: "🔴 削除申請中" },
];

export default function QuotesPage() {
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    isQuoteWfEnabled,
    // 追加要望F: 申請部門選択用。useQuotes()側の`departments`(自社部門マスタ、見積の
    // 「貴社担当部門」欄向け)と名前が衝突するためエイリアスする。
    departments: applicantDepartments = [],
    loading: permsLoading,
  } = usePagePermissions();

  const { user: currentUser } = usePermissionContext();

  // 追加要望F: 複数部門所属時の申請部門選択(初期値は所属部門の先頭=従来の暗黙動作と同じ)。
  // applicantDepartmentsはusePagePermissions()から非同期に取得されるため、useState初期値
  // だけでは反映されない場合がある。ロード完了後にuseEffectで未選択(null)の場合のみ
  // 先頭部門を補完する(ユーザーが既に選択した値は上書きしない)。
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
    quotes,
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
    projects,
    message,
    setMessage,
    error,
    setError,
    isSubmitting,
    setIsSubmitting,
    isMailSending,
    syncQuotes,
    handleImportCSV,
    handleExportCSV,
    handleDeleteQuote,
    handleSubmitForApproval,
    handleSingleMailSend,
    handleBulkMailSend,
    fetchSpecialPrice,
  } = useQuotes({ canRead, permsLoading });

  const {
    viewMode,
    setViewMode,
    filterStatus,
    setFilterStatus,
    selectedQuoteIds,
    setSelectedQuoteIds,
    previewQuote,
    setPreviewQuote,
    editingId,
    setEditingId,
    quoteId,
    setQuoteId,
    initialFormData,
    filters,
    setFilters,
    handleClearSearch,
    handleOpenNewForm,
    handleOpenEditForm,
    handleOpenPreview,
    handleCSVImportChange,
    handleGeneratePDF,
    handleSubmitForApprovalAction,
    handleDeleteAction,
    handleBulkMailSendAction,
    getSiblingVersions,
  } = useQuoteListActions({
    quotes,
    canDelete,
    syncQuotes,
    handleImportCSV,
    handleDeleteQuote,
    handleSubmitForApproval,
    handleBulkMailSend,
    setMessage,
    setError,
    applicantDepartmentSurrogateId,
  });

  const {
    savedQuoteSummary,
    setSavedQuoteSummary,
    handleFormSubmitAction,
    handleSubmitApprovedEditAction,
  } = useQuoteSaveActions({
    partners,
    editingId,
    setEditingId,
    setQuoteId,
    setViewMode,
    filters,
    filterStatus,
    syncQuotes,
    setError,
    setMessage,
    setIsSubmitting,
    applicantDepartmentSurrogateId,
  });

  // 💡 差戻し履歴画面の「修正して再提出」からの遷移(?editId=xxx)を受けて自動的に編集フォームを開く
  // (masterのeditId自動オープンと同じ意図だが、見積はviewMode(LIST/FORM)による
  // ローカル状態制御でURLパラメータを見ていなかったため、handleOpenEditFormを直接呼ぶ形で対応)
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
        title="📄 見積管理"
        description="営業見積データの新規登録・修正、決裁・承認申請および関連する証跡ファイルの管理を行います。"
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportCSV}
              disabled={!canCreate}
            >
              📥 CSVダウンロード
            </Button>
            {viewMode === "FORM" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  if ((await guard.confirmDiscard())) setViewMode("LIST");
                }}
              >
                ↩ 一覧画面へ戻る
              </Button>
            )}
          </>
        }
      />

      <MessageBanner message={message} error={error} />

      {viewMode === "LIST" ? (
        <div className="space-y-6">
          <QuoteSearchForm
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
                options={STATUS_OPTIONS}
                value={filterStatus}
                onChange={setFilterStatus}
              />
            }
            actions={
              <>
                <span className="text-xs font-bold text-slate-700 bg-slate-200/60 px-2.5 py-1 rounded-full">
                  該当件数:{" "}
                  <span className="font-black text-indigo-700">{total}</span> 件
                  (版を含む)
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    document.getElementById("csv-import-hidden-input")?.click()
                  }
                  disabled={!canCreate || isSubmitting || isQuoteWfEnabled}
                  title={
                    isQuoteWfEnabled
                      ? "承認機能有効時はCSVインポートを利用できません"
                      : undefined
                  }
                >
                  📤 CSVインポート
                </Button>
                <input
                  id="csv-import-hidden-input"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  disabled={!canCreate || isSubmitting || isQuoteWfEnabled}
                  onChange={handleCSVImportChange}
                />
                <Button
                  size="sm"
                  onClick={handleBulkMailSendAction}
                  disabled={selectedQuoteIds.length === 0 || isMailSending}
                >
                  {isMailSending
                    ? "SMTP送信中..."
                    : `選択したデータをメール一括送信 (${selectedQuoteIds.length}件) 🚀`}
                </Button>
                <Button
                  size="sm"
                  onClick={handleOpenNewForm}
                  disabled={!canCreate}
                >
                  ➕ 見積を新規登録・申請する
                </Button>
              </>
            }
          />

          <QuoteTable
            quotes={quotes}
            partners={partners}
            userMaster={userMaster}
            selectedQuoteIds={selectedQuoteIds}
            onSelectToggle={(id) =>
              setSelectedQuoteIds((prev) =>
                prev.includes(id)
                  ? prev.filter((item) => item !== id)
                  : [...prev, id],
              )
            }
            onOpenEditForm={handleOpenEditForm}
            onDeleteQuote={handleDeleteAction}
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
          <QuoteForm
            editingId={editingId}
            quoteId={quoteId}
            partners={partners}
            products={products}
            userMaster={userMaster}
            units={units}
            taxCategories={taxCategories}
            projects={projects}
            onBackToList={() => setViewMode("LIST")}
            onSubmit={handleFormSubmitAction}
            isSubmitting={isSubmitting}
            isQuoteWfEnabled={isQuoteWfEnabled}
            onSubmitForApproval={handleSubmitForApprovalAction}
            onSubmitApprovedEdit={handleSubmitApprovedEditAction}
            onGeneratePDF={handleGeneratePDF}
            fetchSpecialPrice={fetchSpecialPrice}
            initialData={initialFormData}
            getSiblingVersions={getSiblingVersions}
            onOpenEditForm={handleOpenEditForm}
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

      {/* 💡 保存完了時のワンクッション確認モーダル */}
      {savedQuoteSummary && (
        <SavedSummaryModal
          title={
            savedQuoteSummary.isRevisionUp
              ? "新バージョンとして改定保存しました"
              : "見積データを保存しました"
          }
          codeLabel="見積管理コード"
          partnerLabel="得意先名"
          summary={{
            id: savedQuoteSummary.id,
            title: savedQuoteSummary.title,
            partnerName: savedQuoteSummary.customerName,
            totalAmount: savedQuoteSummary.totalAmount,
          }}
          previewLabel="👁️ 保存した見積書をプレビューで確認"
          approveLabel={
            savedQuoteSummary.isRevisionUp
              ? undefined
              : isQuoteWfEnabled
                ? "🚀 このまま承認を申請する"
                : "✅ このまま確定する"
          }
          onPreview={() => {
            const targetId = savedQuoteSummary.id;
            setSavedQuoteSummary(null);
            void handleOpenPreview(targetId);
          }}
          onApprove={() => {
            const targetId = savedQuoteSummary.id;
            setSavedQuoteSummary(null);
            void handleSubmitForApprovalAction(targetId);
          }}
          onContinue={() => setSavedQuoteSummary(null)}
          onBackToList={() => {
            setSavedQuoteSummary(null);
            setViewMode("LIST");
          }}
        />
      )}

      <QuotePreview
        previewQuote={previewQuote}
        onClose={() => setPreviewQuote(null)}
      />
    </div>
  );
}
