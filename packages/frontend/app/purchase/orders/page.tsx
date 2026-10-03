"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { Button } from "../../_shared/ui/Button";
import { usePermissionContext } from "../../context/permissioncontext";
import { usePurchaseOrderOperations } from "./_hooks/usePurchaseOrderOperations";
import { PurchaseOrderForm } from "./_components/PurchaseOrderForm";
import { PurchaseOrderTable } from "./_components/PurchaseOrderTable";
import { PurchaseRequisitionPickerModal } from "./_components/PurchaseRequisitionPickerModal";
import { SalesOrderShortagePickerModal } from "./_components/SalesOrderShortagePickerModal";
import { PurchaseOrderReorderPickerModal } from "./_components/PurchaseOrderReorderPickerModal";
import { OrderReorderSuggestionPickerModal } from "./_components/OrderReorderSuggestionPickerModal";
import { PurchaseOrderMailModal } from "./_components/PurchaseOrderMailModal";
import { PurchaseOrderSearchForm } from "./_components/PurchaseOrderSearchForm";
import { useDeepLinkId } from "../../_shared/hooks/use-deep-link-id";
import { PurchaseOrderRecord } from "./_types";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { StatusTabs } from "../../_shared/ui/StatusTabs";
import { Pagination } from "../../_shared/ui/Pagination";

export default function PurchaseOrdersPage() {
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    isPurchaseOrderWfEnabled,
    loading: permsLoading,
  } = usePagePermissions();
  const { user: currentUser } = usePermissionContext();

  const {
    orders,
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
    suppliers,
    userMaster,
    units,
    taxCategories,
    accounts,
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
    partnerId,
    onSupplierMasterSelect,
    requestId,
    orderDate,
    setOrderDate,
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
    projectId,
    setProjectId,
    purchasePersonEmployeeNumber,
    setPurchasePersonEmployeeNumber,
    inputPersonEmployeeNumber,
    setInputPersonEmployeeNumber,
    companyName,
    setCompanyName,
    companyDepartment,
    setCompanyDepartment,
    companyAddress,
    setCompanyAddress,
    companyTel,
    setCompanyTel,
    companyFax,
    setCompanyFax,
    deliveryDate,
    setDeliveryDate,
    deliveryPlace,
    setDeliveryPlace,
    deliveryLocationId,
    setDeliveryLocationId,
    deliveryWarehouseId,
    setDeliveryWarehouseId,
    businessLocations,
    warehouses,
    paymentTerms,
    setPaymentTerms,
    isPaid,
    setIsPaid,
    paidAt,
    setPaidAt,
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
    message,
    error,
    isSubmitting,
    isMailSending,
    selectedOrderIds,
    setSelectedOrderIds,
    showRequisitionPicker,
    setShowRequisitionPicker,
    showSalesOrderShortagePicker,
    setShowSalesOrderShortagePicker,
    showOrderReorderPicker,
    setShowOrderReorderPicker,
    showReorderSuggestionPicker,
    setShowReorderSuggestionPicker,
    handlePrefillFromRequisition,
    mailModalOrderId,
    setMailModalOrderId,
    recipientEmail,
    setRecipientEmail,
    supplierContacts,
    selectedContactId,
    handleContactSelect,
    isEmailRestrictedToContacts,
    handleClearForm,
    handleSelectEdit,
    handleSubmit,
    handleSubmitForApproval,
    handleDeleteLink,
    handleDownloadCsv,
    handleImportCsv,
    handleGeneratePdf,
    handleOpenMailModal,
    handleSendSingleMail,
    handleBulkMailSend,
  } = usePurchaseOrderOperations({
    canRead,
    isPurchaseOrderWfEnabled,
    currentUserEmployeeNumber: currentUser?.employeeNumber,
  });

  // 進捗確認など他画面からの`?editId=xxx`で該当の発注を開く(handleSelectEdit内でGET-by-idして取得する)
  useDeepLinkId(
    "editId",
    (id) => handleSelectEdit({ id } as PurchaseOrderRecord),
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
        title="🛒 発注管理"
        description="仕入先への発注データを作成し、承認フローへ申請します。"
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
          <PurchaseOrderSearchForm
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
                  {orders.length}
                </span>{" "}
                件
              </span>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <button
                  type="button"
                  onClick={() =>
                    document
                      .getElementById("purchase-order-csv-import-input")
                      ?.click()
                  }
                  disabled={
                    !canCreate || isSubmitting || isPurchaseOrderWfEnabled
                  }
                  title={
                    isPurchaseOrderWfEnabled
                      ? "承認機能有効時はCSVインポートを利用できません"
                      : undefined
                  }
                  className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
                >
                  📤 CSVインポート
                </button>
                <input
                  id="purchase-order-csv-import-input"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  disabled={
                    !canCreate || isSubmitting || isPurchaseOrderWfEnabled
                  }
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImportCsv(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  onClick={handleBulkMailSend}
                  disabled={selectedOrderIds.length === 0 || isMailSending}
                >
                  {isMailSending
                    ? "SMTP送信中..."
                    : `選択したデータをメール一括送信 (${selectedOrderIds.length}件) 🚀`}
                </Button>
                <button
                  type="button"
                  onClick={() => setShowRequisitionPicker(true)}
                  disabled={!canCreate}
                  className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm border ${canCreate ? "bg-white border-indigo-300 text-indigo-700 hover:bg-indigo-50" : "bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed opacity-60"}`}
                >
                  📝 購買申請から発注を作成
                </button>
                <button
                  type="button"
                  onClick={() => setShowSalesOrderShortagePicker(true)}
                  disabled={!canCreate || isPurchaseOrderWfEnabled}
                  title={
                    isPurchaseOrderWfEnabled
                      ? "承認機能有効時は「購買申請から発注を作成」より起票してください"
                      : undefined
                  }
                  className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm border ${
                    canCreate && !isPurchaseOrderWfEnabled
                      ? "bg-white border-amber-300 text-amber-700 hover:bg-amber-50"
                      : "bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed opacity-60"
                  }`}
                >
                  🚨 受注欠品から発注を作成
                </button>
                <button
                  type="button"
                  onClick={() => setShowOrderReorderPicker(true)}
                  disabled={!canCreate || isPurchaseOrderWfEnabled}
                  title={
                    isPurchaseOrderWfEnabled
                      ? "承認機能有効時は「購買申請から発注を作成」より起票してください"
                      : undefined
                  }
                  className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm border ${
                    canCreate && !isPurchaseOrderWfEnabled
                      ? "bg-white border-amber-300 text-amber-700 hover:bg-amber-50"
                      : "bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed opacity-60"
                  }`}
                >
                  🔁 過去の発注から再発注を作成
                </button>
                <button
                  type="button"
                  onClick={() => setShowReorderSuggestionPicker(true)}
                  disabled={!canCreate || isPurchaseOrderWfEnabled}
                  title={
                    isPurchaseOrderWfEnabled
                      ? "承認機能有効時は「購買申請から発注を作成」より起票してください"
                      : undefined
                  }
                  className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm border ${
                    canCreate && !isPurchaseOrderWfEnabled
                      ? "bg-white border-amber-300 text-amber-700 hover:bg-amber-50"
                      : "bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed opacity-60"
                  }`}
                >
                  📉 発注点/安全在庫から発注を作成
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleClearForm();
                    setViewMode("FORM");
                  }}
                  disabled={!canCreate || isPurchaseOrderWfEnabled}
                  title={
                    isPurchaseOrderWfEnabled
                      ? "承認機能有効時は「購買申請から発注を作成」より起票してください"
                      : undefined
                  }
                  className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm ${
                    canCreate && !isPurchaseOrderWfEnabled
                      ? "bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700"
                      : "bg-slate-300 text-slate-500 cursor-not-allowed"
                  }`}
                >
                  ➕ 発注を新規登録・申請する
                </button>
              </div>
            </div>
          </div>

          <PurchaseOrderTable
            orders={orders}
            partners={suppliers}
            selectedOrderIds={selectedOrderIds}
            onSelectToggle={(id) =>
              setSelectedOrderIds((prev) =>
                prev.includes(id)
                  ? prev.filter((item) => item !== id)
                  : [...prev, id],
              )
            }
            canUpdate={canUpdate}
            canDelete={canDelete}
            isSubmitting={isSubmitting}
            onSelectEdit={handleSelectEdit}
            onDeleteLink={handleDeleteLink}
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
        </div>
      ) : (
        <div className="contents" {...guard.scopeProps}>
          <PurchaseOrderForm
            editingId={editingId}
            editingStatus={editingStatus}
            title={title}
            setTitle={setTitle}
            partnerId={partnerId}
            onSupplierMasterSelect={onSupplierMasterSelect}
            suppliers={suppliers}
            requestId={requestId}
            orderDate={orderDate}
            setOrderDate={setOrderDate}
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
            projectId={projectId}
            setProjectId={setProjectId}
            purchasePersonEmployeeNumber={purchasePersonEmployeeNumber}
            setPurchasePersonEmployeeNumber={setPurchasePersonEmployeeNumber}
            inputPersonEmployeeNumber={inputPersonEmployeeNumber}
            setInputPersonEmployeeNumber={setInputPersonEmployeeNumber}
            companyName={companyName}
            setCompanyName={setCompanyName}
            companyDepartment={companyDepartment}
            setCompanyDepartment={setCompanyDepartment}
            companyAddress={companyAddress}
            setCompanyAddress={setCompanyAddress}
            companyTel={companyTel}
            setCompanyTel={setCompanyTel}
            companyFax={companyFax}
            setCompanyFax={setCompanyFax}
            deliveryDate={deliveryDate}
            setDeliveryDate={setDeliveryDate}
            deliveryPlace={deliveryPlace}
            setDeliveryPlace={setDeliveryPlace}
            deliveryLocationId={deliveryLocationId}
            setDeliveryLocationId={setDeliveryLocationId}
            deliveryWarehouseId={deliveryWarehouseId}
            setDeliveryWarehouseId={setDeliveryWarehouseId}
            businessLocations={businessLocations}
            warehouses={warehouses}
            paymentTerms={paymentTerms}
            setPaymentTerms={setPaymentTerms}
            isPaid={isPaid}
            setIsPaid={setIsPaid}
            paidAt={paidAt}
            setPaidAt={setPaidAt}
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
            isPurchaseOrderWfEnabled={isPurchaseOrderWfEnabled}
            isApprovedEdit={isApprovedEdit}
            isLocked={isLocked}
            isSubmitting={isSubmitting}
            onSubmit={handleSubmit}
            onSubmitForApproval={handleSubmitForApproval}
            onGeneratePdf={handleGeneratePdf}
            onOpenMailModal={handleOpenMailModal}
            onCancel={async () => {
              if (!(await guard.confirmDiscard())) return;
              handleClearForm();
              setViewMode("LIST");
            }}
          />
        </div>
      )}

      {showRequisitionPicker && (
        <PurchaseRequisitionPickerModal
          onClose={() => setShowRequisitionPicker(false)}
          onPrefill={handlePrefillFromRequisition}
        />
      )}

      {showSalesOrderShortagePicker && (
        <SalesOrderShortagePickerModal
          onClose={() => setShowSalesOrderShortagePicker(false)}
          onPrefill={handlePrefillFromRequisition}
        />
      )}

      {showOrderReorderPicker && (
        <PurchaseOrderReorderPickerModal
          onClose={() => setShowOrderReorderPicker(false)}
          onPrefill={handlePrefillFromRequisition}
        />
      )}

      {showReorderSuggestionPicker && (
        <OrderReorderSuggestionPickerModal
          onClose={() => setShowReorderSuggestionPicker(false)}
          onPrefill={handlePrefillFromRequisition}
        />
      )}

      {mailModalOrderId && (
        <PurchaseOrderMailModal
          orderId={mailModalOrderId}
          recipientEmail={recipientEmail}
          setRecipientEmail={setRecipientEmail}
          supplierContacts={supplierContacts}
          selectedContactId={selectedContactId}
          restrictToRegisteredContacts={isEmailRestrictedToContacts}
          onContactSelect={handleContactSelect}
          onClose={() => setMailModalOrderId(null)}
          onSend={handleSendSingleMail}
          isMailSending={isMailSending}
        />
      )}
    </div>
  );
}
