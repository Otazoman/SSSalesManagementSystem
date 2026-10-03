import { useState, useEffect } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { BillingDetail, UnbilledSalesInvoice } from "../_types";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";
import { todayJst } from "../../../_shared/jst-date";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface UseBillingActionsProps {
  syncBillings: (filters: Record<string, string>) => Promise<void>;
  handleImportCSV: (file: File, url?: string) => Promise<boolean>;
  setMessage: (msg: string) => void;
  setError: (msg: string) => void;
}

// K-4-4: useQuoteForm.tsのPartnerContactOptionと同型
export interface PartnerContactOption {
  id: string;
  name: string;
  email?: string;
  department?: string;
  position?: string;
}

// K-4-3: 完全手動入力の明細行(入力中は文字列で保持し、送信時に数値変換する)
export interface ManualBillingItemForm {
  itemName: string;
  quantity: string;
  unitPrice: string;
  taxCategoryCode: string;
}

interface CreateBillingForm {
  partnerId: string;
  mode: "PER_TRANSACTION" | "PERIODIC";
  billingDate: string;
  periodStart: string;
  periodEnd: string;
  title: string;
  memo: string;
  salesInvoiceIds: string[];
  manualItems: ManualBillingItemForm[];
}

const EMPTY_MANUAL_ITEM: ManualBillingItemForm = {
  itemName: "",
  quantity: "1",
  unitPrice: "0",
  taxCategoryCode: "",
};

const INITIAL_CREATE_FORM: CreateBillingForm = {
  partnerId: "",
  mode: "PER_TRANSACTION",
  billingDate: todayJst(),
  periodStart: "",
  periodEnd: "",
  title: "",
  memo: "",
  salesInvoiceIds: [],
  manualItems: [],
};

// Item8 Phase4: sales/invoices/_hooks/useSalesInvoiceListActions.tsと同じ方針。
// 請求は編集フォームを持たず、一覧・作成モーダル・詳細モーダルの3画面構成とする
export function useBillingActions({
  syncBillings,
  handleImportCSV,
  setMessage,
  setError,
}: UseBillingActionsProps) {
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
  const [createForm, setCreateForm] = useState<CreateBillingForm>(INITIAL_CREATE_FORM);
  const [candidateInvoices, setCandidateInvoices] = useState<UnbilledSalesInvoice[]>([]);

  const [detail, setDetail] = useState<BillingDetail | null>(null);

  // K-4-4: 請求書の再送付モーダルの状態
  const [showMailModal, setShowMailModal] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [partnerContacts, setPartnerContacts] = useState<PartnerContactOption[]>([]);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [isMailSending, setIsMailSending] = useState(false);
  // 追加要望: 請求書がOTPセルフダウンロード方式になったため、useSalesInvoiceForm.tsと同じく
  // OTPダウンロード宛先制限(会社設定)を反映する
  const [isEmailRestrictedToContacts, setIsEmailRestrictedToContacts] = useState(false);
  // 追加要望: 一覧からの一括メール送信用チェックボックス選択(sales/invoicesと同型)
  const [selectedBillingIds, setSelectedBillingIds] = useState<string[]>([]);

  useEffect(() => {
    apiFetch<{ is_otp_download_restricted_to_contacts?: boolean }>("/api/company-settings")
      .then((data) => {
        setIsEmailRestrictedToContacts(data.is_otp_download_restricted_to_contacts === true);
      })
      .catch((err) => {
        console.error("OTPダウンロード宛先制限設定の取得に失敗しました", err);
      });
  }, []);

  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedFilters = useDebouncedValue(filters);
  useEffect(() => {
    void syncBillings({
      ...debouncedFilters,
      mode: filterMode === "all" ? "" : filterMode,
      reconciliationStatus: filterReconciliationStatus === "all" ? "" : filterReconciliationStatus,
    });
  }, [debouncedFilters, filterMode, filterReconciliationStatus, syncBillings]);

  const handleClearSearch = () => {
    setFilters({ id: "", title: "", partnerId: "", startDate: "", endDate: "" });
    setFilterMode("all");
    setFilterReconciliationStatus("all");
  };

  const handleOpenDetail = async (id: string) => {
    try {
      setError("");
      const data = await apiFetch<BillingDetail>(`/api/sales-billing/${id}`, {
        defaultErrorMessage: "請求詳細の取得に失敗しました",
      });
      setDetail(data);

      // K-4-4: 再送付モーダルの宛先候補として、請求先の取引先担当者マスタを取得
      try {
        const contactsData = await apiFetch<PartnerContactOption[] | { data: PartnerContactOption[] }>(
          `/api/partner-contacts?partnerId=${data.partnerId}`,
        );
        setPartnerContacts(Array.isArray(contactsData) ? contactsData : contactsData.data || []);
      } catch (err) {
        console.error("取引先担当者マスタの取得に失敗しました", err);
        setPartnerContacts([]);
      }
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  // 追加要望: 一覧から詳細画面を経由せず直接「個別送信」できるようにする(初回送信・再送付とも)。
  // 中身はhandleOpenDetailと同じ詳細読み込みを行った上で、続けて送信モーダルを開くだけの合成アクション
  const handleQuickSendEmail = async (id: string) => {
    await handleOpenDetail(id);
    setShowMailModal(true);
  };

  const handleCloseDetail = () => {
    setDetail(null);
    setShowMailModal(false);
    setRecipientEmail("");
    setSelectedContactId("");
    setPartnerContacts([]);
  };

  // K-4-4: 連絡先プルダウン選択時の処理
  const handleContactSelect = (contactId: string) => {
    setSelectedContactId(contactId);
    if (!contactId) return;
    const contact = partnerContacts.find((c) => c.id === contactId);
    if (contact && contact.email) {
      setRecipientEmail(contact.email);
    }
  };

  // K-4-4: 請求書の再送付ハンドラー
  const handleSendEmail = async () => {
    if (!detail) return;
    // 宛先が正しくない間は、送信モーダル(MailSendModal)の「送信」が押せない(BUG-037: 念のための確認)
    if (!recipientEmail || !recipientEmail.includes("@")) return;
    if (
      !(await confirm(`請求 [ ${detail.id} ] の請求書を以下の宛先へ送信しますか？\n送信先: ${recipientEmail}`))
    ) {
      return;
    }

    setIsMailSending(true);
    setMessage("");
    setError("");
    try {
      await apiFetch(`/api/sales-billing/${detail.id}/send-email`, {
        method: "POST",
        json: { recipientEmail },
        defaultErrorMessage: "メール送信に失敗しました",
      });
      setMessage("📧 メールの送信を予約しました");
      setShowMailModal(false);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsMailSending(false);
    }
  };

  // 追加要望: 一覧からの一括メール送信ハンドラー(sales/invoicesのhandleBulkMailSendActionと同型)。
  // PDF未発行の請求も送信時にサーバー側で自動生成されるため、状態(DRAFT/ISSUED)を問わず選択できる
  const handleToggleSelectBilling = (id: string) => {
    setSelectedBillingIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleBulkMailSendAction = async () => {
    if (selectedBillingIds.length === 0) return;
    if (
      !(await confirm(`選択された ${selectedBillingIds.length} 件の請求書を一括メール送信してよろしいですか？`))
    ) {
      return;
    }

    setIsMailSending(true);
    setMessage("");
    setError("");
    try {
      const data = await apiFetch<{ message?: string }>("/api/sales-billing/bulk-send-email", {
        method: "POST",
        json: {
          billingHeaderIds: selectedBillingIds,
          fallbackOperatorId: "CURRENT_USER",
        },
        defaultErrorMessage: "一括送信リレーに失敗しました",
      });
      setMessage(data.message || "一括送信を予約しました");
      setSelectedBillingIds([]);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsMailSending(false);
    }
  };

  const fetchCandidateInvoices = async (partnerId: string) => {
    if (!partnerId) {
      setCandidateInvoices([]);
      return;
    }
    try {
      const data = await apiFetch<UnbilledSalesInvoice[]>(
        `/api/sales-invoices?partnerId=${partnerId}&status=APPROVED&billingStatus=UNBILLED`,
      );
      setCandidateInvoices(data);
    } catch (err) {
      console.error("請求対象の売上一覧取得に失敗しました", err);
      setCandidateInvoices([]);
    }
  };

  const handleOpenCreateModal = () => {
    setCreateForm(INITIAL_CREATE_FORM);
    setCandidateInvoices([]);
    setIsCreateModalOpen(true);
  };

  const handleCloseCreateModal = () => {
    setIsCreateModalOpen(false);
  };

  const handleCreateFormPartnerChange = (partnerId: string) => {
    setCreateForm((prev) => ({ ...prev, partnerId, salesInvoiceIds: [], manualItems: [] }));
    void fetchCandidateInvoices(partnerId);
  };

  const handleToggleCandidateInvoice = (id: string) => {
    setCreateForm((prev) => {
      const isSelected = prev.salesInvoiceIds.includes(id);
      if (prev.mode === "PER_TRANSACTION") {
        return { ...prev, salesInvoiceIds: isSelected ? [] : [id], manualItems: [] };
      }
      return {
        ...prev,
        salesInvoiceIds: isSelected
          ? prev.salesInvoiceIds.filter((x) => x !== id)
          : [...prev.salesInvoiceIds, id],
      };
    });
  };

  // K-4-3: 完全手動入力の明細行編集
  const handleAddManualItem = () => {
    setCreateForm((prev) => ({
      ...prev,
      manualItems: [...prev.manualItems, { ...EMPTY_MANUAL_ITEM }],
      // PER_TRANSACTIONでは売上選択との排他(合計1件のみ)のため、追加時にクリアする
      salesInvoiceIds: prev.mode === "PER_TRANSACTION" ? [] : prev.salesInvoiceIds,
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
    field: keyof ManualBillingItemForm,
    value: string,
  ) => {
    setCreateForm((prev) => ({
      ...prev,
      manualItems: prev.manualItems.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    }));
  };

  const handleSubmitCreateBilling = async () => {
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<{ message?: string; id?: string }>("/api/sales-billing/register", {
        method: "POST",
        json: {
          partnerId: createForm.partnerId,
          mode: createForm.mode,
          billingDate: createForm.billingDate,
          periodStart: createForm.mode === "PERIODIC" ? createForm.periodStart : null,
          periodEnd: createForm.mode === "PERIODIC" ? createForm.periodEnd : null,
          title: createForm.title || null,
          memo: createForm.memo || null,
          salesInvoiceIds: createForm.salesInvoiceIds,
          manualItems: createForm.manualItems.map((item) => ({
            itemName: item.itemName,
            quantity: Number(item.quantity) || 0,
            unitPrice: Number(item.unitPrice) || 0,
            taxCategoryCode: item.taxCategoryCode || null,
          })),
        },
        defaultErrorMessage: "請求の作成に失敗しました",
      });
      setMessage(data.message || "請求を作成しました");
      setIsCreateModalOpen(false);
      void syncBillings({
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

  const handleGeneratePDF = async (id: string) => {
    if (!(await confirm(`請求 [ ${id} ] の請求書PDFを発行しますか？`))) return;
    setMessage("⌛ PDFファイルを生成中...");
    setError("");
    try {
      const data = await apiFetch<{ message?: string }>(`/api/sales-billing/${id}/generate-pdf`, {
        method: "POST",
        defaultErrorMessage: "PDF生成に失敗しました",
      });
      setMessage(data.message || "請求書PDFの生成に成功しました");
      void handleOpenDetail(id);
      void syncBillings({
        ...filters,
        mode: filterMode === "all" ? "" : filterMode,
        reconciliationStatus: filterReconciliationStatus === "all" ? "" : filterReconciliationStatus,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF生成に失敗しました");
      setMessage("");
    }
  };

  const handleRecordPaymentReceipt = async (
    billingHeaderId: string,
    payload: { receivedDate: string; amount: number; method: string; memo?: string },
  ) => {
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<{ message?: string }>(
        `/api/sales-billing/${billingHeaderId}/payment-receipts`,
        {
          method: "POST",
          json: payload,
          defaultErrorMessage: "入金消込の記録に失敗しました",
        },
      );
      setMessage(data.message || "入金消込を記録しました");
      void handleOpenDetail(billingHeaderId);
      void syncBillings({
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

  const handleCSVImportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !(await confirm(
        `選択したCSVファイル [ ${file.name} ] を読み込んで、請求データをCSVインポート(登録・同期)しますか？\n※既存の同一コードデータは明細含め上書きされます。`,
      ))
    ) {
      e.target.value = "";
      return;
    }

    const success = await handleImportCSV(file);
    if (success) {
      void syncBillings({
        ...filters,
        mode: filterMode === "all" ? "" : filterMode,
        reconciliationStatus: filterReconciliationStatus === "all" ? "" : filterReconciliationStatus,
      });
    }
    e.target.value = "";
  };

  // BUG-060: 入金消込のCSV取込(画面が無く、APIでしか取り込めなかった)。入金消込の記録を「追加」する取込のため、
  // 同じファイルを2回取り込むとサーバー側でエラーになり、1件も登録しない(既存の二重取込チェック)
  const handlePaymentReceiptsCSVImportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !(await confirm(
        `選択したCSVファイル [ ${file.name} ] を読み込んで、入金消込を記録しますか？\n※入金の記録を追加する取込です。同じファイルを2回取り込むとエラーになり、1件も登録しません。\n(列: billingHeaderId,receivedDate,amount,method,memo)`,
      ))
    ) {
      e.target.value = "";
      return;
    }

    const success = await handleImportCSV(file, "/api/sales-billing/payment-receipts/bulk-register");
    if (success) {
      void syncBillings({
        ...filters,
        mode: filterMode === "all" ? "" : filterMode,
        reconciliationStatus: filterReconciliationStatus === "all" ? "" : filterReconciliationStatus,
      });
    }
    e.target.value = "";
  };

  return {
    handlePaymentReceiptsCSVImportChange,
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
    candidateInvoices,
    handleOpenCreateModal,
    handleCloseCreateModal,
    handleCreateFormPartnerChange,
    handleToggleCandidateInvoice,
    handleAddManualItem,
    handleRemoveManualItem,
    handleManualItemChange,
    setCreateForm,
    handleSubmitCreateBilling,
    handleGeneratePDF,
    handleRecordPaymentReceipt,
    handleCSVImportChange,
    showMailModal,
    setShowMailModal,
    recipientEmail,
    setRecipientEmail,
    partnerContacts,
    selectedContactId,
    handleContactSelect,
    isMailSending,
    isEmailRestrictedToContacts,
    handleSendEmail,
    handleQuickSendEmail,
    selectedBillingIds,
    handleToggleSelectBilling,
    handleBulkMailSendAction,
  };
}
