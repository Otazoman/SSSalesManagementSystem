import { useState, useEffect } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { QuoteRecord } from "../_types";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface UseQuoteListActionsProps {
  quotes: QuoteRecord[];
  canDelete: boolean;
  syncQuotes: (filters: Record<string, string>) => Promise<void>;
  handleImportCSV: (file: File) => Promise<boolean>;
  handleDeleteQuote: (id: string) => Promise<boolean>;
  handleSubmitForApproval: (
    id: string,
    applicantDepartmentSurrogateId?: string | null,
  ) => Promise<boolean>;
  handleBulkMailSend: (ids: string[]) => Promise<boolean>;
  setMessage: (msg: string) => void;
  setError: (msg: string) => void;
  applicantDepartmentSurrogateId?: string | null;
}

// Item4-f: page.tsxから分割。一覧画面の表示状態(絞り込み・選択・プレビュー・編集対象)と
// 一覧画面上の各種操作ハンドラ(CSVインポート・PDF生成・削除・承認申請・一括メール送信)を担当
export function useQuoteListActions({
  quotes,
  canDelete,
  syncQuotes,
  handleImportCSV,
  handleDeleteQuote,
  handleSubmitForApproval,
  handleBulkMailSend,
  setMessage,
  setError,
  applicantDepartmentSurrogateId,
}: UseQuoteListActionsProps) {
  const confirm = useConfirm();
  const [viewMode, setViewMode] = useState<"LIST" | "FORM">("LIST");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedQuoteIds, setSelectedQuoteIds] = useState<string[]>([]);
  const [previewQuote, setPreviewQuote] = useState<any | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState("");
  const [initialFormData, setInitialFormData] = useState<any | null>(null);

  const [filters, setFilters] = useState({
    id: "",
    title: "",
    partnerId: "",
    itemName: "",
    startDate: "",
    endDate: "",
    salesPerson: "",
  });

  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedFilters = useDebouncedValue(filters);
  useEffect(() => {
    void syncQuotes({ ...debouncedFilters, status: filterStatus });
  }, [debouncedFilters, filterStatus, syncQuotes]);

  const handleClearSearch = () => {
    setFilters({
      id: "",
      title: "",
      partnerId: "",
      itemName: "",
      startDate: "",
      endDate: "",
      salesPerson: "",
    });
    setFilterStatus("all");
  };

  // 伝票番号フォーマット統一化: 従来はここでクライアント側に仮ID(QT-YYYY-NNNN-0)を生成していたが、
  // 会社設定(document_number_formats)で種別ごとに制御できるようバックエンド側の採番に統一した。
  // 新規作成時はquoteIdを空のままにし、実際の番号は保存後のレスポンスから得る
  // (末尾の"-1"はバックエンド側で付与、Ver.UP機構の前提を維持する)
  const handleOpenNewForm = () => {
    setEditingId(null);
    setInitialFormData(null);
    setQuoteId("");
    setViewMode("FORM");
  };

  const handleOpenEditForm = async (id: string) => {
    try {
      setError("");
      setMessage("");
      const data = await apiFetch<QuoteRecord>(`/api/quotes/${id}`, {
        defaultErrorMessage: "詳細データの取得に失敗しました",
      });

      setEditingId(data.id);
      setQuoteId(data.id);
      setInitialFormData(data);
      setViewMode("FORM");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleOpenPreview = async (id: string) => {
    try {
      const data = await apiFetch(`/api/quotes/${id}`, {
        defaultErrorMessage: "見積詳細情報の取得に失敗しました",
      });
      setPreviewQuote(data); // 取得したデータをセットしてプレビューを起動
    } catch (err) {
      if (err instanceof Error) setError(`詳細取得エラー: ${err.message}`);
    }
  };

  // CSV インポートのファイルハンドラー
  const handleCSVImportChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !(await confirm(
        `選択したCSVファイル [ ${file.name} ] を読み込んで、見積データをCSVインポート(登録・同期)しますか？\n※既存の同一コードデータは明細含め上書きされます。`,
      ))
    ) {
      e.target.value = "";
      return;
    }

    const success = await handleImportCSV(file);
    if (success) {
      void syncQuotes({ ...filters, status: filterStatus });
    }
    e.target.value = "";
  };

  const handleGeneratePDF = async (id: string) => {
    if (
      !(await confirm(
        `現在表示中の見積バージョン [ ${id} ] から正式なPDF帳票を自動生成しますか？`,
      ))
    )
      return;

    setMessage("⌛ PDFファイルを生成中...");
    setError("");
    try {
      await apiFetch(`/api/quotes/${id}/generate-pdf`, {
        method: "POST",
        defaultErrorMessage: "PDF生成に失敗しました",
      });

      setMessage(
        "✅ PDF見積書の生成に成功しました。添付ファイル欄をご確認ください。",
      );
      void handleOpenEditForm(id);
      void syncQuotes({ ...filters, status: filterStatus });
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF生成に失敗しました");
      setMessage("");
    }
  };

  // Item4-e: 下書きの承認申請(承認機能OFF時はバックエンド側で直接確定される)
  const handleSubmitForApprovalAction = async (id: string) => {
    setError("");
    setMessage("");
    const success = await handleSubmitForApproval(
      id,
      applicantDepartmentSurrogateId,
    );
    if (success) {
      void syncQuotes({ ...filters, status: filterStatus });
      setViewMode("LIST");
    }
  };

  const handleDeleteAction = async (id: string) => {
    if (!canDelete) return;
    if (
      !(await confirm(
        `見積 [ ${id} ] を削除します(下書きは直接削除、承認済みは削除承認申請になります)。よろしいですか？`,
      ))
    )
      return;
    const success = await handleDeleteQuote(id);
    if (success) {
      void syncQuotes({ ...filters, status: filterStatus });
    }
  };

  const handleBulkMailSendAction = async () => {
    if (selectedQuoteIds.length === 0) return;
    if (
      !(await confirm(
        `選択された ${selectedQuoteIds.length} 件の承認済み見積書を一括メール送信してよろしいですか？`,
      ))
    )
      return;
    const success = await handleBulkMailSend(selectedQuoteIds);
    if (success) {
      setSelectedQuoteIds([]);
      void syncQuotes({ ...filters, status: filterStatus });
    }
  };

  const getSiblingVersions = () => {
    if (!quoteId) return [];
    const lastHyphenIndex = quoteId.lastIndexOf("-");
    const currentBaseId =
      lastHyphenIndex !== -1 ? quoteId.substring(0, lastHyphenIndex) : quoteId;

    return quotes
      .filter((q) => {
        const idx = q.id.lastIndexOf("-");
        const bId = idx !== -1 ? q.id.substring(0, idx) : q.id;
        return bId === currentBaseId;
      })
      .sort((a, b) => {
        const getRevNum = (id: string) => {
          const parts = id.split("-");
          const num = parseInt(parts[parts.length - 1], 10);
          return isNaN(num) ? 0 : num;
        };
        return getRevNum(b.id) - getRevNum(a.id);
      });
  };

  return {
    viewMode,
    setViewMode,
    filterStatus,
    setFilterStatus,
    selectedQuoteIds,
    setSelectedQuoteIds,
    previewQuote,
    setPreviewQuote,
    editingId,
    setEditingId,
    quoteId,
    setQuoteId,
    initialFormData,
    filters,
    setFilters,
    handleClearSearch,
    handleOpenNewForm,
    handleOpenEditForm,
    handleOpenPreview,
    handleCSVImportChange,
    handleGeneratePDF,
    handleSubmitForApprovalAction,
    handleDeleteAction,
    handleBulkMailSendAction,
    getSiblingVersions,
  };
}
