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
import { usePurchaseRecognitionForm } from "../_hooks/usePurchaseRecognitionForm";
import { PurchaseRecognitionFormHeader } from "./PurchaseRecognitionFormHeader";
import { DocumentCompletionControl } from "../../../_shared/ui/DocumentCompletionControl";
import { PurchaseRecognitionCompanyAndTermsFields } from "./PurchaseRecognitionCompanyAndTermsFields";
import { PurchaseRecognitionBasicFields } from "./PurchaseRecognitionBasicFields";
import { PurchaseRecognitionItemsTable } from "./PurchaseRecognitionItemsTable";
import { PurchaseRecognitionReceiptLinkSection } from "./PurchaseRecognitionReceiptLinkSection";
import { PurchaseRecognitionAttachmentsSection } from "./PurchaseRecognitionAttachmentsSection";
import { PurchaseRecognitionStatusAndActions } from "./PurchaseRecognitionStatusAndActions";
import { OrderPickerModal } from "./OrderPickerModal";
import type { ApplicantDepartmentOption } from "../../../types";

interface PurchaseRecognitionFormProps {
  editingId: string | null;
  recognitionId: string;
  partners: PartnerMaster[];
  products: ProductMaster[];
  userMaster: UserOption[];
  departments?: { id: string; name: string }[];
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
  isPurchaseRecognitionWfEnabled: boolean;
  onSubmitForApproval: (id: string) => void;
  onSubmitApprovedEdit: (formData: any) => void;
  onGeneratePDF: (id: string) => void;
  initialData?: any;
  // 追加要望L-2-a: 元の仕入から「赤伝を起票」する場合の元伝票(新規フォームへプレフィルする)
  redSlipSource?: any;
  currentUserEmployeeNumber?: string;
}

export function PurchaseRecognitionForm({
  editingId,
  recognitionId,
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
  onSubmit,
  isSubmitting,
  isPurchaseRecognitionWfEnabled,
  onSubmitForApproval,
  onSubmitApprovedEdit,
  onGeneratePDF,
  initialData,
  redSlipSource,
  currentUserEmployeeNumber,
}: PurchaseRecognitionFormProps) {
  const {
    recognitionTitle,
    setRecognitionTitle,
    partnerId,
    orderId,
    setOrderId,
    recognitionDate,
    setRecognitionDate,
    status,
    setStatus,
    documentType,
    setDocumentType,
    originalRecognitionId,
    setOriginalRecognitionId,
    purchasePersonEmployeeNumber,
    purchasePersonDepartment,
    setPurchasePersonDepartment,
    inputPersonEmployeeNumber,
    setInputPersonEmployeeNumber,
    memo,
    setMemo,
    projectId,
    setProjectId,
    receiptIds,
    setReceiptIds,
    companyName,
    setCompanyName,
    companyAddress,
    setCompanyAddress,
    companyTel,
    setCompanyTel,
    companyFax,
    setCompanyFax,
    paymentTerms,
    setPaymentTerms,
    items,
    attachments,
    showOrderPicker,
    setShowOrderPicker,
    openOrderPicker,
    applyOrderSelection,
    handlePartnerChange,
    handlePurchasePersonChange,
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
    originalCandidates,
  } = usePurchaseRecognitionForm({
    editingId,
    recognitionId,
    partners,
    products,
    userMaster,
    departments,
    taxCategories,
    onSubmit,
    initialData,
    redSlipSource,
    currentUserEmployeeNumber,
  });

  const isLocked =
    isPurchaseRecognitionWfEnabled &&
    (status === "PENDING_APPROVAL" || status === "PENDING_DELETION");

  return (
    <form onSubmit={handleFormSubmit} className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <PurchaseRecognitionFormHeader
          editingId={editingId}
          recognitionId={recognitionId}
          status={status}
          onGeneratePDF={onGeneratePDF}
        />

        {/* 進捗確認(閲覧専用)に表示される完了/進行中の手動設定。この画面の更新権限がある場合のみ変更できる */}
        <DocumentCompletionControl stageKey="purchase_recognition" documentId={editingId} />

        <fieldset disabled={isLocked} className="space-y-4 min-w-0">
          <PurchaseRecognitionCompanyAndTermsFields
            companyName={companyName}
            setCompanyName={setCompanyName}
            companyAddress={companyAddress}
            setCompanyAddress={setCompanyAddress}
            companyTel={companyTel}
            setCompanyTel={setCompanyTel}
            companyFax={companyFax}
            setCompanyFax={setCompanyFax}
            paymentTerms={paymentTerms}
            setPaymentTerms={setPaymentTerms}
          />

          <PurchaseRecognitionBasicFields
            recognitionId={recognitionId}
            recognitionTitle={recognitionTitle}
            setRecognitionTitle={setRecognitionTitle}
            partnerId={partnerId}
            onPartnerChange={handlePartnerChange}
            partners={partners}
            recognitionDate={recognitionDate}
            setRecognitionDate={setRecognitionDate}
            documentType={documentType}
            setDocumentType={setDocumentType}
            originalRecognitionId={originalRecognitionId}
            setOriginalRecognitionId={setOriginalRecognitionId}
            originalCandidates={originalCandidates}
            orderId={orderId}
            setOrderId={setOrderId}
            onOpenOrderPicker={openOrderPicker}
            purchasePersonEmployeeNumber={purchasePersonEmployeeNumber}
            onPurchasePersonChange={handlePurchasePersonChange}
            userMaster={userMaster}
            purchasePersonDepartment={purchasePersonDepartment}
            setPurchasePersonDepartment={setPurchasePersonDepartment}
            departments={departments}
            inputPersonEmployeeNumber={inputPersonEmployeeNumber}
            setInputPersonEmployeeNumber={setInputPersonEmployeeNumber}
            projectId={projectId}
            setProjectId={setProjectId}
            projects={projects}
          />

          {documentType === "PURCHASE" && (
            <PurchaseRecognitionReceiptLinkSection
              partnerId={partnerId}
              selectedReceiptIds={receiptIds}
              onChange={setReceiptIds}
            />
          )}

          <PurchaseRecognitionItemsTable
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

          <PurchaseRecognitionAttachmentsSection
            recognitionId={recognitionId}
            attachments={attachments}
            onAddAttachmentRow={handleAddAttachmentRow}
            onRemoveAttachmentRow={handleRemoveAttachmentRow}
            onFileSelection={handleFileSelection}
            onFileNameChange={handleAttachmentFileNameChange}
            onExternalUrlChange={handleAttachmentExternalUrlChange}
          />
        </fieldset>

        <PurchaseRecognitionStatusAndActions
          memo={memo}
          setMemo={setMemo}
          status={status}
          setStatus={setStatus}
          isPurchaseRecognitionWfEnabled={isPurchaseRecognitionWfEnabled}
          isSubmitting={isSubmitting}
          editingId={editingId}
          applicantDepartments={applicantDepartments}
          applicantDepartmentSurrogateId={applicantDepartmentSurrogateId}
          setApplicantDepartmentSurrogateId={setApplicantDepartmentSurrogateId}
          onSubmitForApproval={() => onSubmitForApproval(recognitionId)}
          onSubmitApprovedEdit={() => onSubmitApprovedEdit(buildCurrentPayload())}
        />
      </div>

      {showOrderPicker && (
        <OrderPickerModal
          initialOrderId={orderId}
          onClose={() => setShowOrderPicker(false)}
          onApply={applyOrderSelection}
        />
      )}
    </form>
  );
}
