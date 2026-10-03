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
import { useOrders } from "./_hooks/useOrders";
import { useOrderListActions } from "./_hooks/useOrderListActions";
import { useOrderSaveActions } from "./_hooks/useOrderSaveActions";
import { OrderSearchForm } from "./_components/OrderSearchForm";
import { OrderTable } from "./_components/OrderTable";
import { OrderForm } from "./_components/OrderForm";
import { OrderPreview } from "./_components/OrderPreview";
import { QuotePickerModal } from "./_components/QuotePickerModal";
import { BulkShipmentPlanModal } from "./_components/BulkShipmentPlanModal";

export default function SalesOrdersPage() {
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    isSalesOrderWfEnabled,
    // 追加要望F: 申請部門選択用。useOrders()側の`departments`(自社部門マスタ、受注の
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
    orders,
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
    warning,
    setWarning,
    isSubmitting,
    setIsSubmitting,
    isMailSending,
    syncOrders,
    handleImportCSV,
    handleExportCSV,
    handleDeleteOrder,
    handleSubmitForApproval,
    handleRetryBackorder,
    handleSingleMailSend,
    handleBulkMailSend,
    fetchSpecialPrice,
  } = useOrders({ canRead, permsLoading });

  const {
    viewMode,
    setViewMode,
    filterStatus,
    setFilterStatus,
    selectedOrderIds,
    setSelectedOrderIds,
    previewOrder,
    setPreviewOrder,
    showQuotePicker,
    setShowQuotePicker,
    showBulkShipmentModal,
    setShowBulkShipmentModal,
    handleOpenBulkShipmentModal,
    editingId,
    setEditingId,
    orderId,
    setOrderId,
    initialFormData,
    filters,
    setFilters,
    handleClearSearch,
    handleOpenNewForm,
    handlePrefillFromQuote,
    handleOpenEditForm,
    handleOpenPreview,
    handleCSVImportChange,
    handleGeneratePDF,
    handleSubmitForApprovalAction,
    handleRetryBackorderAction,
    handleDeleteAction,
    handleBulkMailSendAction,
  } = useOrderListActions({
    canDelete,
    syncOrders,
    handleImportCSV,
    handleDeleteOrder,
    handleSubmitForApproval,
    handleRetryBackorder,
    handleBulkMailSend,
    setMessage,
    setError,
    applicantDepartmentSurrogateId,
  });

  const {
    savedOrderSummary,
    setSavedOrderSummary,
    handleFormSubmitAction,
    handleSubmitApprovedEditAction,
  } = useOrderSaveActions({
    partners,
    editingId,
    setEditingId,
    setOrderId,
    setViewMode,
    filters,
    filterStatus,
    syncOrders,
    setError,
    setMessage,
    setWarning,
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
        title="📋 受注管理"
        description="見積を起点とした受注データの新規登録・修正、決裁・承認申請および関連する証跡ファイルの管理を行います。"
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

      <MessageBanner message={message} error={error} warning={warning} />

      {viewMode === "LIST" ? (
        <div className="space-y-6">
          <OrderSearchForm
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
                  disabled={!canCreate || isSubmitting || isSalesOrderWfEnabled}
                  title={
                    isSalesOrderWfEnabled
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
                  disabled={!canCreate || isSubmitting || isSalesOrderWfEnabled}
                  onChange={handleCSVImportChange}
                />
                <Button
                  size="sm"
                  onClick={handleBulkMailSendAction}
                  disabled={selectedOrderIds.length === 0 || isMailSending}
                >
                  {isMailSending
                    ? "SMTP送信中..."
                    : `選択したデータをメール一括送信 (${selectedOrderIds.length}件) 🚀`}
                </Button>
                <Button
                  variant="success"
                  size="sm"
                  onClick={handleOpenBulkShipmentModal}
                  disabled={selectedOrderIds.length === 0}
                >
                  🚚📦 出荷指示/出庫を一括作成 ({selectedOrderIds.length}件)
                </Button>
                <button
                  type="button"
                  onClick={() => setShowQuotePicker(true)}
                  disabled={!canCreate}
                  className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm border ${canCreate ? "bg-white border-indigo-300 text-indigo-700 hover:bg-indigo-50" : "bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed opacity-60"}`}
                >
                  📄 見積から受注を作成
                </button>
                <button
                  type="button"
                  onClick={handleOpenNewForm}
                  disabled={!canCreate}
                  className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm ${canCreate ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-300 text-slate-500 cursor-not-allowed"}`}
                >
                  ➕ 受注を新規登録・申請する
                </button>
              </>
            }
          />

          <OrderTable
            orders={orders}
            partners={partners}
            userMaster={userMaster}
            selectedOrderIds={selectedOrderIds}
            onSelectToggle={(id) =>
              setSelectedOrderIds((prev) =>
                prev.includes(id)
                  ? prev.filter((item) => item !== id)
                  : [...prev, id],
              )
            }
            onOpenEditForm={handleOpenEditForm}
            onDeleteOrder={handleDeleteAction}
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
          <OrderForm
            editingId={editingId}
            orderId={orderId}
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
            isSalesOrderWfEnabled={isSalesOrderWfEnabled}
            onSubmitForApproval={handleSubmitForApprovalAction}
            onRetryBackorder={handleRetryBackorderAction}
            onSubmitApprovedEdit={handleSubmitApprovedEditAction}
            onGeneratePDF={handleGeneratePDF}
            fetchSpecialPrice={fetchSpecialPrice}
            initialData={initialFormData}
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

      {savedOrderSummary && (
        <SavedSummaryModal
          title="受注データを保存しました"
          warning={warning}
          codeLabel="受注管理コード"
          partnerLabel="得意先名"
          summary={savedOrderSummary}
          previewLabel="👁️ 保存した受注をプレビューで確認"
          approveLabel={
            isSalesOrderWfEnabled
              ? "🚀 このまま承認を申請する"
              : "✅ このまま確定する"
          }
          onPreview={() => {
            const targetId = savedOrderSummary.id;
            setSavedOrderSummary(null);
            void handleOpenPreview(targetId);
          }}
          onApprove={() => {
            const targetId = savedOrderSummary.id;
            setSavedOrderSummary(null);
            void handleSubmitForApprovalAction(targetId);
          }}
          onContinue={() => setSavedOrderSummary(null)}
          onBackToList={() => {
            setSavedOrderSummary(null);
            setViewMode("LIST");
          }}
        />
      )}

      {showQuotePicker && (
        <QuotePickerModal
          onClose={() => setShowQuotePicker(false)}
          onPrefill={handlePrefillFromQuote}
        />
      )}

      {showBulkShipmentModal && (
        <BulkShipmentPlanModal
          orderIds={selectedOrderIds}
          onClose={() => setShowBulkShipmentModal(false)}
          onSuccess={(msg) => {
            setMessage(msg);
            setSelectedOrderIds([]);
            void syncOrders({ ...filters, status: filterStatus });
          }}
        />
      )}

      <OrderPreview
        previewOrder={previewOrder}
        onClose={() => setPreviewOrder(null)}
      />
    </div>
  );
}
