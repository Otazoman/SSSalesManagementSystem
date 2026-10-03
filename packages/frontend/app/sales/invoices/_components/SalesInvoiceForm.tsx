import React from "react";
import {
  SalesInvoiceRecord,
  PartnerMaster,
  ProductMaster,
  UserOption,
  UnitLookup,
  TaxCategoryLookup,
  AccountLookup,
  ProjectLookup,
} from "../_types";
import { useSalesInvoiceForm } from "../_hooks/useSalesInvoiceForm";
import { SalesInvoiceFormHeader } from "./SalesInvoiceFormHeader";
import { DocumentCompletionControl } from "../../../_shared/ui/DocumentCompletionControl";
import { SalesInvoiceCompanyAndTermsFields } from "./SalesInvoiceCompanyAndTermsFields";
import { SalesInvoiceBasicFields } from "./SalesInvoiceBasicFields";
import { SalesInvoiceItemsTable } from "./SalesInvoiceItemsTable";
import { SalesInvoiceAttachmentsSection } from "./SalesInvoiceAttachmentsSection";
import { SalesInvoiceStatusAndActions } from "./SalesInvoiceStatusAndActions";
import { SalesOrderPickerModal } from "./SalesOrderPickerModal";
import { SalesInvoiceMailModal } from "./SalesInvoiceMailModal";
import type { ApplicantDepartmentOption } from "../../../types";

interface SalesInvoiceFormProps {
  editingId: string | null;
  invoiceId: string;
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
  isSalesInvoiceWfEnabled: boolean;
  onSubmitForApproval: (id: string) => void;
  onSubmitApprovedEdit: (formData: any) => void;
  onGeneratePDF: (id: string) => void;
  fetchSpecialPrice: (partnerId: string, prodID: string, quantity: number) => Promise<number | null>;
  initialData?: any;
  // 追加要望L-2-a: 元の売上から「赤伝を起票」する場合の元伝票(新規フォームへプレフィルする)
  redSlipSource?: any;
  handleSingleMailSend?: (params: { invoiceId: string; recipientEmail: string }) => Promise<boolean>;
  isMailSending?: boolean;
  currentUserEmployeeNumber?: string;
}

export function SalesInvoiceForm({
  editingId,
  invoiceId,
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
  isSalesInvoiceWfEnabled,
  onSubmitForApproval,
  onSubmitApprovedEdit,
  onGeneratePDF,
  fetchSpecialPrice,
  initialData,
  redSlipSource,
  handleSingleMailSend,
  isMailSending = false,
  currentUserEmployeeNumber,
}: SalesInvoiceFormProps) {
  const {
    invoiceTitle,
    setInvoiceTitle,
    partnerId,
    salesOrderId,
    setSalesOrderId,
    invoiceDate,
    setInvoiceDate,
    status,
    setStatus,
    documentType,
    setDocumentType,
    originalInvoiceId,
    setOriginalInvoiceId,
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
    recipientEmail,
    setRecipientEmail,
    showMailModal,
    setShowMailModal,
    partnerContacts,
    selectedContactId,
    isEmailRestrictedToContacts,
    handleContactSelect,
    handleSingleMailSendAction,
    handlePartnerChange,
    handleSalesPersonChange,
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
  } = useSalesInvoiceForm({
    editingId,
    invoiceId,
    partners,
    products,
    userMaster,
    departments,
    taxCategories,
    onSubmit,
    fetchSpecialPrice,
    initialData,
    redSlipSource,
    handleSingleMailSend,
    currentUserEmployeeNumber,
  });

  const isLocked =
    isSalesInvoiceWfEnabled && (status === "PENDING_APPROVAL" || status === "PENDING_DELETION");

  return (
    <form onSubmit={handleFormSubmit} className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <SalesInvoiceFormHeader
          editingId={editingId}
          invoiceId={invoiceId}
          status={status}
          isMailSending={isMailSending}
          onOpenMailModal={() => setShowMailModal(true)}
          onGeneratePDF={onGeneratePDF}
        />

        {/* 進捗確認(閲覧専用)に表示される完了/進行中の手動設定。この画面の更新権限がある場合のみ変更できる */}
        <DocumentCompletionControl stageKey="sales_invoice" documentId={editingId} />

        <fieldset disabled={isLocked} className="space-y-4 min-w-0">
          <SalesInvoiceCompanyAndTermsFields
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

          <SalesInvoiceBasicFields
            invoiceId={invoiceId}
            invoiceTitle={invoiceTitle}
            setInvoiceTitle={setInvoiceTitle}
            partnerId={partnerId}
            onPartnerChange={handlePartnerChange}
            partners={partners}
            invoiceDate={invoiceDate}
            setInvoiceDate={setInvoiceDate}
            documentType={documentType}
            setDocumentType={setDocumentType}
            originalInvoiceId={originalInvoiceId}
            setOriginalInvoiceId={setOriginalInvoiceId}
            originalCandidates={originalCandidates}
            salesOrderId={salesOrderId}
            setSalesOrderId={setSalesOrderId}
            onOpenOrderPicker={openOrderPicker}
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

          <SalesInvoiceItemsTable
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

          <SalesInvoiceAttachmentsSection
            invoiceId={invoiceId}
            attachments={attachments}
            onAddAttachmentRow={handleAddAttachmentRow}
            onRemoveAttachmentRow={handleRemoveAttachmentRow}
            onFileSelection={handleFileSelection}
            onFileNameChange={handleAttachmentFileNameChange}
            onExternalUrlChange={handleAttachmentExternalUrlChange}
          />
        </fieldset>

        <SalesInvoiceStatusAndActions
          memo={memo}
          setMemo={setMemo}
          status={status}
          setStatus={setStatus}
          isSalesInvoiceWfEnabled={isSalesInvoiceWfEnabled}
          isSubmitting={isSubmitting}
          editingId={editingId}
          applicantDepartments={applicantDepartments}
          applicantDepartmentSurrogateId={applicantDepartmentSurrogateId}
          setApplicantDepartmentSurrogateId={setApplicantDepartmentSurrogateId}
          onSubmitForApproval={() => onSubmitForApproval(invoiceId)}
          onSubmitApprovedEdit={() => onSubmitApprovedEdit(buildCurrentPayload())}
        />
      </div>

      {showOrderPicker && (
        <SalesOrderPickerModal
          initialSalesOrderId={salesOrderId}
          onClose={() => setShowOrderPicker(false)}
          onApply={applyOrderSelection}
        />
      )}

      {showMailModal && (
        <SalesInvoiceMailModal
          invoiceId={invoiceId}
          documentType={documentType}
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
