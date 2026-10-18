import { useState, useEffect } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { OrderRecord, OrderPrefillData } from "../_types";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";
import { useConfirm } from "../../../_shared/hooks/use-confirm";
import { todayJst } from "../../../_shared/jst-date";

interface UseOrderListActionsProps {
  canDelete: boolean;
  syncOrders: (filters: Record<string, string>) => Promise<void>;
  handleImportCSV: (file: File) => Promise<boolean>;
  handleDeleteOrder: (id: string) => Promise<boolean>;
  handleSubmitForApproval: (
    id: string,
    applicantDepartmentSurrogateId?: string | null,
  ) => Promise<boolean>;
  handleRetryBackorder: (id: string) => Promise<boolean>;
  handleBulkMailSend: (ids: string[]) => Promise<boolean>;
  setMessage: (msg: string) => void;
  setError: (msg: string) => void;
  applicantDepartmentSurrogateId?: string | null;
}

// Item7: quotes/_hooks/useQuoteListActions.tsと同じ方針。
// 見積と違い改定(Ver.UP)の概念が無いため、getSiblingVersions相当は持たない
export function useOrderListActions({
  canDelete,
  syncOrders,
  handleImportCSV,
  handleDeleteOrder,
  handleSubmitForApproval,
  handleRetryBackorder,
  handleBulkMailSend,
  setMessage,
  setError,
  applicantDepartmentSurrogateId,
}: UseOrderListActionsProps) {
  const confirm = useConfirm();
  const [viewMode, setViewMode] = useState<"LIST" | "FORM">("LIST");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [previewOrder, setPreviewOrder] = useState<any | null>(null);
  const [showQuotePicker, setShowQuotePicker] = useState(false);
  const [showBulkShipmentModal, setShowBulkShipmentModal] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState("");
  const [initialFormData, setInitialFormData] = useState<any | null>(null);

  const [filters, setFilters] = useState({
    id: "",
    title: "",
    partnerId: "",
    itemName: "",
    startDate: "",
    endDate: "",
    salesPerson: "",
    hasBackorder: "",
    hasUnrecognizedSales: "",
  });

  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedFilters = useDebouncedValue(filters);
  useEffect(() => {
    void syncOrders({ ...debouncedFilters, status: filterStatus });
  }, [debouncedFilters, filterStatus, syncOrders]);

  const handleClearSearch = () => {
    setFilters({
      id: "",
      title: "",
      partnerId: "",
      itemName: "",
      startDate: "",
      endDate: "",
      salesPerson: "",
      hasBackorder: "",
      hasUnrecognizedSales: "",
    });
    setFilterStatus("all");
  };

  // 伝票番号フォーマット統一化: 従来はここでクライアント側に仮ID(SO-YYYY-NNNN)を生成していたが、
  // 会社設定(document_number_formats)で種別ごとに制御できるようバックエンド側の採番に統一した。
  // 新規作成時はorderIdを空のままにし、実際の番号は保存後のレスポンスから得る
  const handleOpenNewForm = () => {
    setEditingId(null);
    setInitialFormData(null);
    setOrderId("");
    setViewMode("FORM");
  };

  // Item7: 見積からの受注作成(QuotePickerModal)は、この時点ではDBに一切書き込まない。
  // 白紙作成と同じ「新規(editingId=null)」の状態で、フォームへ初期値だけ渡して確認・調整してもらい、
  // 実際の登録はフォームの通常の保存操作(handleFormSubmitAction)で初めて行われる
  const handlePrefillFromQuote = (data: OrderPrefillData) => {
    setEditingId(null);
    setInitialFormData(data);
    setOrderId("");
    setShowQuotePicker(false);
    setViewMode("FORM");
  };

  // 新規要望(2026-10-18): 過去の受注を複写して新規作成フォームを開く(見積からの受注作成と同じく、
  // この時点ではDBに書き込まず保存時に新しい受注番号で登録される)。番号・ステータス・承認情報・添付・
  // 前受・明細ID・見積とのつながり・倉庫の引当指定・明細の納期は引き継がない(入力担当者はuseOrderForm側で
  // ログインユーザーを既定値にする)
  const handleCopyToNewForm = async (id: string) => {
    try {
      setError("");
      setMessage("");
      const data = await apiFetch<OrderRecord>(`/api/sales-orders/${id}`, {
        defaultErrorMessage: "複写元の受注の取得に失敗しました",
      });
      // APIの明細はOrderItemの型に無いid/salesOrderIdも含むため、それらも明示的に外す
      const copied: OrderRecord = {
        ...data,
        id: "",
        title: `${data.title || ""}(コピー)`,
        status: "DRAFT",
        orderDate: todayJst(),
        sourceQuoteId: null,
        isPrepaid: false,
        prepaidAt: null,
        attachments: [],
        items: (data.items || []).map((item) => ({
          ...item,
          id: undefined,
          salesOrderId: undefined,
          sourceQuoteItemId: null,
          warehouseAllocationRequest: null,
          backorderedQuantity: undefined,
          deliveryDate: null,
        })),
      };
      setEditingId(null);
      setOrderId("");
      setInitialFormData(copied);
      setViewMode("FORM");
      setMessage(`受注[${id}]を複写しました。内容を確認して保存してください`);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleOpenEditForm = async (id: string) => {
    try {
      setError("");
      setMessage("");
      const data = await apiFetch<OrderRecord>(`/api/sales-orders/${id}`, {
        defaultErrorMessage: "詳細データの取得に失敗しました",
      });

      setEditingId(data.id);
      setOrderId(data.id);
      setInitialFormData(data);
      setViewMode("FORM");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleOpenPreview = async (id: string) => {
    try {
      const data = await apiFetch(`/api/sales-orders/${id}`, {
        defaultErrorMessage: "受注詳細情報の取得に失敗しました",
      });
      setPreviewOrder(data);
    } catch (err) {
      if (err instanceof Error) setError(`詳細取得エラー: ${err.message}`);
    }
  };

  const handleCSVImportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !(await confirm(
        `選択したCSVファイル [ ${file.name} ] を読み込んで、受注データをCSVインポート(登録・同期)しますか？\n※既存の同一コードデータは明細含め上書きされます。`,
      ))
    ) {
      e.target.value = "";
      return;
    }

    const success = await handleImportCSV(file);
    if (success) {
      void syncOrders({ ...filters, status: filterStatus });
    }
    e.target.value = "";
  };

  const handleGeneratePDF = async (id: string) => {
    if (!(await confirm(`現在表示中の受注 [ ${id} ] から注文請書PDFを自動生成しますか？`))) return;

    setMessage("⌛ PDFファイルを生成中...");
    setError("");
    try {
      await apiFetch(`/api/sales-orders/${id}/generate-pdf`, {
        method: "POST",
        defaultErrorMessage: "PDF生成に失敗しました",
      });

      setMessage("✅ 注文請書PDFの生成に成功しました。添付ファイル欄をご確認ください。");
      void handleOpenEditForm(id);
      void syncOrders({ ...filters, status: filterStatus });
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF生成に失敗しました");
      setMessage("");
    }
  };

  const handleSubmitForApprovalAction = async (id: string) => {
    setError("");
    setMessage("");
    const success = await handleSubmitForApproval(
      id,
      applicantDepartmentSurrogateId,
    );
    if (success) {
      void syncOrders({ ...filters, status: filterStatus });
      setViewMode("LIST");
    }
  };

  // Item7残課題2-5: バックオーダーの手動再引当
  const handleRetryBackorderAction = async (id: string) => {
    setError("");
    setMessage("");
    const success = await handleRetryBackorder(id);
    if (success) {
      void syncOrders({ ...filters, status: filterStatus });
    }
  };

  const handleDeleteAction = async (id: string) => {
    if (!canDelete) return;
    if (
      !(await confirm(`受注 [ ${id} ] を削除します(下書きは直接削除、承認済みは削除承認申請になります)。よろしいですか？`))
    )
      return;
    const success = await handleDeleteOrder(id);
    if (success) {
      void syncOrders({ ...filters, status: filterStatus });
    }
  };

  const handleBulkMailSendAction = async () => {
    if (selectedOrderIds.length === 0) return;
    if (!(await confirm(`選択された ${selectedOrderIds.length} 件の承認済み注文請書を一括メール送信してよろしいですか？`)))
      return;
    const success = await handleBulkMailSend(selectedOrderIds);
    if (success) {
      setSelectedOrderIds([]);
      void syncOrders({ ...filters, status: filterStatus });
    }
  };

  const handleOpenBulkShipmentModal = () => {
    if (selectedOrderIds.length === 0) return;
    setShowBulkShipmentModal(true);
  };

  return {
    viewMode,
    setViewMode,
    filterStatus,
    setFilterStatus,
    selectedOrderIds,
    setSelectedOrderIds,
    previewOrder,
    setPreviewOrder,
    showQuotePicker,
    setShowQuotePicker,
    showBulkShipmentModal,
    setShowBulkShipmentModal,
    handleOpenBulkShipmentModal,
    editingId,
    setEditingId,
    orderId,
    setOrderId,
    initialFormData,
    filters,
    setFilters,
    handleClearSearch,
    handleOpenNewForm,
    handlePrefillFromQuote,
    handleCopyToNewForm,
    handleOpenEditForm,
    handleOpenPreview,
    handleCSVImportChange,
    handleGeneratePDF,
    handleSubmitForApprovalAction,
    handleRetryBackorderAction,
    handleDeleteAction,
    handleBulkMailSendAction,
  };
}
