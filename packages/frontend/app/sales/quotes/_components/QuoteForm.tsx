import React from "react";
import {
  QuoteRecord,
  PartnerMaster,
  ProductMaster,
  UserOption,
  UnitLookup,
  TaxCategoryLookup,
  ProjectLookup,
} from "../_types";
import { useQuoteForm } from "../_hooks/useQuoteForm";
import { QuoteFormHeader } from "./QuoteFormHeader";
import { DocumentCompletionControl } from "../../../_shared/ui/DocumentCompletionControl";
import { QuoteCompanyAndTermsFields } from "./QuoteCompanyAndTermsFields";
import { QuoteBasicFields } from "./QuoteBasicFields";
import { QuoteItemsTable } from "./QuoteItemsTable";
import { QuoteAttachmentsSection } from "./QuoteAttachmentsSection";
import { QuoteStatusAndActions } from "./QuoteStatusAndActions";
import { QuoteMailModal } from "./QuoteMailModal";
import type { ApplicantDepartmentOption } from "../../../types";

interface QuoteFormProps {
  editingId: string | null;
  quoteId: string;
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
  projects?: ProjectLookup[];
  onBackToList: () => void;
  onSubmit: (formData: any, isRevisionUp: boolean) => void;
  isSubmitting: boolean;
  isQuoteWfEnabled: boolean;
  onSubmitForApproval: (id: string) => void;
  onSubmitApprovedEdit: (formData: any) => void;
  onGeneratePDF: (id: string) => void;
  fetchSpecialPrice: (
    custID: string,
    prodID: string,
    quantity: number,
  ) => Promise<number | null>;
  initialData?: any;
  getSiblingVersions: () => QuoteRecord[];
  onOpenEditForm: (id: string) => void;
  handleSingleMailSend?: (params: {
    quoteId: string;
    recipientEmail: string;
  }) => Promise<boolean>;
  isMailSending?: boolean;
  // Item7残課題(見積へも展開): 入力担当者欄の新規作成時の既定値(ログインユーザー)
  currentUserEmployeeNumber?: string;
}

export function QuoteForm({
  editingId,
  quoteId,
  partners,
  products,
  userMaster,
  departments = [],
  applicantDepartments = [],
  applicantDepartmentSurrogateId = null,
  setApplicantDepartmentSurrogateId = () => {},
  units = [],
  taxCategories = [],
  projects = [],
  onBackToList,
  onSubmit,
  isSubmitting,
  isQuoteWfEnabled,
  onSubmitForApproval,
  onSubmitApprovedEdit,
  onGeneratePDF,
  fetchSpecialPrice,
  initialData,
  getSiblingVersions,
  onOpenEditForm,
  handleSingleMailSend,
  isMailSending = false,
  currentUserEmployeeNumber,
}: QuoteFormProps) {
  const {
    quoteTitle,
    setQuoteTitle,
    customerId,
    quoteDate,
    setQuoteDate,
    validUntil,
    setValidUntil,
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
    paymentTerms,
    setPaymentTerms,
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
  } = useQuoteForm({
    editingId,
    quoteId,
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

  // Item4-e: 承認処理中(PENDING_APPROVAL/PENDING_DELETION)は編集不可。
  // ただし承認機能が無効な場合はpartnersと同様ロックしない(会社設定で無効化した時点で
  // 審査待ち状態自体の意味が無くなるため、DRAFT/仮登録相当として直接編集できる)
  const isLocked =
    isQuoteWfEnabled &&
    (status === "PENDING_APPROVAL" || status === "PENDING_DELETION");

  return (
    <form onSubmit={(e) => handleFormSubmit(e, false)} className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <QuoteFormHeader
          editingId={editingId}
          quoteId={quoteId}
          status={status}
          isMailSending={isMailSending}
          siblingVersions={editingId ? getSiblingVersions() : []}
          onOpenEditForm={onOpenEditForm}
          onOpenMailModal={() => setShowMailModal(true)}
          onGeneratePDF={onGeneratePDF}
        />

        {/* 進捗確認(閲覧専用)に表示される完了/進行中の手動設定。この画面の更新権限がある場合のみ変更できる */}
        <DocumentCompletionControl stageKey="quote" documentId={editingId} />

        <fieldset disabled={isLocked} className="space-y-4 min-w-0">
        <QuoteCompanyAndTermsFields
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
          paymentTerms={paymentTerms}
          setPaymentTerms={setPaymentTerms}
        />

        <QuoteBasicFields
          quoteId={quoteId}
          quoteTitle={quoteTitle}
          setQuoteTitle={setQuoteTitle}
          customerId={customerId}
          onPartnerChange={handlePartnerChange}
          partners={partners}
          quoteDate={quoteDate}
          setQuoteDate={setQuoteDate}
          validUntil={validUntil}
          setValidUntil={setValidUntil}
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

        <QuoteItemsTable
          items={items}
          products={products}
          units={units}
          taxCategories={taxCategories}
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

        <QuoteAttachmentsSection
          quoteId={quoteId}
          attachments={attachments}
          onAddAttachmentRow={handleAddAttachmentRow}
          onRemoveAttachmentRow={handleRemoveAttachmentRow}
          onFileSelection={handleFileSelection}
          onFileNameChange={handleAttachmentFileNameChange}
          onExternalUrlChange={handleAttachmentExternalUrlChange}
        />

        </fieldset>

        <QuoteStatusAndActions
          memo={memo}
          setMemo={setMemo}
          status={status}
          setStatus={setStatus}
          isQuoteWfEnabled={isQuoteWfEnabled}
          isSubmitting={isSubmitting}
          editingId={editingId}
          applicantDepartments={applicantDepartments}
          applicantDepartmentSurrogateId={applicantDepartmentSurrogateId}
          setApplicantDepartmentSurrogateId={setApplicantDepartmentSurrogateId}
          onSubmitRevisionUp={(e) => handleFormSubmit(e, true)}
          onSubmitForApproval={() => onSubmitForApproval(quoteId)}
          onSubmitApprovedEdit={() =>
            onSubmitApprovedEdit(buildCurrentPayload())
          }
        />
      </div>

      {showMailModal && (
        <QuoteMailModal
          quoteId={quoteId}
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
