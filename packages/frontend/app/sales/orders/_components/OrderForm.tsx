import React from "react";
import {
  PartnerMaster,
  ProductMaster,
  UserOption,
  UnitLookup,
  TaxCategoryLookup,
  AccountLookup,
  ProjectLookup,
} from "../_types";
import { useOrderForm } from "../_hooks/useOrderForm";
import { OrderFormHeader } from "./OrderFormHeader";
import { DocumentCompletionControl } from "../../../_shared/ui/DocumentCompletionControl";
import { OrderCompanyAndTermsFields } from "./OrderCompanyAndTermsFields";
import { OrderBasicFields } from "./OrderBasicFields";
import { OrderItemsTable } from "./OrderItemsTable";
import { OrderAttachmentsSection } from "./OrderAttachmentsSection";
import { OrderStatusAndActions } from "./OrderStatusAndActions";
import { OrderShipmentProgress } from "./OrderShipmentProgress";
import { OrderMailModal } from "./OrderMailModal";
import type { ApplicantDepartmentOption } from "../../../types";

interface OrderFormProps {
  editingId: string | null;
  orderId: string;
  partners: PartnerMaster[];
  products: ProductMaster[];
  userMaster: UserOption[];
  departments?: { id: string; name: string }[];
  // 追加要望F: 申請部門選択用。上のdepartments(自社部門マスタ、貴社担当部門欄向け)とは別物。
  applicantDepartments?: ApplicantDepartmentOption[];
  applicantDepartmentSurrogateId?: string | null;
  setApplicantDepartmentSurrogateId?: (value: string) => void;
  units?: UnitLookup[];
  taxCategories?: TaxCategoryLookup[];
  accounts?: AccountLookup[];
  projects?: ProjectLookup[];
  onBackToList: () => void;
  onSubmit: (formData: any) => void;
  isSubmitting: boolean;
  isSalesOrderWfEnabled: boolean;
  onSubmitForApproval: (id: string) => void;
  onRetryBackorder: (id: string) => void;
  onSubmitApprovedEdit: (formData: any) => void;
  onGeneratePDF: (id: string) => void;
  fetchSpecialPrice: (
    partnerId: string,
    prodID: string,
    quantity: number,
  ) => Promise<number | null>;
  initialData?: any;
  handleSingleMailSend?: (params: {
    orderId: string;
    recipientEmail: string;
  }) => Promise<boolean>;
  isMailSending?: boolean;
  // Item7残課題: 入力担当者欄の新規作成時の既定値(ログインユーザー)
  currentUserEmployeeNumber?: string;
}

export function OrderForm({
  editingId,
  orderId,
  partners,
  products,
  userMaster,
  departments = [],
  applicantDepartments = [],
  applicantDepartmentSurrogateId = null,
  setApplicantDepartmentSurrogateId = () => {},
  units = [],
  taxCategories = [],
  accounts = [],
  projects = [],
  onBackToList,
  onSubmit,
  isSubmitting,
  isSalesOrderWfEnabled,
  onSubmitForApproval,
  onRetryBackorder,
  onSubmitApprovedEdit,
  onGeneratePDF,
  fetchSpecialPrice,
  initialData,
  handleSingleMailSend,
  isMailSending = false,
  currentUserEmployeeNumber,
}: OrderFormProps) {
  const {
    orderTitle,
    setOrderTitle,
    partnerId,
    sourceQuoteId,
    orderDate,
    setOrderDate,
    status,
    setStatus,
    salesPersonEmployeeNumber,
    salesPersonDepartment,
    setSalesPersonDepartment,
    inputPersonEmployeeNumber,
    setInputPersonEmployeeNumber,
    memo,
    setMemo,
    projectId,
    setProjectId,
    companyName,
    setCompanyName,
    companyZip,
    setCompanyZip,
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
    deliveryDestinationId,
    setDeliveryDestinationId,
    deliveryDestinations,
    paymentTerms,
    setPaymentTerms,
    isPrepaid,
    setIsPrepaid,
    prepaidAt,
    setPrepaidAt,
    items,
    attachments,
    recipientEmail,
    setRecipientEmail,
    showMailModal,
    setShowMailModal,
    partnerContacts,
    selectedContactId,
    isEmailRestrictedToContacts,
    handleContactSelect,
    handleSalesPersonChange,
    handlePartnerChange,
    handleItemChange,
    handleItemTypeChange,
    handleAddItemRow,
    handleRemoveItemRow,
    handleMoveItemUp,
    handleMoveItemDown,
    handleAddAttachmentRow,
    handleRemoveAttachmentRow,
    handleFileSelection,
    handleAttachmentFileNameChange,
    handleAttachmentExternalUrlChange,
    calcSubTotal,
    calcGrossSubTotal,
    calcDiscountTotal,
    calcTax,
    calcTaxBreakdown,
    calcTotal,
    handleFormSubmit,
    buildCurrentPayload,
    handleSingleMailSendAction,
  } = useOrderForm({
    editingId,
    orderId,
    partners,
    products,
    userMaster,
    departments,
    taxCategories,
    onSubmit,
    fetchSpecialPrice,
    initialData,
    handleSingleMailSend,
    currentUserEmployeeNumber,
  });

  const isLocked =
    isSalesOrderWfEnabled &&
    (status === "PENDING_APPROVAL" || status === "PENDING_DELETION");

  return (
    <form onSubmit={handleFormSubmit} className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <OrderFormHeader
          editingId={editingId}
          orderId={orderId}
          status={status}
          isMailSending={isMailSending}
          onOpenMailModal={() => setShowMailModal(true)}
          onGeneratePDF={onGeneratePDF}
        />

        {/* 進捗確認(閲覧専用)に表示される完了/進行中の手動設定。この画面の更新権限がある場合のみ変更できる */}
        <DocumentCompletionControl
          stageKey="sales_order"
          documentId={editingId}
        />

        <fieldset disabled={isLocked} className="space-y-4">
          <OrderCompanyAndTermsFields
            companyName={companyName}
            setCompanyName={setCompanyName}
            companyZip={companyZip}
            setCompanyZip={setCompanyZip}
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
            deliveryDestinationId={deliveryDestinationId}
            setDeliveryDestinationId={setDeliveryDestinationId}
            deliveryDestinations={deliveryDestinations}
            paymentTerms={paymentTerms}
            setPaymentTerms={setPaymentTerms}
          />

          <OrderBasicFields
            orderId={orderId}
            orderTitle={orderTitle}
            setOrderTitle={setOrderTitle}
            partnerId={partnerId}
            onPartnerChange={handlePartnerChange}
            partners={partners}
            sourceQuoteId={sourceQuoteId}
            orderDate={orderDate}
            setOrderDate={setOrderDate}
            salesPersonEmployeeNumber={salesPersonEmployeeNumber}
            onSalesPersonChange={handleSalesPersonChange}
            userMaster={userMaster}
            salesPersonDepartment={salesPersonDepartment}
            setSalesPersonDepartment={setSalesPersonDepartment}
            departments={departments}
            inputPersonEmployeeNumber={inputPersonEmployeeNumber}
            setInputPersonEmployeeNumber={setInputPersonEmployeeNumber}
            projectId={projectId}
            setProjectId={setProjectId}
            projects={projects}
          />

          <OrderItemsTable
            items={items}
            products={products}
            units={units}
            taxCategories={taxCategories}
            accounts={accounts}
            onItemTypeChange={handleItemTypeChange}
            onItemChange={handleItemChange}
            onAddItemRow={handleAddItemRow}
            onRemoveItemRow={handleRemoveItemRow}
            onMoveItemUp={handleMoveItemUp}
            onMoveItemDown={handleMoveItemDown}
            calcSubTotal={calcSubTotal}
            calcGrossSubTotal={calcGrossSubTotal}
            calcDiscountTotal={calcDiscountTotal}
            calcTax={calcTax}
            calcTaxBreakdown={calcTaxBreakdown}
            calcTotal={calcTotal}
          />

          <OrderAttachmentsSection
            orderId={orderId}
            attachments={attachments}
            onAddAttachmentRow={handleAddAttachmentRow}
            onRemoveAttachmentRow={handleRemoveAttachmentRow}
            onFileSelection={handleFileSelection}
            onFileNameChange={handleAttachmentFileNameChange}
            onExternalUrlChange={handleAttachmentExternalUrlChange}
          />

          <div className="flex items-center gap-2 bg-amber-50/60 border border-amber-200 rounded-lg px-3 py-2">
            <input
              id="so-is-prepaid"
              type="checkbox"
              checked={isPrepaid}
              onChange={(e) => setIsPrepaid(e.target.checked)}
              disabled={isLocked}
              className="cursor-pointer"
            />
            <label
              htmlFor="so-is-prepaid"
              className="text-xs font-bold text-slate-700 cursor-pointer"
            >
              前受: 入金完了済み
            </label>
            {isPrepaid && (
              <input
                type="date"
                className="border border-slate-300 rounded px-2 py-1 text-base sm:text-xs bg-white text-slate-900 w-40"
                value={prepaidAt}
                onChange={(e) => setPrepaidAt(e.target.value)}
                disabled={isLocked}
              />
            )}
          </div>
        </fieldset>

        <OrderStatusAndActions
          memo={memo}
          setMemo={setMemo}
          status={status}
          setStatus={setStatus}
          isSalesOrderWfEnabled={isSalesOrderWfEnabled}
          isSubmitting={isSubmitting}
          editingId={editingId}
          applicantDepartments={applicantDepartments}
          applicantDepartmentSurrogateId={applicantDepartmentSurrogateId}
          setApplicantDepartmentSurrogateId={setApplicantDepartmentSurrogateId}
          onSubmitForApproval={() => onSubmitForApproval(orderId)}
          onSubmitApprovedEdit={() =>
            onSubmitApprovedEdit(buildCurrentPayload())
          }
          hasBackorder={items.some((i) => (i.backorderedQuantity || 0) > 0)}
          onRetryBackorder={() => onRetryBackorder(orderId)}
        />

        {editingId && status === "APPROVED" && (
          <OrderShipmentProgress orderId={orderId} />
        )}
      </div>

      {showMailModal && (
        <OrderMailModal
          orderId={orderId}
          recipientEmail={recipientEmail}
          setRecipientEmail={setRecipientEmail}
          partnerContacts={partnerContacts}
          selectedContactId={selectedContactId}
          restrictToRegisteredContacts={isEmailRestrictedToContacts}
          onContactSelect={handleContactSelect}
          onClose={() => setShowMailModal(false)}
          onSend={handleSingleMailSendAction}
          isMailSending={isMailSending}
        />
      )}
    </form>
  );
}
