"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { usePermissionContext } from "../../context/permissioncontext";
import { usePurchaseRequisitionOperations } from "./_hooks/usePurchaseRequisitionOperations";
import { PurchaseRequisitionForm } from "./_components/PurchaseRequisitionForm";
import { PurchaseRequisitionTable } from "./_components/PurchaseRequisitionTable";
import { PurchaseRequisitionSearchForm } from "./_components/PurchaseRequisitionSearchForm";
import { SalesOrderPickerModal } from "./_components/SalesOrderPickerModal";
import { PurchaseOrderPickerModal } from "./_components/PurchaseOrderPickerModal";
import { ReorderSuggestionPickerModal } from "./_components/ReorderSuggestionPickerModal";
import { useDeepLinkId } from "../../_shared/hooks/use-deep-link-id";
import { PurchaseRequisitionRecord } from "./_types";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { StatusTabs } from "../../_shared/ui/StatusTabs";
import { Pagination } from "../../_shared/ui/Pagination";

export default function PurchaseRequisitionsPage() {
  const [showSalesOrderPicker, setShowSalesOrderPicker] = useState(false);
  const [showPurchaseOrderPicker, setShowPurchaseOrderPicker] = useState(false);
  const [showReorderSuggestionPicker, setShowReorderSuggestionPicker] =
    useState(false);

  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    isPurchaseRequisitionWfEnabled,
    departments,
    loading: permsLoading,
  } = usePagePermissions();
  const { user: currentUser } = usePermissionContext();

  const {
    requisitions,
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
    allItems,
    projects,
    orgDepartments,
    filterStatus,
    setFilterStatus,
    searchFilters,
    setSearchFilters,
    handleClearSearchFilters,
    viewMode,
    setViewMode,
    editingId,
    editingStatus,
    title,
    setTitle,
    departmentSurrogateId,
    setDepartmentSurrogateId,
    requestType,
    setRequestType,
    memo,
    setMemo,
    items,
    addItemRow,
    updateItemRow,
    onItemTypeChange,
    onItemMasterSelect,
    onItemQuantityChange,
    removeItemRow,
    moveItemUp,
    moveItemDown,
    suppliers,
    userMaster,
    units,
    taxCategories,
    accounts,
    partnerId,
    partnerName,
    setPartnerName,
    partnerInputType,
    onPartnerTypeChange,
    onSupplierMasterSelect,
    projectId,
    setProjectId,
    applicantId,
    setApplicantId,
    inputPersonEmployeeNumber,
    setInputPersonEmployeeNumber,
    attachments,
    handleAddAttachmentRow,
    handleRemoveAttachmentRow,
    handleFileSelection,
    handleAttachmentFileNameChange,
    handleAttachmentExternalUrlChange,
    totalAmount,
    taxAmount,
    calcSubTotal,
    calcGrossSubTotal,
    calcDiscountTotal,
    calcTax,
    calcTaxBreakdown,
    calcTotal,
    isApprovedEdit,
    isLocked,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    message,
    error,
    isSubmitting,
    handleClearForm,
    handleSelectEdit,
    handlePrefillFromSalesOrder,
    handlePrefillFromPurchaseOrder,
    handlePrefillFromReorderSuggestion,
    handleCopyToNewDraft,
    handleSubmit,
    handleSubmitForApproval,
    handleDeleteLink,
    handleDownloadCsv,
    handleImportCsv,
  } = usePurchaseRequisitionOperations({
    canRead,
    isPurchaseRequisitionWfEnabled,
    departments,
    permsLoading,
    currentUserEmployeeNumber: currentUser?.employeeNumber,
  });

  // 進捗確認など他画面からの`?editId=xxx`で該当の購買申請を開く(handleSelectEdit内でGET-by-idして取得する)
  useDeepLinkId(
    "editId",
    (id) => handleSelectEdit({ id } as PurchaseRequisitionRecord),
    !permsLoading && canRead,
  );

  const guard = useDiscardGuard(`${viewMode}-${editingId}`);

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
      <PageHeader
        title="📝 購買申請"
        description="物品・部材の購買申請を作成し、承認フローへ申請します。"
        actions={
          <>
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={isSubmitting}
              className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm disabled:bg-slate-100 disabled:text-slate-500 disabled:opacity-60"
            >
              📥 CSVダウンロード
            </button>
            {viewMode === "FORM" && (
              <button
                type="button"
                onClick={async () => {
                  if (!(await guard.confirmDiscard())) return;
                  handleClearForm();
                  setViewMode("LIST");
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
          <PurchaseRequisitionSearchForm
            suppliers={suppliers}
            userMaster={userMaster}
            filters={searchFilters}
            setFilters={setSearchFilters}
            onClear={handleClearSearchFilters}
          />

          <div className="flex flex-col gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-700 w-16 shrink-0">
                状態
              </span>
              <div className="min-w-96 shrink-0">
                <StatusTabs
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
              </div>
            </div>

            <div className="flex justify-between items-center gap-4">
              <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
                📊 該当件数:{" "}
                <span className="text-sm font-black text-indigo-600">
                  {requisitions.length}
                </span>{" "}
                件
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    document
                      .getElementById("purchase-requisition-csv-import-input")
                      ?.click()
                  }
                  disabled={
                    !canCreate || isSubmitting || isPurchaseRequisitionWfEnabled
                  }
                  title={
                    isPurchaseRequisitionWfEnabled
                      ? "承認機能有効時はCSVインポートを利用できません"
                      : undefined
                  }
                  className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
                >
                  📤 CSVインポート
                </button>
                <input
                  id="purchase-requisition-csv-import-input"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  disabled={
                    !canCreate || isSubmitting || isPurchaseRequisitionWfEnabled
                  }
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImportCsv(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowSalesOrderPicker(true)}
                  disabled={!canCreate}
                  className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
                >
                  🔗 受注の欠品から購買申請を作成
                </button>
                <button
                  type="button"
                  onClick={() => setShowPurchaseOrderPicker(true)}
                  disabled={!canCreate}
                  className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
                >
                  🔁 過去の発注から再発注を作成
                </button>
                <button
                  type="button"
                  onClick={() => setShowReorderSuggestionPicker(true)}
                  disabled={!canCreate}
                  className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
                >
                  📉 発注点/安全在庫を下回った品目から購買申請を作成
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleClearForm();
                    setViewMode("FORM");
                  }}
                  disabled={!canCreate}
                  className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm ${
                    canCreate
                      ? "bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700"
                      : "bg-slate-300 text-slate-500 cursor-not-allowed"
                  }`}
                >
                  ➕ 購買申請を新規登録・申請する
                </button>
              </div>
            </div>
          </div>

          <PurchaseRequisitionTable
            requisitions={requisitions}
            canCreate={canCreate}
            canUpdate={canUpdate}
            canDelete={canDelete}
            isSubmitting={isSubmitting}
            onSelectEdit={handleSelectEdit}
            onDeleteLink={handleDeleteLink}
            onCopyToNewDraft={handleCopyToNewDraft}
            sortBy={sortBy}
            sortDirection={sortDirection}
            sortKeys={sortKeys}
            onSortChange={setSort}
          />
          {/* BUG-032: 会社設定の「一覧のページ分割」に従う */}
          <Pagination
            paginationEnabled={paginationEnabled}
            page={page}
            totalPages={totalPages}
            total={total}
            limit={limit}
            onPageChange={setPage}
            onLimitChange={setLimit}
          />

          {showSalesOrderPicker && (
            <SalesOrderPickerModal
              onClose={() => setShowSalesOrderPicker(false)}
              onPrefill={handlePrefillFromSalesOrder}
            />
          )}
          {showPurchaseOrderPicker && (
            <PurchaseOrderPickerModal
              onClose={() => setShowPurchaseOrderPicker(false)}
              onPrefill={handlePrefillFromPurchaseOrder}
            />
          )}
          {showReorderSuggestionPicker && (
            <ReorderSuggestionPickerModal
              onClose={() => setShowReorderSuggestionPicker(false)}
              onPrefill={handlePrefillFromReorderSuggestion}
            />
          )}
        </div>
      ) : (
        <div className="contents" {...guard.scopeProps}>
          <PurchaseRequisitionForm
            editingId={editingId}
            editingStatus={editingStatus}
            title={title}
            setTitle={setTitle}
            departmentSurrogateId={departmentSurrogateId}
            setDepartmentSurrogateId={setDepartmentSurrogateId}
            requestType={requestType}
            setRequestType={setRequestType}
            memo={memo}
            setMemo={setMemo}
            items={items}
            addItemRow={addItemRow}
            updateItemRow={updateItemRow}
            onItemTypeChange={onItemTypeChange}
            onItemMasterSelect={onItemMasterSelect}
            onItemQuantityChange={onItemQuantityChange}
            removeItemRow={removeItemRow}
            moveItemUp={moveItemUp}
            moveItemDown={moveItemDown}
            partnerId={partnerId}
            partnerName={partnerName}
            setPartnerName={setPartnerName}
            partnerInputType={partnerInputType}
            onPartnerTypeChange={onPartnerTypeChange}
            onSupplierMasterSelect={onSupplierMasterSelect}
            suppliers={suppliers}
            projectId={projectId}
            setProjectId={setProjectId}
            applicantId={applicantId}
            setApplicantId={setApplicantId}
            inputPersonEmployeeNumber={inputPersonEmployeeNumber}
            setInputPersonEmployeeNumber={setInputPersonEmployeeNumber}
            userMaster={userMaster}
            units={units}
            taxCategories={taxCategories}
            accounts={accounts}
            attachments={attachments}
            onAddAttachmentRow={handleAddAttachmentRow}
            onRemoveAttachmentRow={handleRemoveAttachmentRow}
            onFileSelection={handleFileSelection}
            onAttachmentFileNameChange={handleAttachmentFileNameChange}
            onAttachmentExternalUrlChange={handleAttachmentExternalUrlChange}
            totalAmount={totalAmount}
            taxAmount={taxAmount}
            calcSubTotal={calcSubTotal}
            calcGrossSubTotal={calcGrossSubTotal}
            calcDiscountTotal={calcDiscountTotal}
            calcTax={calcTax}
            calcTaxBreakdown={calcTaxBreakdown}
            calcTotal={calcTotal}
            allItems={allItems}
            projects={projects}
            orgDepartments={orgDepartments}
            isPurchaseRequisitionWfEnabled={isPurchaseRequisitionWfEnabled}
            isApprovedEdit={isApprovedEdit}
            isLocked={isLocked}
            applicantDepartments={departments}
            applicantDepartmentSurrogateId={applicantDepartmentSurrogateId}
            setApplicantDepartmentSurrogateId={
              setApplicantDepartmentSurrogateId
            }
            isSubmitting={isSubmitting}
            onSubmit={handleSubmit}
            onSubmitForApproval={handleSubmitForApproval}
            onCancel={async () => {
              if (!(await guard.confirmDiscard())) return;
              handleClearForm();
              setViewMode("LIST");
            }}
          />
        </div>
      )}
    </div>
  );
}
