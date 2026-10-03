import { useState, useEffect } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { SalesInvoiceRecord } from "../_types";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface UseSalesInvoiceListActionsProps {
  canDelete: boolean;
  syncInvoices: (filters: Record<string, string>) => Promise<void>;
  handleImportCSV: (file: File) => Promise<boolean>;
  handleDeleteInvoice: (id: string) => Promise<boolean>;
  handleSubmitForApproval: (
    id: string,
    applicantDepartmentSurrogateId?: string | null,
  ) => Promise<boolean>;
  // K-4-1: 一覧からの一括メール送信
  handleBulkMailSend: (ids: string[]) => Promise<boolean>;
  setMessage: (msg: string) => void;
  setError: (msg: string) => void;
  applicantDepartmentSurrogateId?: string | null;
}

// Item8: quotes/_hooks/useQuoteListActions.tsと同じ構成。K-4-1でメール一括送信の選択状態を追加
// (Ver.UP系列表示は非対象のまま、sales_invoicesには元々その概念が無いため)
export function useSalesInvoiceListActions({
  canDelete,
  syncInvoices,
  handleImportCSV,
  handleDeleteInvoice,
  handleSubmitForApproval,
  handleBulkMailSend,
  setMessage,
  setError,
  applicantDepartmentSurrogateId,
}: UseSalesInvoiceListActionsProps) {
  const confirm = useConfirm();
  const [viewMode, setViewMode] = useState<"LIST" | "FORM">("LIST");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [previewInvoice, setPreviewInvoice] = useState<any | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [initialFormData, setInitialFormData] = useState<any | null>(null);
  // 追加要望L-2-a: 元の売上から「赤伝を起票」するときの元伝票(フォームへプレフィルする)
  const [redSlipSource, setRedSlipSource] = useState<any | null>(null);

  const [filters, setFilters] = useState({
    id: "",
    title: "",
    partnerId: "",
    itemName: "",
    documentType: "",
    startDate: "",
    endDate: "",
    salesPerson: "",
  });

  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedFilters = useDebouncedValue(filters);
  useEffect(() => {
    void syncInvoices({ ...debouncedFilters, status: filterStatus });
  }, [debouncedFilters, filterStatus, syncInvoices]);

  const handleClearSearch = () => {
    setFilters({
      id: "",
      title: "",
      partnerId: "",
      itemName: "",
      documentType: "",
      startDate: "",
      endDate: "",
      salesPerson: "",
    });
    setFilterStatus("all");
  };

  const handleOpenNewForm = () => {
    setRedSlipSource(null);
    setEditingId(null);
    setInitialFormData(null);
    setInvoiceId("");
    setViewMode("FORM");
  };

  // 追加要望L-2-a: 元の売上の内容を、赤伝(訂正)としてプレフィルした新規フォームを開く(保存するまで登録されない)
  const handleIssueRedSlip = async (id: string) => {
    try {
      setError("");
      setMessage("");
      const data = await apiFetch<SalesInvoiceRecord>(`/api/sales-invoices/${id}`, {
        defaultErrorMessage: "元の売上の取得に失敗しました",
      });
      setEditingId(null);
      setInvoiceId("");
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
      const data = await apiFetch<SalesInvoiceRecord>(`/api/sales-invoices/${id}`, {
        defaultErrorMessage: "詳細データの取得に失敗しました",
      });

      setEditingId(data.id);
      setInvoiceId(data.id);
      setInitialFormData(data);
      setViewMode("FORM");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleOpenPreview = async (id: string) => {
    try {
      const data = await apiFetch(`/api/sales-invoices/${id}`, {
        defaultErrorMessage: "売上詳細情報の取得に失敗しました",
      });
      setPreviewInvoice(data);
    } catch (err) {
      if (err instanceof Error) setError(`詳細取得エラー: ${err.message}`);
    }
  };

  const handleCSVImportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !(await confirm(
        `選択したCSVファイル [ ${file.name} ] を読み込んで、売上データをCSVインポート(登録・同期)しますか？\n※既存の同一コードデータは明細含め上書きされます。`,
      ))
    ) {
      e.target.value = "";
      return;
    }

    const success = await handleImportCSV(file);
    if (success) {
      void syncInvoices({ ...filters, status: filterStatus });
    }
    e.target.value = "";
  };

  const handleGeneratePDF = async (id: string) => {
    if (!(await confirm(`現在表示中の売上 [ ${id} ] から請求書PDFを自動生成しますか？`))) return;

    setMessage("⌛ PDFファイルを生成中...");
    setError("");
    try {
      await apiFetch(`/api/sales-invoices/${id}/generate-pdf`, {
        method: "POST",
        defaultErrorMessage: "PDF生成に失敗しました",
      });

      setMessage("✅ 請求書PDFの生成に成功しました。添付ファイル欄をご確認ください。");
      void handleOpenEditForm(id);
      void syncInvoices({ ...filters, status: filterStatus });
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
      void syncInvoices({ ...filters, status: filterStatus });
      setViewMode("LIST");
    }
  };

  const handleDeleteAction = async (id: string) => {
    if (!canDelete) return;
    if (
      !(await confirm(
        `売上 [ ${id} ] を削除します(下書きは直接削除、承認済みは削除承認申請になります)。よろしいですか？`,
      ))
    )
      return;
    const success = await handleDeleteInvoice(id);
    if (success) {
      void syncInvoices({ ...filters, status: filterStatus });
    }
  };

  const handleBulkMailSendAction = async () => {
    if (selectedInvoiceIds.length === 0) return;
    if (
      !(await confirm(
        `選択された ${selectedInvoiceIds.length} 件の承認済み売上関連書類を一括メール送信してよろしいですか？`,
      ))
    )
      return;
    const success = await handleBulkMailSend(selectedInvoiceIds);
    if (success) {
      setSelectedInvoiceIds([]);
      void syncInvoices({ ...filters, status: filterStatus });
    }
  };

  return {
    viewMode,
    setViewMode,
    filterStatus,
    setFilterStatus,
    selectedInvoiceIds,
    setSelectedInvoiceIds,
    previewInvoice,
    setPreviewInvoice,
    editingId,
    setEditingId,
    invoiceId,
    setInvoiceId,
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
    handleBulkMailSendAction,
  };
}
