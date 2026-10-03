import { useState, useEffect } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { PurchaseRecognitionRecord } from "../_types";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface UsePurchaseRecognitionListActionsProps {
  canDelete: boolean;
  syncRecognitions: (filters: Record<string, string>) => Promise<void>;
  handleImportCSV: (file: File) => Promise<boolean>;
  handleDeleteRecognition: (id: string) => Promise<boolean>;
  handleSubmitForApproval: (
    id: string,
    applicantDepartmentSurrogateId?: string | null,
  ) => Promise<boolean>;
  setMessage: (msg: string) => void;
  setError: (msg: string) => void;
  applicantDepartmentSurrogateId?: string | null;
}

// Item10: sales/invoices/_hooks/useSalesInvoiceListActions.tsと同じ構成
// (メール一括送信・Ver.UP系列表示は対象外)
export function usePurchaseRecognitionListActions({
  canDelete,
  syncRecognitions,
  handleImportCSV,
  handleDeleteRecognition,
  handleSubmitForApproval,
  setMessage,
  setError,
  applicantDepartmentSurrogateId,
}: UsePurchaseRecognitionListActionsProps) {
  const confirm = useConfirm();
  const [viewMode, setViewMode] = useState<"LIST" | "FORM">("LIST");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [previewRecognition, setPreviewRecognition] = useState<any | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [recognitionId, setRecognitionId] = useState("");
  const [initialFormData, setInitialFormData] = useState<any | null>(null);
  // 追加要望L-2-a: 元の仕入から「赤伝を起票」するときの元伝票(フォームへプレフィルする)
  const [redSlipSource, setRedSlipSource] = useState<any | null>(null);

  const [filters, setFilters] = useState({
    id: "",
    title: "",
    partnerId: "",
    itemName: "",
    documentType: "",
    startDate: "",
    endDate: "",
    purchasePerson: "",
  });

  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedFilters = useDebouncedValue(filters);
  useEffect(() => {
    void syncRecognitions({ ...debouncedFilters, status: filterStatus });
  }, [debouncedFilters, filterStatus, syncRecognitions]);

  const handleClearSearch = () => {
    setFilters({
      id: "",
      title: "",
      partnerId: "",
      itemName: "",
      documentType: "",
      startDate: "",
      endDate: "",
      purchasePerson: "",
    });
    setFilterStatus("all");
  };

  const handleOpenNewForm = () => {
    setRedSlipSource(null);
    setEditingId(null);
    setInitialFormData(null);
    setRecognitionId("");
    setViewMode("FORM");
  };

  // 追加要望L-2-a: 元の仕入の内容を、赤伝(訂正)としてプレフィルした新規フォームを開く(保存するまで登録されない)
  const handleIssueRedSlip = async (id: string) => {
    try {
      setError("");
      setMessage("");
      const data = await apiFetch<PurchaseRecognitionRecord>(`/api/purchase-recognitions/${id}`, {
        defaultErrorMessage: "元の仕入の取得に失敗しました",
      });
      setEditingId(null);
      setRecognitionId("");
      setInitialFormData(null);
      setRedSlipSource(data);
      setViewMode("FORM");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleOpenEditForm = async (id: string) => {
    try {
      setRedSlipSource(null);
      setError("");
      setMessage("");
      const data = await apiFetch<PurchaseRecognitionRecord>(`/api/purchase-recognitions/${id}`, {
        defaultErrorMessage: "詳細データの取得に失敗しました",
      });

      setEditingId(data.id);
      setRecognitionId(data.id);
      setInitialFormData(data);
      setViewMode("FORM");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleOpenPreview = async (id: string) => {
    try {
      const data = await apiFetch(`/api/purchase-recognitions/${id}`, {
        defaultErrorMessage: "仕入詳細情報の取得に失敗しました",
      });
      setPreviewRecognition(data);
    } catch (err) {
      if (err instanceof Error) setError(`詳細取得エラー: ${err.message}`);
    }
  };

  const handleCSVImportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !(await confirm(
        `選択したCSVファイル [ ${file.name} ] を読み込んで、仕入データをCSVインポート(登録・同期)しますか？\n※既存の同一コードデータは明細含め上書きされます。`,
      ))
    ) {
      e.target.value = "";
      return;
    }

    const success = await handleImportCSV(file);
    if (success) {
      void syncRecognitions({ ...filters, status: filterStatus });
    }
    e.target.value = "";
  };

  const handleGeneratePDF = async (id: string) => {
    if (!(await confirm(`現在表示中の仕入 [ ${id} ] から仕入計上書PDFを自動生成しますか？`))) return;

    setMessage("⌛ PDFファイルを生成中...");
    setError("");
    try {
      await apiFetch(`/api/purchase-recognitions/${id}/generate-pdf`, {
        method: "POST",
        defaultErrorMessage: "PDF生成に失敗しました",
      });

      setMessage("✅ 仕入計上書PDFの生成に成功しました。添付ファイル欄をご確認ください。");
      void handleOpenEditForm(id);
      void syncRecognitions({ ...filters, status: filterStatus });
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF生成に失敗しました");
      setMessage("");
    }
  };

  const handleSubmitForApprovalAction = async (id: string) => {
    setError("");
    setMessage("");
    const success = await handleSubmitForApproval(id, applicantDepartmentSurrogateId);
    if (success) {
      void syncRecognitions({ ...filters, status: filterStatus });
      setViewMode("LIST");
    }
  };

  const handleDeleteAction = async (id: string) => {
    if (!canDelete) return;
    if (
      !(await confirm(
        `仕入 [ ${id} ] を削除します(下書きは直接削除、承認済みは削除承認申請になります)。よろしいですか？`,
      ))
    )
      return;
    const success = await handleDeleteRecognition(id);
    if (success) {
      void syncRecognitions({ ...filters, status: filterStatus });
    }
  };

  return {
    viewMode,
    setViewMode,
    filterStatus,
    setFilterStatus,
    previewRecognition,
    setPreviewRecognition,
    editingId,
    setEditingId,
    recognitionId,
    setRecognitionId,
    initialFormData,
    filters,
    setFilters,
    handleClearSearch,
    handleOpenNewForm,
    handleOpenEditForm,
    handleIssueRedSlip,
    redSlipSource,
    handleOpenPreview,
    handleCSVImportChange,
    handleGeneratePDF,
    handleSubmitForApprovalAction,
    handleDeleteAction,
  };
}
