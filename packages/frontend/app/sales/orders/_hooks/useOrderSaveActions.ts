import { useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { PartnerMaster } from "../_types";

interface SavedOrderSummary {
  id: string;
  title: string;
  partnerName: string;
  totalAmount: number;
}

interface UseOrderSaveActionsProps {
  partners: PartnerMaster[];
  editingId: string | null;
  setEditingId: (id: string) => void;
  setOrderId: (id: string) => void;
  setViewMode: (mode: "LIST" | "FORM") => void;
  filters: Record<string, string>;
  filterStatus: string;
  syncOrders: (filters: Record<string, string>) => Promise<void>;
  setError: (msg: string) => void;
  setMessage: (msg: string) => void;
  setWarning: (msg: string) => void;
  setIsSubmitting: (v: boolean) => void;
  applicantDepartmentSurrogateId?: string | null;
}

// Item7: quotes/_hooks/useQuoteSaveActions.tsと同じ方針。
// 見積と違い改定(Ver.UP)の概念が無いため、isRevisionUp分岐は持たない
export function useOrderSaveActions({
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
}: UseOrderSaveActionsProps) {
  const [savedOrderSummary, setSavedOrderSummary] = useState<SavedOrderSummary | null>(null);

  const handleFormSubmitAction = async (payload: any) => {
    setError("");
    setMessage("");
    setWarning("");
    setIsSubmitting(true);

    const hasInvalidItem = payload.items.some(
      (item: any) => !item.itemId || (item.inputType === "DIRECT" && !item.itemName),
    );
    if (hasInvalidItem) {
      setError("品目IDまたは品目名が未入力の明細行があります");
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

    const orderJson = {
      id: payload.orderId,
      title: payload.orderTitle,
      partnerId: payload.partnerId,
      sourceQuoteId: payload.sourceQuoteId || null,
      orderDate: payload.orderDate,
      status: payload.status,
      totalAmount: payload.totalAmount,
      taxAmount: payload.taxAmount,
      memo: payload.memo.trim() === "" ? null : payload.memo,
      terms: payload.terms.trim() === "" ? null : payload.terms,
      companyDepartment: targetDeptId,
      salesPersonEmployeeNumber: payload.salesPersonEmployeeNumber || null,
      inputPersonEmployeeNumber: payload.inputPersonEmployeeNumber || null,
      items: payload.items.map((item: any) => ({
        itemId: item.itemId,
        itemName: item.itemName || null,
        inputType: item.inputType,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitCode: item.unitCode || null,
        taxCategoryCode: item.taxCategoryCode || null,
        memo: item.memo || null,
        sourceQuoteItemId: item.sourceQuoteItemId || null,
      })),
      attachments: cleanedAttachments,
      companyName: payload.companyName,
      companyAddress: payload.companyAddress,
      companyTel: payload.companyTel,
      companyFax: payload.companyFax,
      deliveryDate: payload.deliveryDate,
      deliveryPlace: payload.deliveryPlace,
      deliveryDestinationId: payload.deliveryDestinationId || null,
      paymentTerms: payload.paymentTerms,
      isPrepaid: payload.isPrepaid || false,
      prepaidAt: payload.prepaidAt || null,
    };

    const formData = new FormData();
    formData.append("orderData", JSON.stringify(orderJson));

    Object.keys(payload.selectedFiles).forEach((key) => {
      const file = payload.selectedFiles[key];
      if (file) formData.append(`files[${file.name}]`, file);
    });

    try {
      const url = editingId ? `/api/sales-orders/${editingId}` : "/api/sales-orders/register";
      const data = await apiFetch<{ id?: string; warning?: string }>(url, {
        method: editingId ? "PUT" : "POST",
        body: formData,
        defaultErrorMessage: "データ保存に失敗しました",
      });

      const targetSavedId = data.id || payload.orderId;

      setMessage(editingId ? "受注情報を更新しました" : "受注情報を新規登録しました");
      if (data.warning) setWarning(data.warning);

      setSavedOrderSummary({
        id: targetSavedId,
        title: payload.orderTitle || "(件名なし)",
        partnerName,
        totalAmount: payload.totalAmount,
      });

      void syncOrders({ ...filters, status: filterStatus });
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Item7: 承認済み受注の変更申請。quotesのhandleSubmitApprovedEditActionと同型
  const handleSubmitApprovedEditAction = async (payload: any) => {
    if (!editingId) return;
    setError("");
    setMessage("");
    setWarning("");
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
      title: payload.orderTitle,
      partnerId: payload.partnerId,
      orderDate: payload.orderDate,
      totalAmount: payload.totalAmount,
      taxAmount: payload.taxAmount,
      memo: payload.memo.trim() === "" ? null : payload.memo,
      terms: payload.terms.trim() === "" ? null : payload.terms,
      companyDepartment: targetDeptId,
      salesPersonEmployeeNumber: payload.salesPersonEmployeeNumber || null,
      inputPersonEmployeeNumber: payload.inputPersonEmployeeNumber || null,
      companyName: payload.companyName,
      companyAddress: payload.companyAddress,
      companyTel: payload.companyTel,
      companyFax: payload.companyFax,
      deliveryDate: payload.deliveryDate,
      deliveryPlace: payload.deliveryPlace,
      deliveryDestinationId: payload.deliveryDestinationId || null,
      paymentTerms: payload.paymentTerms,
      isPrepaid: payload.isPrepaid || false,
      prepaidAt: payload.prepaidAt || null,
    };

    const items = payload.items.map((item: any) => ({
      itemId: item.itemId,
      itemName: item.itemName || null,
      inputType: item.inputType || null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      costPrice: item.costPrice || null,
      unitCode: item.unitCode || null,
      taxCategoryCode: item.taxCategoryCode || null,
      memo: item.memo || null,
      sourceQuoteItemId: item.sourceQuoteItemId || null,
    }));

    try {
      // Item7残課題2-5フォローアップ6: 在庫は与信と異なり早い者勝ちの性格を持つため、
      // 最終承認確定を待たず、変更申請の提出時点で在庫を確保する専用エンドポイントを使う
      const data = await apiFetch<{ warning?: string }>(`/api/sales-orders/${editingId}/submit-update`, {
        method: "POST",
        json: {
          header,
          items,
          applicantDepartmentSurrogateId,
          comment: `受注[${editingId}]の変更申請`,
        },
        defaultErrorMessage: "変更の申請に失敗しました",
      });

      setMessage("受注の変更を申請しました");
      if (data.warning) setWarning(data.warning);
      void syncOrders({ ...filters, status: filterStatus });
      setViewMode("LIST");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    savedOrderSummary,
    setSavedOrderSummary,
    handleFormSubmitAction,
    handleSubmitApprovedEditAction,
  };
}
