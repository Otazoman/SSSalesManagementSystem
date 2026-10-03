import { useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { PartnerMaster } from "../_types";

interface SavedInvoiceSummary {
  id: string;
  title: string;
  partnerName: string;
  totalAmount: number;
}

interface UseSalesInvoiceSaveActionsProps {
  partners: PartnerMaster[];
  editingId: string | null;
  setEditingId: (id: string) => void;
  setInvoiceId: (id: string) => void;
  setViewMode: (mode: "LIST" | "FORM") => void;
  filters: Record<string, string>;
  filterStatus: string;
  syncInvoices: (filters: Record<string, string>) => Promise<void>;
  setError: (msg: string) => void;
  setMessage: (msg: string) => void;
  setIsSubmitting: (v: boolean) => void;
  applicantDepartmentSurrogateId?: string | null;
}

// Item8: quotes/_hooks/useQuoteSaveActions.tsと同じ構成。
// Ver.UP(改訂)機構は対象外のため常にeditingId有無だけでPOST/PUTを切り替える
export function useSalesInvoiceSaveActions({
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
}: UseSalesInvoiceSaveActionsProps) {
  const [savedInvoiceSummary, setSavedInvoiceSummary] = useState<SavedInvoiceSummary | null>(null);

  const handleFormSubmitAction = async (payload: any) => {
    setError("");
    setMessage("");
    setIsSubmitting(true);

    const hasInvalidItem = payload.items.some(
      (item: any) => !item.itemId || (item.inputType === "DIRECT" && !item.itemName),
    );
    if (hasInvalidItem) {
      setError("品目IDまたは品目名が未入力の明細行があります");
      setIsSubmitting(false);
      return;
    }

    // 追加要望L-2-a: 元伝票が必須なのは返品・値引のみ。赤伝(訂正)は元伝票なしの自由入力も可
    if ((payload.documentType === "RETURN" || payload.documentType === "DISCOUNT") && !payload.originalInvoiceId) {
      setError("返品・値引の場合は対象となる元の売上の指定が必要です");
      setIsSubmitting(false);
      return;
    }

    const cleanedAttachments = payload.attachments.map((att: any) => {
      const base = {
        fileName: att.fileName || "unnamed_file",
        storageType: att.storageType,
        attachmentR2Path: att.attachmentR2Path || null,
        externalUrl:
          att.storageType !== "R2" && att.externalUrl?.trim() ? att.externalUrl.trim() : null,
        fileType: att.fileType || att.file_type || "OTHER",
      };
      if (att.id) return { ...base, id: att.id };
      return base;
    });

    const currentPartner = partners.find((p) => p.id === payload.partnerId);
    const partnerName = currentPartner ? currentPartner.name : payload.partnerId;
    const targetDeptId = payload.companyDepartment?.trim() || null;

    const invoiceJson = {
      id: payload.invoiceId || undefined,
      title: payload.invoiceTitle,
      partnerId: payload.partnerId,
      salesOrderId: payload.salesOrderId || null,
      invoiceDate: payload.invoiceDate,
      status: payload.status,
      documentType: payload.documentType,
      originalInvoiceId: payload.originalInvoiceId || null,
      totalAmount: payload.totalAmount,
      taxAmount: payload.taxAmount,
      memo: payload.memo.trim() === "" ? null : payload.memo,
      companyDepartment: targetDeptId,
      company_department: targetDeptId,
      salesPersonEmployeeNumber: payload.salesPersonEmployeeNumber || null,
      inputPersonEmployeeNumber: payload.inputPersonEmployeeNumber || null,
      items: payload.items.map((item: any) => ({
        itemId: item.itemId,
        itemName: item.itemName || null,
        inputType: item.inputType,
        sourceOrderItemId: item.sourceOrderItemId || null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitCode: item.unitCode || null,
        taxCategoryCode: item.taxCategoryCode || null,
        memo: item.memo || null,
      })),
      attachments: cleanedAttachments,
      companyName: payload.companyName,
      companyAddress: payload.companyAddress,
      companyTel: payload.companyTel,
      companyFax: payload.companyFax,
      paymentTerms: payload.paymentTerms,
    };

    const formData = new FormData();
    formData.append("invoiceData", JSON.stringify(invoiceJson));

    Object.keys(payload.selectedFiles).forEach((key) => {
      const file = payload.selectedFiles[key];
      if (file) formData.append(`files[${file.name}]`, file);
    });

    try {
      const url = editingId ? `/api/sales-invoices/${editingId}` : "/api/sales-invoices/register";
      const data = await apiFetch<{ id?: string }>(url, {
        method: editingId ? "PUT" : "POST",
        body: formData,
        defaultErrorMessage: "データ保存に失敗しました",
      });

      const targetSavedId = data.id || payload.invoiceId;

      setMessage(editingId ? "売上情報を更新しました" : "売上情報を新規登録しました");

      setSavedInvoiceSummary({
        id: targetSavedId,
        title: payload.invoiceTitle || "(件名なし)",
        partnerName,
        totalAmount: payload.totalAmount,
      });

      void syncInvoices({ ...filters, status: filterStatus });
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Item8: 承認済み売上の変更申請。quote側と同じくheader+itemsを退避データとして
  // /api/approvals/request-updateへ提出する(添付ファイルの変更はこの申請には反映されない)
  const handleSubmitApprovedEditAction = async (payload: any) => {
    if (!editingId) return;
    setError("");
    setMessage("");
    setIsSubmitting(true);

    const hasInvalidItem = payload.items.some(
      (item: any) => !item.itemId || (item.inputType === "DIRECT" && !item.itemName),
    );
    if (hasInvalidItem) {
      setError("品目IDまたは品目名が未入力の明細行があります");
      setIsSubmitting(false);
      return;
    }

    const targetDeptId = payload.companyDepartment?.trim() || null;

    const header = {
      title: payload.invoiceTitle,
      partnerId: payload.partnerId,
      salesOrderId: payload.salesOrderId || null,
      invoiceDate: payload.invoiceDate,
      documentType: payload.documentType,
      originalInvoiceId: payload.originalInvoiceId || null,
      totalAmount: payload.totalAmount,
      taxAmount: payload.taxAmount,
      memo: payload.memo.trim() === "" ? null : payload.memo,
      companyDepartment: targetDeptId,
      salesPersonEmployeeNumber: payload.salesPersonEmployeeNumber || null,
      inputPersonEmployeeNumber: payload.inputPersonEmployeeNumber || null,
      companyName: payload.companyName,
      companyAddress: payload.companyAddress,
      companyTel: payload.companyTel,
      companyFax: payload.companyFax,
      paymentTerms: payload.paymentTerms,
    };

    const items = payload.items.map((item: any) => ({
      itemId: item.itemId,
      itemName: item.itemName || null,
      inputType: item.inputType || null,
      sourceOrderItemId: item.sourceOrderItemId || null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      costPrice: item.costPrice || null,
      unitCode: item.unitCode || null,
      taxCategoryCode: item.taxCategoryCode || null,
      memo: item.memo || null,
    }));

    try {
      await apiFetch("/api/approvals/request-update", {
        method: "POST",
        json: {
          targetType: "sales_invoices",
          targetId: editingId,
          requestType: "UPDATE",
          payload: { header, items },
          applicantDepartmentSurrogateId,
          comment: `売上[${editingId}]の変更申請`,
        },
        defaultErrorMessage: "変更の申請に失敗しました",
      });

      setMessage("売上の変更を申請しました");
      void syncInvoices({ ...filters, status: filterStatus });
      setViewMode("LIST");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    savedInvoiceSummary,
    setSavedInvoiceSummary,
    handleFormSubmitAction,
    handleSubmitApprovedEditAction,
  };
}
