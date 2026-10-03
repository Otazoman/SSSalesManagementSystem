import { useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { PartnerMaster } from "../_types";

interface SavedQuoteSummary {
  id: string;
  title: string;
  customerName: string;
  totalAmount: number;
  isRevisionUp: boolean;
  // BUG-058: 編集で確定(APPROVED)にして保存した場合はtrue。保存後の画面に「このまま確定する」を出さない
  isConfirmed: boolean;
}

interface UseQuoteSaveActionsProps {
  partners: PartnerMaster[];
  editingId: string | null;
  setEditingId: (id: string) => void;
  setQuoteId: (id: string) => void;
  setViewMode: (mode: "LIST" | "FORM") => void;
  filters: Record<string, string>;
  filterStatus: string;
  syncQuotes: (filters: Record<string, string>) => Promise<void>;
  setError: (msg: string) => void;
  setMessage: (msg: string) => void;
  setIsSubmitting: (v: boolean) => void;
  applicantDepartmentSurrogateId?: string | null;
}

// Item4-f: page.tsxから分割。見積フォームの保存(通常保存・承認済み見積の変更申請)を担当。
// 両方ともフロントの入力値からAPI送信用JSON payloadを組み立てる処理が中心で、
// 一覧画面の操作(useQuoteListActions.ts)とは関心事が異なるため分離している
export function useQuoteSaveActions({
  partners,
  editingId,
  setEditingId,
  setQuoteId,
  setViewMode,
  filters,
  filterStatus,
  syncQuotes,
  setError,
  setMessage,
  setIsSubmitting,
  applicantDepartmentSurrogateId,
}: UseQuoteSaveActionsProps) {
  // 💡 保存完了時のワンクッション確認ダイアログ用ステート
  const [savedQuoteSummary, setSavedQuoteSummary] =
    useState<SavedQuoteSummary | null>(null);

  const handleFormSubmitAction = async (
    payload: any,
    isRevisionUp: boolean,
  ) => {
    setError("");
    setMessage("");
    setIsSubmitting(true);

    const hasInvalidItem = payload.items.some(
      (item: any) =>
        !item.itemId || (item.inputType === "DIRECT" && !item.itemName),
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
          att.storageType !== "R2" && att.externalUrl?.trim()
            ? att.externalUrl.trim()
            : null,
        // 💡【重要修正】ファイル種別（PDF、OTHER等）を維持して送信します
        fileType: att.fileType || att.file_type || "OTHER",
      };
      if (att.id) return { ...base, id: att.id };
      return base;
    });

    const currentPartner = partners.find((c) => c.id === payload.customerId);
    const customerName = currentPartner
      ? currentPartner.name
      : payload.customerId;
    const targetDeptId = payload.companyDepartment?.trim() || null;

    const quoteJson = {
      id: payload.quoteId,
      title: payload.quoteTitle,
      partnerId: payload.customerId,
      customerId: payload.customerId,
      customerName,
      quoteDate: payload.quoteDate,
      validUntil: payload.validUntil.trim() === "" ? null : payload.validUntil,
      status: payload.status,
      totalAmount: payload.totalAmount,
      taxAmount: payload.taxAmount,
      memo: payload.memo.trim() === "" ? null : payload.memo,
      terms: payload.terms.trim() === "" ? null : payload.terms,
      companyDepartment: targetDeptId,
      company_department: targetDeptId,
      salesPersonEmployeeNumber: payload.salesPersonEmployeeNumber || null,
      inputPersonEmployeeNumber: payload.inputPersonEmployeeNumber || null,
      items: payload.items.map((item: any) => ({
        // 明細ID。サーバー側で明細IDを保ったまま更新し、受注明細とのつながりを保つ(新しい明細・改定時は無視される)
        id: item.id ?? null,
        itemId: item.itemId,
        itemName: item.itemName || null,
        inputType: item.inputType,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitCode: item.unitCode || null,
        taxCategoryCode: item.taxCategoryCode || null,
        memo: item.memo || null,
      })),
      attachments: cleanedAttachments,
      isRevisionUp,
      companyName: payload.companyName,
      companyZip: payload.companyZip,
      companyAddress: payload.companyAddress,
      companyTel: payload.companyTel,
      companyFax: payload.companyFax,
      deliveryDate: payload.deliveryDate,
      deliveryPlace: payload.deliveryPlace,
      paymentTerms: payload.paymentTerms,
    };

    const formData = new FormData();
    formData.append("quoteData", JSON.stringify(quoteJson));

    Object.keys(payload.selectedFiles).forEach((key) => {
      const file = payload.selectedFiles[key];
      if (file) formData.append(`files[${file.name}]`, file);
    });

    try {
      const url =
        editingId && !isRevisionUp
          ? `/api/quotes/${editingId}`
          : "/api/quotes/register";
      const data = await apiFetch<{ id?: string }>(url, {
        method: editingId && !isRevisionUp ? "PUT" : "POST",
        body: formData,
        defaultErrorMessage: "データ保存に失敗しました",
      });

      const targetSavedId = data.id || payload.quoteId;

      setMessage(
        isRevisionUp
          ? "見積を改定(新バージョン作成)しました"
          : editingId
            ? "見積情報を更新しました"
            : "見積情報を新規登録しました",
      );

      // 💡 自動遷移(setViewMode("LIST"))を削除し、ワンクッション置くモーダル用データをセット
      setSavedQuoteSummary({
        id: targetSavedId,
        title: payload.quoteTitle || "(件名なし)",
        customerName: customerName,
        totalAmount: payload.totalAmount,
        isRevisionUp,
        // 新規登録・改定はBackendで必ず下書きになる。編集の保存だけが選んだステータスのまま保存される
        isConfirmed: !!editingId && !isRevisionUp && payload.status === "APPROVED",
      });

      // 改定（新バージョン作成）だった場合はフォームを最新IDに追従させる
      if (isRevisionUp && data.id) {
        setEditingId(data.id);
        setQuoteId(data.id);
      }

      void syncQuotes({ ...filters, status: filterStatus });
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Item4-e: 承認済み見積の変更申請。既存の直接保存(PUT)は使わず、
  // 変更内容(header+items)を退避データとして/api/approvals/request-updateへ提出する
  // (添付ファイルの変更はこの申請には反映されない、v1の既知の制約)
  const handleSubmitApprovedEditAction = async (payload: any) => {
    if (!editingId) return;
    setError("");
    setMessage("");
    setIsSubmitting(true);

    const hasInvalidItem = payload.items.some(
      (item: any) =>
        !item.itemId || (item.inputType === "DIRECT" && !item.itemName),
    );
    if (hasInvalidItem) {
      setError("品目IDまたは品目名が未入力の明細行があります");
      setIsSubmitting(false);
      return;
    }

    const targetDeptId = payload.companyDepartment?.trim() || null;

    const header = {
      title: payload.quoteTitle,
      partnerId: payload.customerId,
      quoteDate: payload.quoteDate,
      validUntil: payload.validUntil.trim() === "" ? null : payload.validUntil,
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
      paymentTerms: payload.paymentTerms,
    };

    const items = payload.items.map((item: any) => ({
      // 明細ID。承認時に明細IDを保ったまま更新し、受注明細とのつながりを保つ
      id: item.id ?? null,
      itemId: item.itemId,
      itemName: item.itemName || null,
      inputType: item.inputType || null,
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
          targetType: "sales_quotes",
          targetId: editingId,
          requestType: "UPDATE",
          payload: { header, items },
          applicantDepartmentSurrogateId,
          comment: `見積[${editingId}]の変更申請`,
        },
        defaultErrorMessage: "変更の申請に失敗しました",
      });

      setMessage("見積の変更を申請しました");
      void syncQuotes({ ...filters, status: filterStatus });
      setViewMode("LIST");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    savedQuoteSummary,
    setSavedQuoteSummary,
    handleFormSubmitAction,
    handleSubmitApprovedEditAction,
  };
}
