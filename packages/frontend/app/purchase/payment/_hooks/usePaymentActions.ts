import { useState, useEffect } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { PaymentDetail, UnpaidPurchaseRecognition, CandidateItemReceipt } from "../_types";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";
import { todayJst } from "../../../_shared/jst-date";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface UsePaymentActionsProps {
  syncPayments: (filters: Record<string, string>) => Promise<void>;
  handleImportCSV: (file: File) => Promise<boolean>;
  setMessage: (msg: string) => void;
  setError: (msg: string) => void;
}

// K-5-1: 検収から選択した際の選択行(発注非依存の検収はamount/taxAmountを画面側で入力する)
export interface ItemReceiptSelectionForm {
  id: string;
  amount: string;
  taxAmount: string;
  requiresManualAmount: boolean;
}

// K-5-3: 完全手動入力の明細行(入力中は文字列で保持し、送信時に数値変換する)
export interface ManualPaymentItemForm {
  itemName: string;
  amount: string;
  taxAmount: string;
}

interface CreatePaymentForm {
  partnerId: string;
  mode: "PER_TRANSACTION" | "PERIODIC";
  paymentDate: string;
  periodStart: string;
  periodEnd: string;
  title: string;
  memo: string;
  purchaseRecognitionIds: string[];
  itemReceiptSelections: ItemReceiptSelectionForm[];
  manualItems: ManualPaymentItemForm[];
}

const EMPTY_MANUAL_ITEM: ManualPaymentItemForm = {
  itemName: "",
  amount: "0",
  taxAmount: "0",
};

// ファームバンキング: 振込データ作成前の確認結果
export interface FirmBankingPreviewResult {
  recordCount: number;
  totalAmount: number;
  warnings: string[];
}

const INITIAL_CREATE_FORM: CreatePaymentForm = {
  partnerId: "",
  mode: "PER_TRANSACTION",
  paymentDate: todayJst(),
  periodStart: "",
  periodEnd: "",
  title: "",
  memo: "",
  purchaseRecognitionIds: [],
  itemReceiptSelections: [],
  manualItems: [],
};

// Item10 Phase5: sales/billing/_hooks/useBillingActions.tsと同じ方針。
// 支払は編集フォームを持たず、一覧・作成モーダル・詳細モーダルの3画面構成とする
export function usePaymentActions({
  syncPayments,
  handleImportCSV,
  setMessage,
  setError,
}: UsePaymentActionsProps) {
  const confirm = useConfirm();
  const [filterMode, setFilterMode] = useState<string>("all");
  const [filterReconciliationStatus, setFilterReconciliationStatus] = useState<string>("all");
  const [filters, setFilters] = useState({
    id: "",
    title: "",
    partnerId: "",
    startDate: "",
    endDate: "",
  });

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreatePaymentForm>(INITIAL_CREATE_FORM);
  const [candidateRecognitions, setCandidateRecognitions] = useState<UnpaidPurchaseRecognition[]>([]);
  const [candidateItemReceipts, setCandidateItemReceipts] = useState<CandidateItemReceipt[]>([]);

  const [detail, setDetail] = useState<PaymentDetail | null>(null);

  // ファームバンキング: 一覧での選択+振込データ作成モーダルの状態
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<string[]>([]);
  const [isFirmBankingModalOpen, setIsFirmBankingModalOpen] = useState(false);
  const [firmBankingTransferDate, setFirmBankingTransferDate] = useState(
    todayJst(),
  );
  const [firmBankingPreview, setFirmBankingPreview] = useState<FirmBankingPreviewResult | null>(null);
  const [isFirmBankingLoading, setIsFirmBankingLoading] = useState(false);

  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedFilters = useDebouncedValue(filters);
  useEffect(() => {
    void syncPayments({
      ...debouncedFilters,
      mode: filterMode === "all" ? "" : filterMode,
      reconciliationStatus: filterReconciliationStatus === "all" ? "" : filterReconciliationStatus,
    });
  }, [debouncedFilters, filterMode, filterReconciliationStatus, syncPayments]);

  const handleClearSearch = () => {
    setFilters({ id: "", title: "", partnerId: "", startDate: "", endDate: "" });
    setFilterMode("all");
    setFilterReconciliationStatus("all");
  };

  const handleOpenDetail = async (id: string) => {
    try {
      setError("");
      const data = await apiFetch<PaymentDetail>(`/api/purchase-payments/${id}`, {
        defaultErrorMessage: "支払詳細の取得に失敗しました",
      });
      setDetail(data);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleCloseDetail = () => setDetail(null);

  // K-5-2: 支払モジュール側で発注の前払実績(isAdvancePrepaid)まで判定した候補一覧を返す
  // 専用エンドポイントに切り替え(汎用の/api/purchase-recognitionsは前払判定を持たないため)
  const fetchCandidateRecognitions = async (partnerId: string) => {
    if (!partnerId) {
      setCandidateRecognitions([]);
      return;
    }
    try {
      const data = await apiFetch<UnpaidPurchaseRecognition[]>(
        `/api/purchase-payments/candidate-recognitions?partnerId=${partnerId}`,
      );
      setCandidateRecognitions(data);
    } catch (err) {
      console.error("支払対象の仕入一覧取得に失敗しました", err);
      setCandidateRecognitions([]);
    }
  };

  // K-5-1: 「検収から選択」タブ用の候補一覧取得
  const fetchCandidateItemReceipts = async (partnerId: string) => {
    if (!partnerId) {
      setCandidateItemReceipts([]);
      return;
    }
    try {
      const data = await apiFetch<CandidateItemReceipt[]>(
        `/api/purchase-payments/candidate-item-receipts?partnerId=${partnerId}`,
      );
      setCandidateItemReceipts(data);
    } catch (err) {
      console.error("支払対象の検収記録一覧取得に失敗しました", err);
      setCandidateItemReceipts([]);
    }
  };

  const handleOpenCreateModal = () => {
    setCreateForm(INITIAL_CREATE_FORM);
    setCandidateRecognitions([]);
    setCandidateItemReceipts([]);
    setIsCreateModalOpen(true);
  };

  const handleCloseCreateModal = () => {
    setIsCreateModalOpen(false);
  };

  const handleCreateFormPartnerChange = (partnerId: string) => {
    setCreateForm((prev) => ({
      ...prev,
      partnerId,
      purchaseRecognitionIds: [],
      itemReceiptSelections: [],
      manualItems: [],
    }));
    void fetchCandidateRecognitions(partnerId);
    void fetchCandidateItemReceipts(partnerId);
  };

  const handleToggleCandidateRecognition = (id: string) => {
    setCreateForm((prev) => {
      const isSelected = prev.purchaseRecognitionIds.includes(id);
      if (prev.mode === "PER_TRANSACTION") {
        return {
          ...prev,
          purchaseRecognitionIds: isSelected ? [] : [id],
          itemReceiptSelections: isSelected ? prev.itemReceiptSelections : [],
          manualItems: isSelected ? prev.manualItems : [],
        };
      }
      return {
        ...prev,
        purchaseRecognitionIds: isSelected
          ? prev.purchaseRecognitionIds.filter((x) => x !== id)
          : [...prev.purchaseRecognitionIds, id],
      };
    });
  };

  // K-5-1: 検収記録の選択トグル(候補一覧の自動計算可否をそのままフォームへ引き継ぐ)
  const handleToggleCandidateItemReceipt = (candidate: CandidateItemReceipt) => {
    setCreateForm((prev) => {
      const isSelected = prev.itemReceiptSelections.some((s) => s.id === candidate.id);
      const newSelection: ItemReceiptSelectionForm = {
        id: candidate.id,
        amount: candidate.computedAmount != null ? String(candidate.computedAmount) : "0",
        taxAmount: candidate.computedTaxAmount != null ? String(candidate.computedTaxAmount) : "0",
        requiresManualAmount: candidate.requiresManualAmount,
      };
      if (prev.mode === "PER_TRANSACTION") {
        return {
          ...prev,
          itemReceiptSelections: isSelected ? [] : [newSelection],
          purchaseRecognitionIds: isSelected ? prev.purchaseRecognitionIds : [],
          manualItems: isSelected ? prev.manualItems : [],
        };
      }
      return {
        ...prev,
        itemReceiptSelections: isSelected
          ? prev.itemReceiptSelections.filter((s) => s.id !== candidate.id)
          : [...prev.itemReceiptSelections, newSelection],
      };
    });
  };

  // K-5-1: 発注非依存の検収記録の金額を画面側で直接入力する
  const handleItemReceiptAmountChange = (
    id: string,
    field: "amount" | "taxAmount",
    value: string,
  ) => {
    setCreateForm((prev) => ({
      ...prev,
      itemReceiptSelections: prev.itemReceiptSelections.map((s) =>
        s.id === id ? { ...s, [field]: value } : s,
      ),
    }));
  };

  // K-5-3: 完全手動入力の明細行編集
  const handleAddManualItem = () => {
    setCreateForm((prev) => ({
      ...prev,
      manualItems: [...prev.manualItems, { ...EMPTY_MANUAL_ITEM }],
      // PER_TRANSACTIONでは他の選択との排他(合計1件のみ)のため、追加時にクリアする
      purchaseRecognitionIds: prev.mode === "PER_TRANSACTION" ? [] : prev.purchaseRecognitionIds,
      itemReceiptSelections: prev.mode === "PER_TRANSACTION" ? [] : prev.itemReceiptSelections,
    }));
  };

  const handleRemoveManualItem = (index: number) => {
    setCreateForm((prev) => ({
      ...prev,
      manualItems: prev.manualItems.filter((_, i) => i !== index),
    }));
  };

  const handleManualItemChange = (
    index: number,
    field: keyof ManualPaymentItemForm,
    value: string,
  ) => {
    setCreateForm((prev) => ({
      ...prev,
      manualItems: prev.manualItems.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    }));
  };

  const handleSubmitCreatePayment = async () => {
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<{ message?: string; id?: string }>("/api/purchase-payments/register", {
        method: "POST",
        json: {
          partnerId: createForm.partnerId,
          mode: createForm.mode,
          paymentDate: createForm.paymentDate,
          periodStart: createForm.mode === "PERIODIC" ? createForm.periodStart : null,
          periodEnd: createForm.mode === "PERIODIC" ? createForm.periodEnd : null,
          title: createForm.title || null,
          memo: createForm.memo || null,
          purchaseRecognitionIds: createForm.purchaseRecognitionIds,
          itemReceipts: createForm.itemReceiptSelections.map((s) => ({
            id: s.id,
            amount: s.requiresManualAmount ? Number(s.amount) || 0 : undefined,
            taxAmount: s.requiresManualAmount ? Number(s.taxAmount) || 0 : undefined,
          })),
          manualItems: createForm.manualItems.map((item) => ({
            itemName: item.itemName,
            amount: Number(item.amount) || 0,
            taxAmount: Number(item.taxAmount) || 0,
          })),
        },
        defaultErrorMessage: "支払の作成に失敗しました",
      });
      setMessage(data.message || "支払を作成しました");
      setIsCreateModalOpen(false);
      void syncPayments({
        ...filters,
        mode: filterMode === "all" ? "" : filterMode,
        reconciliationStatus: filterReconciliationStatus === "all" ? "" : filterReconciliationStatus,
      });
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
    }
  };

  const handleRecordDisbursement = async (
    paymentHeaderId: string,
    payload: { paidDate: string; amount: number; method: string; memo?: string },
  ) => {
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<{ message?: string }>(
        `/api/purchase-payments/${paymentHeaderId}/disbursements`,
        {
          method: "POST",
          json: payload,
          defaultErrorMessage: "支払消込の記録に失敗しました",
        },
      );
      setMessage(data.message || "支払消込を記録しました");
      void handleOpenDetail(paymentHeaderId);
      void syncPayments({
        ...filters,
        mode: filterMode === "all" ? "" : filterMode,
        reconciliationStatus: filterReconciliationStatus === "all" ? "" : filterReconciliationStatus,
      });
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
    }
  };

  // ファームバンキング: 一覧での選択トグル
  const handleToggleSelectPayment = (id: string) => {
    setSelectedPaymentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleOpenFirmBankingModal = () => {
    setFirmBankingPreview(null);
    setFirmBankingTransferDate(todayJst());
    setIsFirmBankingModalOpen(true);
  };

  const handleCloseFirmBankingModal = () => {
    setIsFirmBankingModalOpen(false);
    setFirmBankingPreview(null);
  };

  const handlePreviewFirmBanking = async () => {
    setError("");
    setIsFirmBankingLoading(true);
    try {
      const data = await apiFetch<FirmBankingPreviewResult>(
        "/api/purchase-payments/firm-banking-preview",
        {
          method: "POST",
          json: { paymentHeaderIds: selectedPaymentIds, transferDate: firmBankingTransferDate },
          defaultErrorMessage: "振込データの確認に失敗しました",
        },
      );
      setFirmBankingPreview(data);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsFirmBankingLoading(false);
    }
  };

  // apiFetchはJSONレスポンス前提のため、バイナリファイルはhandleExportCSVと同じく生fetchで扱う
  const handleDownloadFirmBanking = async () => {
    setError("");
    setMessage("");
    setIsFirmBankingLoading(true);
    try {
      const res = await fetch("/api/purchase-payments/firm-banking-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          paymentHeaderIds: selectedPaymentIds,
          transferDate: firmBankingTransferDate,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "振込データファイルの作成に失敗しました");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `furikomi_${firmBankingTransferDate.replace(/-/g, "")}.txt`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setMessage("ファームバンキング振込データファイルをダウンロードしました");
      setIsFirmBankingModalOpen(false);
      setSelectedPaymentIds([]);
      void syncPayments({
        ...filters,
        mode: filterMode === "all" ? "" : filterMode,
        reconciliationStatus: filterReconciliationStatus === "all" ? "" : filterReconciliationStatus,
      });
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsFirmBankingLoading(false);
    }
  };

  const handleCSVImportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !(await confirm(
        `選択したCSVファイル [ ${file.name} ] を読み込んで、支払データをCSVインポート(登録・同期)しますか？\n※既存の同一コードデータは明細含め上書きされます。`,
      ))
    ) {
      e.target.value = "";
      return;
    }

    const success = await handleImportCSV(file);
    if (success) {
      void syncPayments({
        ...filters,
        mode: filterMode === "all" ? "" : filterMode,
        reconciliationStatus: filterReconciliationStatus === "all" ? "" : filterReconciliationStatus,
      });
    }
    e.target.value = "";
  };

  return {
    filterMode,
    setFilterMode,
    filterReconciliationStatus,
    setFilterReconciliationStatus,
    filters,
    setFilters,
    handleClearSearch,
    detail,
    handleOpenDetail,
    handleCloseDetail,
    isCreateModalOpen,
    createForm,
    candidateRecognitions,
    candidateItemReceipts,
    handleOpenCreateModal,
    handleCloseCreateModal,
    handleCreateFormPartnerChange,
    handleToggleCandidateRecognition,
    handleToggleCandidateItemReceipt,
    handleItemReceiptAmountChange,
    handleAddManualItem,
    handleRemoveManualItem,
    handleManualItemChange,
    setCreateForm,
    handleSubmitCreatePayment,
    handleRecordDisbursement,
    handleCSVImportChange,
    selectedPaymentIds,
    handleToggleSelectPayment,
    isFirmBankingModalOpen,
    firmBankingTransferDate,
    setFirmBankingTransferDate,
    firmBankingPreview,
    isFirmBankingLoading,
    handleOpenFirmBankingModal,
    handleCloseFirmBankingModal,
    handlePreviewFirmBanking,
    handleDownloadFirmBanking,
  };
}
