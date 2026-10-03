import { useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { PartnerMaster } from "../_types";

interface SavedRecognitionSummary {
  id: string;
  title: string;
  partnerName: string;
  totalAmount: number;
}

interface UsePurchaseRecognitionSaveActionsProps {
  partners: PartnerMaster[];
  editingId: string | null;
  setEditingId: (id: string) => void;
  setRecognitionId: (id: string) => void;
  setViewMode: (mode: "LIST" | "FORM") => void;
  filters: Record<string, string>;
  filterStatus: string;
  syncRecognitions: (filters: Record<string, string>) => Promise<void>;
  setError: (msg: string) => void;
  setMessage: (msg: string) => void;
  setIsSubmitting: (v: boolean) => void;
  applicantDepartmentSurrogateId?: string | null;
}

// Item10: sales/invoices/_hooks/useSalesInvoiceSaveActions.tsと同じ構成。
// Ver.UP(改訂)機構は対象外のため常にeditingId有無だけでPOST/PUTを切り替える
export function usePurchaseRecognitionSaveActions({
  partners,
  editingId,
  setEditingId,
  setRecognitionId,
  setViewMode,
  filters,
  filterStatus,
  syncRecognitions,
  setError,
  setMessage,
  setIsSubmitting,
  applicantDepartmentSurrogateId,
}: UsePurchaseRecognitionSaveActionsProps) {
  const [savedRecognitionSummary, setSavedRecognitionSummary] =
    useState<SavedRecognitionSummary | null>(null);

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
    if ((payload.documentType === "RETURN" || payload.documentType === "DISCOUNT") && !payload.originalRecognitionId) {
      setError("返品・値引の場合は対象となる元仕入伝票の指定が必要です");
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

    const recognitionJson = {
      id: payload.recognitionId || undefined,
      title: payload.recognitionTitle,
      partnerId: payload.partnerId,
      orderId: payload.orderId || null,
      recognitionDate: payload.recognitionDate,
      status: payload.status,
      documentType: payload.documentType,
      originalRecognitionId: payload.originalRecognitionId || null,
      totalAmount: payload.totalAmount,
      taxAmount: payload.taxAmount,
      memo: payload.memo.trim() === "" ? null : payload.memo,
      companyDepartment: targetDeptId,
      company_department: targetDeptId,
      purchasePersonEmployeeNumber: payload.purchasePersonEmployeeNumber || null,
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
      // L-1-b: 対象検収の紐づけ(空配列=紐づけなし/解除。通常仕入以外はバックエンド側で無視される)
      receiptIds: Array.isArray(payload.receiptIds) ? payload.receiptIds : [],
      companyName: payload.companyName,
      companyAddress: payload.companyAddress,
      companyTel: payload.companyTel,
      companyFax: payload.companyFax,
      paymentTerms: payload.paymentTerms,
    };

    const formData = new FormData();
    formData.append("recognitionData", JSON.stringify(recognitionJson));

    Object.keys(payload.selectedFiles).forEach((key) => {
      const file = payload.selectedFiles[key];
      if (file) formData.append(`files[${file.name}]`, file);
    });

    try {
      const url = editingId
        ? `/api/purchase-recognitions/${editingId}`
        : "/api/purchase-recognitions/register";
      const data = await apiFetch<{ id?: string }>(url, {
        method: editingId ? "PUT" : "POST",
        body: formData,
        defaultErrorMessage: "データ保存に失敗しました",
      });

      const targetSavedId = data.id || payload.recognitionId;

      setMessage(editingId ? "仕入情報を更新しました" : "仕入情報を新規登録しました");

      setSavedRecognitionSummary({
        id: targetSavedId,
        title: payload.recognitionTitle || "(件名なし)",
        partnerName,
        totalAmount: payload.totalAmount,
      });

      void syncRecognitions({ ...filters, status: filterStatus });
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Item10: 承認済み仕入の変更申請。sales-invoice側と同じくheader+itemsを退避データとして
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
      title: payload.recognitionTitle,
      partnerId: payload.partnerId,
      orderId: payload.orderId || null,
      recognitionDate: payload.recognitionDate,
      documentType: payload.documentType,
      originalRecognitionId: payload.originalRecognitionId || null,
      totalAmount: payload.totalAmount,
      taxAmount: payload.taxAmount,
      memo: payload.memo.trim() === "" ? null : payload.memo,
      companyDepartment: targetDeptId,
      purchasePersonEmployeeNumber: payload.purchasePersonEmployeeNumber || null,
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
      unitCode: item.unitCode || null,
      taxCategoryCode: item.taxCategoryCode || null,
      memo: item.memo || null,
    }));

    try {
      await apiFetch("/api/approvals/request-update", {
        method: "POST",
        json: {
          targetType: "purchase_recognitions",
          targetId: editingId,
          requestType: "UPDATE",
          payload: { header, items },
          applicantDepartmentSurrogateId,
          comment: `仕入[${editingId}]の変更申請`,
        },
        defaultErrorMessage: "変更の申請に失敗しました",
      });

      setMessage("仕入の変更を申請しました");
      void syncRecognitions({ ...filters, status: filterStatus });
      setViewMode("LIST");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    savedRecognitionSummary,
    setSavedRecognitionSummary,
    handleFormSubmitAction,
    handleSubmitApprovedEditAction,
  };
}
