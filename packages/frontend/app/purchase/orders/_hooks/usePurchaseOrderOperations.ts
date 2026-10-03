import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import {
  PurchaseOrderRecord,
  PurchaseOrderItemRecord,
  PurchaseOrderAttachment,
  ItemMaster,
  ProjectLookup,
  PartnerLookup,
  PartnerContactOption,
  UserOption,
  UnitLookup,
  TaxCategoryLookup,
  AccountLookup,
  PurchaseOrderPrefillData,
  BusinessLocationLookup,
  WarehouseLookup,
} from "../_types";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { roundTaxAmount } from "../../../_shared/tax-amounts";
import { useTaxRoundingMode } from "../../../_shared/hooks/use-tax-rounding-mode";
import { todayJst } from "../../../_shared/jst-date";
import { useConfirm } from "../../../_shared/hooks/use-confirm";
import { fetchPartnersOfTypes } from "../../../_shared/partner-options";

interface CompanySettingsResponse {
  is_otp_download_restricted_to_contacts?: boolean;
}

interface UsePurchaseOrderOperationsProps {
  canRead: boolean;
  isPurchaseOrderWfEnabled: boolean;
  currentUserEmployeeNumber?: string;
}

// usePurchaseRequisitionOperations.ts(Item9 Phase3)と同じ、検索/CRUD/承認申請/CSV/PDF/メール送信を
// 1つのフックに集約する構成(sales/orders相当の在庫引当・与信等の概念が発注には無いため、
// 受注の4分割ではなく購買申請の単一フック構成をベースに、PDF/メール送信のみ追加する)
export function usePurchaseOrderOperations({
  canRead,
  isPurchaseOrderWfEnabled,
  currentUserEmployeeNumber,
}: UsePurchaseOrderOperationsProps) {
  const [orders, setOrders] = useState<PurchaseOrderRecord[]>([]);
  const confirm = useConfirm();
  const [allItems, setAllItems] = useState<ItemMaster[]>([]);
  const [projects, setProjects] = useState<ProjectLookup[]>([]);
  const [suppliers, setSuppliers] = useState<PartnerLookup[]>([]);
  const [userMaster, setUserMaster] = useState<UserOption[]>([]);
  const [units, setUnits] = useState<UnitLookup[]>([]);
  const [taxCategories, setTaxCategories] = useState<TaxCategoryLookup[]>([]);
  const [accounts, setAccounts] = useState<AccountLookup[]>([]);
  // 新規要望(2026-09-23): 納品場所の「拠点用」「倉庫用」選択
  const [businessLocations, setBusinessLocations] = useState<BusinessLocationLookup[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLookup[]>([]);

  const [filterStatus, setFilterStatus] = useState("all");
  // 追加要望: コード/件名/仕入先/含まれる商品/作成日(FROM・TO)/自社担当者での絞り込み検索
  const [searchFilters, setSearchFilters] = useState<Record<string, string>>({});
  const handleClearSearchFilters = useCallback(() => setSearchFilters({}), []);

  // ヘッダクリックソート(追加要望D)。追加要望J-1-a(複合ソート): Shift+クリック(additive)で
  // 複数キーを追加できるよう、`_shared/hooks/use-paginated-list.ts`と同じ設計(キー配列)に合わせる
  const [sortKeys, setSortKeys] = useState<{ key: string; direction: "asc" | "desc" }[]>([]);
  const setSort = useCallback((key: string, additive = false) => {
    setSortKeys((prev) => {
      if (additive) {
        const index = prev.findIndex((s) => s.key === key);
        if (index === -1) return [...prev, { key, direction: "asc" }];
        return prev.map((s, i) =>
          i === index ? { key, direction: s.direction === "asc" ? "desc" : "asc" } : s,
        );
      }
      const isOnlyKey = prev.length === 1 && prev[0].key === key;
      return isOnlyKey
        ? [{ key, direction: prev[0].direction === "asc" ? "desc" : "asc" }]
        : [{ key, direction: "asc" }];
    });
  }, []);
  const [viewMode, setViewMode] = useState<"LIST" | "FORM">("LIST");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState<string | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [showRequisitionPicker, setShowRequisitionPicker] = useState(false);
  // Item9設計確定: 承認機能が無効な場合、購買申請を経由せず受注欠品から直接発注を作成できるようにする
  const [showSalesOrderShortagePicker, setShowSalesOrderShortagePicker] = useState(false);
  // J-2-g: 上記と同じ方針(承認機能が無効な場合、購買申請を経由せず直接発注を作成できる)を
  // 「過去の発注から再発注」「発注点/安全在庫割れ品目から」の2ルートにも展開する
  const [showOrderReorderPicker, setShowOrderReorderPicker] = useState(false);
  const [showReorderSuggestionPicker, setShowReorderSuggestionPicker] = useState(false);
  const [isMailSending, setIsMailSending] = useState(false);
  const [mailModalOrderId, setMailModalOrderId] = useState<string | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  // J-2-a: 見積(useQuoteForm.ts)と同じ「連絡先マスタから選択」機能を発注にも揃える
  const [supplierContacts, setSupplierContacts] = useState<PartnerContactOption[]>([]);
  const [selectedContactId, setSelectedContactId] = useState("");
  // OTPダウンロード宛先制限(会社・システム設定)。見積/受注と同じ会社共通フラグで、
  // 発注書ダウンロード用OTP(purchase-order-download.service.ts)にも適用されるため、
  // 個別メール送信の宛先選択でも同じ制限を掛ける
  const [isEmailRestrictedToContacts, setIsEmailRestrictedToContacts] = useState(false);

  useEffect(() => {
    apiFetch<CompanySettingsResponse>("/api/company-settings")
      .then((data) => {
        setIsEmailRestrictedToContacts(data.is_otp_download_restricted_to_contacts === true);
      })
      .catch((err) => {
        console.error("OTPダウンロード宛先制限設定の取得に失敗しました", err);
      });
  }, []);

  const [title, setTitle] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [orderDate, setOrderDate] = useState(() => todayJst());
  const [projectId, setProjectId] = useState("");
  const [memo, setMemo] = useState("");
  const [items, setItems] = useState<PurchaseOrderItemRecord[]>([]);
  const [purchasePersonEmployeeNumber, setPurchasePersonEmployeeNumber] = useState("");
  const [inputPersonEmployeeNumber, setInputPersonEmployeeNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyDepartment, setCompanyDepartment] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyTel, setCompanyTel] = useState("");
  const [companyFax, setCompanyFax] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryPlace, setDeliveryPlace] = useState("");
  const [deliveryLocationId, setDeliveryLocationId] = useState("");
  const [deliveryWarehouseId, setDeliveryWarehouseId] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [isPaid, setIsPaid] = useState(false);
  const [paidAt, setPaidAt] = useState("");
  const [attachments, setAttachments] = useState<PurchaseOrderAttachment[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File>>({});

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // currentUserEmployeeNumberは非同期に取得されるため、購買申請と同じ反映漏れ対策
  useEffect(() => {
    if (!currentUserEmployeeNumber || editingId) return;
    setPurchasePersonEmployeeNumber((prev) => prev || currentUserEmployeeNumber);
    setInputPersonEmployeeNumber((prev) => prev || currentUserEmployeeNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserEmployeeNumber]);

  useEffect(() => {
    if (!canRead) return;

    // 購買申請Phase3フォローアップで確立した設計: グループ化を一切せず、各マスタ取得を
    // Promise.allSettledで完全に独立させる(1つの失敗が他に一切影響しない)
    async function loadMasterData() {
      const [
        itemsResult,
        projectsResult,
        usersResult,
        suppliersResult,
        unitsResult,
        taxCategoriesResult,
        accountsResult,
        businessLocationsResult,
        warehousesResult,
      ] = await Promise.allSettled([
        apiFetch<ItemMaster[]>("/api/products"),
        apiFetch<ProjectLookup[]>("/api/projects?status=active"),
        apiFetch<UserOption[]>("/api/users"),
        // BUG-067: 兼用(BOTH)の取引先も仕入先に選べるようにする
        fetchPartnersOfTypes<PartnerLookup>(["SUPPLIER", "BOTH"]),
        apiFetch<UnitLookup[]>("/api/units"),
        apiFetch<TaxCategoryLookup[]>("/api/tax-categories"),
        apiFetch<AccountLookup[]>("/api/accounts"),
        apiFetch<BusinessLocationLookup[]>("/api/business-locations?status=active"),
        apiFetch<WarehouseLookup[]>("/api/warehouses?status=active"),
      ]);

      if (itemsResult.status === "fulfilled") setAllItems(itemsResult.value);
      else console.error("品目マスタの取得に失敗しました", itemsResult.reason);

      if (projectsResult.status === "fulfilled") setProjects(projectsResult.value);
      else console.error("プロジェクトマスタの取得に失敗しました", projectsResult.reason);

      if (usersResult.status === "fulfilled") setUserMaster(usersResult.value);
      else console.error("ユーザーマスタの取得に失敗しました", usersResult.reason);

      if (suppliersResult.status === "fulfilled") setSuppliers(suppliersResult.value);
      else console.error("仕入先マスタの取得に失敗しました", suppliersResult.reason);

      if (unitsResult.status === "fulfilled") setUnits(unitsResult.value);
      else console.error("単位マスタの取得に失敗しました", unitsResult.reason);

      if (taxCategoriesResult.status === "fulfilled") setTaxCategories(taxCategoriesResult.value);
      else console.error("税区分マスタの取得に失敗しました", taxCategoriesResult.reason);

      if (accountsResult.status === "fulfilled") setAccounts(accountsResult.value);
      else console.error("勘定科目マスタの取得に失敗しました", accountsResult.reason);

      if (businessLocationsResult.status === "fulfilled") setBusinessLocations(businessLocationsResult.value);
      else console.error("営業拠点マスタの取得に失敗しました", businessLocationsResult.reason);

      if (warehousesResult.status === "fulfilled") setWarehouses(warehousesResult.value);
      else console.error("倉庫マスタの取得に失敗しました", warehousesResult.reason);
    }

    void loadMasterData();
  }, [canRead]);

  // BUG-032: 会社設定の「一覧のページ分割」に従う(仕入計上など他の一覧と同じ作り)
  const { paginationEnabled } = usePaginationSetting();
  const [page, setPageState] = useState(1);
  const [limit, setLimitState] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const syncOrders = useCallback(
    async (
      status: string,
      filters: Record<string, string> = searchFilters,
      overrides?: { page?: number; limit?: number },
    ) => {
      if (!canRead) return;
      try {
        const params = new URLSearchParams();
        if (status && status !== "all") params.append("status", status);
        Object.entries(filters).forEach(([key, value]) => {
          if (value) params.append(key, value);
        });
        if (sortKeys.length > 0) {
          params.append("sortBy", sortKeys.map((s) => s.key).join(","));
          params.append("sortOrder", sortKeys.map((s) => s.direction).join(","));
        }
        const effectivePage = overrides?.page ?? page;
        const effectiveLimit = overrides?.limit ?? limit;
        if (paginationEnabled) {
          params.append("page", String(effectivePage));
          params.append("limit", String(effectiveLimit));
        }
        const data = await apiFetch<
          | PurchaseOrderRecord[]
          | { data: PurchaseOrderRecord[]; pagination: { total: number; totalPages: number } }
        >(`/api/purchase-orders?${params.toString()}`);
        if (Array.isArray(data)) {
          setOrders(data);
          setTotal(data.length);
          setTotalPages(1);
        } else {
          setOrders(data.data);
          setTotal(data.pagination.total);
          setTotalPages(data.pagination.totalPages);
        }
        if (overrides?.page !== undefined) setPageState(overrides.page);
        if (overrides?.limit !== undefined) setLimitState(overrides.limit);
      } catch (err) {
        console.error("発注一覧の取得に失敗しました", err);
      }
    },
    [canRead, sortKeys, searchFilters, paginationEnabled, page, limit],
  );

  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedSearchFilters = useDebouncedValue(searchFilters);
  useEffect(() => {
    void syncOrders(filterStatus, debouncedSearchFilters, { page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, filterStatus, sortKeys, debouncedSearchFilters, paginationEnabled]);

  const handleClearForm = useCallback(() => {
    setEditingId(null);
    setEditingStatus(null);
    setTitle("");
    setPartnerId("");
    setRequestId(null);
    setOrderDate(todayJst());
    setProjectId("");
    setMemo("");
    setItems([]);
    setPurchasePersonEmployeeNumber(currentUserEmployeeNumber || "");
    setInputPersonEmployeeNumber(currentUserEmployeeNumber || "");
    setCompanyName("");
    setCompanyDepartment("");
    setCompanyAddress("");
    setCompanyTel("");
    setCompanyFax("");
    setDeliveryDate("");
    setDeliveryPlace("");
    setDeliveryLocationId("");
    setDeliveryWarehouseId("");
    setPaymentTerms("");
    setIsPaid(false);
    setPaidAt("");
    setAttachments([]);
    setSelectedFiles({});
    setError("");
  }, [currentUserEmployeeNumber]);

  // 一覧の検索結果(searchOrders)は明細を含まないため、必ず詳細取得(GET /api/purchase-orders/:id)
  // でヘッダー・明細・添付を取り直してからフォームへ反映する(sales/quotesのhandleOpenEditFormと同じ方針)。
  // 一覧の行データをそのまま使うと明細が空のままフォームが開き、上書き保存で明細が全消しされる
  const handleSelectEdit = useCallback(async (record: PurchaseOrderRecord) => {
    setError("");
    let detail: PurchaseOrderRecord;
    try {
      detail = await apiFetch<PurchaseOrderRecord>(`/api/purchase-orders/${record.id}`, {
        defaultErrorMessage: "発注詳細の取得に失敗しました",
      });
    } catch (err) {
      // 詳細取得に失敗した状態でフォームを開くと、明細が空のまま保存されて既存明細を失うため開かない
      setError(err instanceof Error ? err.message : "発注詳細の取得に失敗しました");
      return;
    }

    setEditingId(detail.id);
    setEditingStatus(detail.status);
    setTitle(detail.title || "");
    setPartnerId(detail.partnerId || "");
    setRequestId(detail.requestId || null);
    setOrderDate(detail.orderDate ? detail.orderDate.split("T")[0] : todayJst());
    setProjectId(detail.projectId || "");
    setMemo(detail.memo || "");
    setItems(detail.items || []);
    setPurchasePersonEmployeeNumber(detail.purchasePersonEmployeeNumber || "");
    setInputPersonEmployeeNumber(detail.inputPersonEmployeeNumber || "");
    setCompanyName(detail.companyName || "");
    setCompanyDepartment(detail.companyDepartment || "");
    setCompanyAddress(detail.companyAddress || "");
    setCompanyTel(detail.companyTel || "");
    setCompanyFax(detail.companyFax || "");
    setDeliveryDate(detail.deliveryDate || "");
    setDeliveryPlace(detail.deliveryPlace || "");
    setDeliveryLocationId(detail.deliveryLocationId || "");
    setDeliveryWarehouseId(detail.deliveryWarehouseId || "");
    setPaymentTerms(detail.paymentTerms || "");
    setIsPaid(detail.isPaid || false);
    setPaidAt(detail.paidAt ? detail.paidAt.split("T")[0] : "");
    setAttachments(detail.attachments || []);
    setSelectedFiles({});
    setViewMode("FORM");
  }, []);

  // sales/orders/_hooks/useOrderListActions.tsのhandlePrefillFromQuoteと同じ方針。
  // まだDBには一切書き込まず、フォームへ初期値を反映するだけ。
  // PurchaseRequisitionPickerModal(購買申請から)・SalesOrderShortagePickerModal(受注欠品から、
  // 承認機能OFF時のみ)の両方から共通で呼ばれる汎用prefillハンドラ
  const handlePrefillFromRequisition = useCallback(
    (data: PurchaseOrderPrefillData) => {
      handleClearForm();
      setTitle(data.title);
      setPartnerId(data.partnerId || "");
      setRequestId(data.requestId);
      setOrderDate(data.orderDate);
      setItems(data.items);
      // 追加要望対応: 購買申請・過去の発注からのプロジェクト引き継ぎ
      setProjectId(data.projectId || "");
      setViewMode("FORM");
    },
    [handleClearForm],
  );

  const addItemRow = useCallback(() => {
    setItems((prev) => [
      ...prev,
      {
        itemId: "",
        itemName: "",
        inputType: "MASTER",
        quantity: 1,
        unitPrice: 0,
        unitCode: "",
        taxCategoryCode: "",
        memo: "",
      },
    ]);
  }, []);

  const moveItemUp = useCallback((index: number) => {
    setItems((prev) => {
      if (index <= 0) return prev;
      const updated = [...prev];
      [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
      return updated;
    });
  }, []);

  const moveItemDown = useCallback((index: number) => {
    setItems((prev) => {
      if (index >= prev.length - 1) return prev;
      const updated = [...prev];
      [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
      return updated;
    });
  }, []);

  const updateItemRow = useCallback((index: number, patch: Partial<PurchaseOrderItemRecord>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }, []);

  const onItemTypeChange = useCallback((index: number, type: "MASTER" | "DIRECT") => {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, inputType: type, itemId: "", itemName: "" } : it)),
    );
  }, []);

  const removeItemRow = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // 見積のfetchSpecialPrice/購買申請のfetchPurchasePriceと同じ方針(priceType=PURCHASE)
  const fetchPurchasePrice = useCallback(
    async (supplierId: string, itemId: string, quantity: number): Promise<number | null> => {
      if (!supplierId || !itemId) return null;
      try {
        const data = await apiFetch<{ unitPrice?: number }[]>(
          `/api/product-prices?partnerId=${supplierId}&itemId=${itemId}&quantity=${quantity}&priceType=PURCHASE`,
        );
        if (data && data.length > 0) return data[0].unitPrice ?? null;
      } catch (err) {
        console.error("仕入単価の取得に失敗しました", err);
      }
      return null;
    },
    [],
  );

  const onItemMasterSelect = useCallback(
    async (index: number, itemId: string) => {
      const selected = allItems.find((i) => i.id === itemId);
      updateItemRow(index, {
        itemId,
        unitCode: selected?.baseUnitCode || "",
        taxCategoryCode: selected?.taxCategoryCode || "",
      });
      if (partnerId && itemId) {
        const currentQuantity = items[index]?.quantity || 1;
        const price = await fetchPurchasePrice(partnerId, itemId, currentQuantity);
        if (price !== null) updateItemRow(index, { unitPrice: price });
      }
    },
    [allItems, partnerId, items, updateItemRow, fetchPurchasePrice],
  );

  const onItemQuantityChange = useCallback(
    async (index: number, quantity: number) => {
      updateItemRow(index, { quantity });
      const currentItem = items[index];
      if (currentItem && (currentItem.inputType || "MASTER") === "MASTER" && partnerId && currentItem.itemId) {
        const price = await fetchPurchasePrice(partnerId, currentItem.itemId, quantity);
        if (price !== null) updateItemRow(index, { unitPrice: price });
      }
    },
    [items, partnerId, updateItemRow, fetchPurchasePrice],
  );

  // 見積のhandleCustomerChangeと同じ方針: 仕入先を切り替えた際、既に選択済みのマスタ品目行すべてに
  // ついて、新しい仕入先での登録単価を再取得して反映する
  const onSupplierMasterSelect = useCallback(
    async (newPartnerId: string) => {
      setPartnerId(newPartnerId);
      if (!newPartnerId) return;
      const updates = await Promise.all(
        items.map(async (it, idx) => {
          if ((it.inputType || "MASTER") !== "MASTER" || !it.itemId) return null;
          const price = await fetchPurchasePrice(newPartnerId, it.itemId, it.quantity || 1);
          return price !== null ? { idx, price } : null;
        }),
      );
      setItems((prev) =>
        prev.map((it, i) => {
          const found = updates.find((u) => u && u.idx === i);
          return found ? { ...it, unitPrice: found.price } : it;
        }),
      );
    },
    [items, fetchPurchasePrice],
  );

  const handleAddAttachmentRow = useCallback((storageType: "R2" | "GOOGLE_DRIVE") => {
    setAttachments((prev) => [...prev, { fileName: "", storageType, externalUrl: "" }]);
  }, []);

  const handleRemoveAttachmentRow = useCallback((index: number, fileName: string) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setSelectedFiles((prev) => {
      const next = { ...prev };
      delete next[fileName];
      return next;
    });
  }, []);

  const handleFileSelection = useCallback((index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachments((prev) => prev.map((att, i) => (i === index ? { ...att, fileName: file.name } : att)));
    setSelectedFiles((prev) => ({ ...prev, [file.name]: file }));
  }, []);

  const handleAttachmentFileNameChange = useCallback((index: number, value: string) => {
    setAttachments((prev) => prev.map((att, i) => (i === index ? { ...att, fileName: value } : att)));
  }, []);

  const handleAttachmentExternalUrlChange = useCallback((index: number, value: string) => {
    setAttachments((prev) => prev.map((att, i) => (i === index ? { ...att, externalUrl: value } : att)));
  }, []);

  // useQuoteForm.ts/usePurchaseRequisitionOperations.tsのcalcSubTotal/calcTaxBreakdown/calcTax/calcTotalと同じ
  const calcDiscountTotal = useCallback(
    () =>
      items.reduce((sum, it) => {
        const amount = (it.quantity || 0) * (it.unitPrice || 0);
        return amount < 0 ? sum + amount : sum;
      }, 0),
    [items],
  );

  const calcGrossSubTotal = useCallback(
    () =>
      items.reduce((sum, it) => {
        const amount = (it.quantity || 0) * (it.unitPrice || 0);
        return amount >= 0 ? sum + amount : sum;
      }, 0),
    [items],
  );

  const calcSubTotal = useCallback(() => calcGrossSubTotal() + calcDiscountTotal(), [calcGrossSubTotal, calcDiscountTotal]);

  // BUG-042: 消費税の端数処理(会社設定)
  const taxRoundingMode = useTaxRoundingMode();

  const calcTaxBreakdown = useCallback(() => {
    const buckets = {
      rate10: { excl: 0, tax: 0 },
      rate8: { excl: 0, tax: 0 },
      rate0: { excl: 0, tax: 0 },
    };
    for (const it of items) {
      const amount = (it.quantity || 0) * (it.unitPrice || 0);
      const rate = it.taxCategoryCode
        ? (taxCategories.find((t) => t.code === it.taxCategoryCode)?.taxRate ?? 0.1)
        : 0.1;
      const bucket = Math.abs(rate - 0.1) < 1e-9 ? "rate10" : Math.abs(rate - 0.08) < 1e-9 ? "rate8" : "rate0";
      buckets[bucket].excl += amount;
    }
    // BUG-042: 税率ごとに1回、会社設定の方法で端数処理する(保存時の Backend の計算と同じ)
    buckets.rate10.tax = roundTaxAmount(buckets.rate10.excl, 0.1, taxRoundingMode);
    buckets.rate8.tax = roundTaxAmount(buckets.rate8.excl, 0.08, taxRoundingMode);
    buckets.rate0.tax = 0;
    return buckets;
  }, [items, taxCategories, taxRoundingMode]);

  const calcTax = useCallback(() => {
    const b = calcTaxBreakdown();
    return b.rate10.tax + b.rate8.tax + b.rate0.tax;
  }, [calcTaxBreakdown]);

  const calcTotal = useCallback(() => calcSubTotal() + calcTax(), [calcSubTotal, calcTax]);

  const totalAmount = calcTotal();
  const taxAmount = calcTax();

  const isApprovedEdit = editingStatus === "APPROVED" && isPurchaseOrderWfEnabled;
  const isLocked =
    isPurchaseOrderWfEnabled && (editingStatus === "PENDING_APPROVAL" || editingStatus === "PENDING_DELETION");

  const buildOrderJson = () => ({
    id: editingId || undefined,
    title,
    partnerId: partnerId || null,
    requestId: requestId || null,
    orderDate,
    projectId: projectId || null,
    purchasePersonEmployeeNumber: purchasePersonEmployeeNumber || null,
    inputPersonEmployeeNumber: inputPersonEmployeeNumber || null,
    companyName: companyName || null,
    companyDepartment: companyDepartment || null,
    companyAddress: companyAddress || null,
    companyTel: companyTel || null,
    companyFax: companyFax || null,
    deliveryDate: deliveryDate || null,
    deliveryPlace: deliveryPlace || null,
    deliveryLocationId: deliveryLocationId || null,
    deliveryWarehouseId: deliveryWarehouseId || null,
    paymentTerms: paymentTerms || null,
    isPaid,
    paidAt: paidAt || null,
    totalAmount,
    taxAmount,
    memo: memo.trim() === "" ? null : memo,
    items: items.map((it) => ({
      itemId: it.itemId,
      itemName: it.itemName || null,
      inputType: it.inputType || "MASTER",
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      unitCode: it.unitCode || null,
      taxCategoryCode: it.taxCategoryCode || null,
      memo: it.memo || null,
      purchaseRequestItemId: it.purchaseRequestItemId || null,
    })),
    attachments: attachments.map((att) => ({
      fileName: att.fileName,
      storageType: att.storageType,
      attachmentR2Path: att.attachmentR2Path || null,
      externalUrl: att.externalUrl || null,
    })),
  });

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");
    setMessage("");

    const hasInvalidItem = items.some((it) => !it.itemId || (it.inputType === "DIRECT" && !it.itemName));
    if (hasInvalidItem) {
      setError("品目(またはマスタ外品目の品目名)が未入力の明細行があります");
      return;
    }
    if (!partnerId) {
      setError("仕入先を選択してください");
      return;
    }
    if (isPurchaseOrderWfEnabled && !requestId && !editingId) {
      setError(
        "承認機能が有効な場合、発注は「購買申請から発注を作成」より承認済みの購買申請を選択して作成してください",
      );
      return;
    }

    setIsSubmitting(true);
    try {
      if (isApprovedEdit) {
        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "purchase_orders",
            targetId: editingId,
            requestType: "UPDATE",
            payload: {
              header: {
                title,
                partnerId: partnerId || null,
                requestId: requestId || null,
                projectId: projectId || null,
                purchasePersonEmployeeNumber: purchasePersonEmployeeNumber || null,
                inputPersonEmployeeNumber: inputPersonEmployeeNumber || null,
                companyName: companyName || null,
                companyDepartment: companyDepartment || null,
                companyAddress: companyAddress || null,
                companyTel: companyTel || null,
                companyFax: companyFax || null,
                deliveryDate: deliveryDate || null,
                deliveryPlace: deliveryPlace || null,
                deliveryLocationId: deliveryLocationId || null,
                deliveryWarehouseId: deliveryWarehouseId || null,
                paymentTerms: paymentTerms || null,
                isPaid,
                paidAt: paidAt || null,
                totalAmount,
                taxAmount,
                memo: memo.trim() === "" ? null : memo,
              },
              items: items.map((it) => ({
                itemId: it.itemId,
                itemName: it.itemName || null,
                inputType: it.inputType || "MASTER",
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                unitCode: it.unitCode || null,
                taxCategoryCode: it.taxCategoryCode || null,
                memo: it.memo || null,
              })),
            },
            comment: `発注[${editingId}]の変更申請`,
          },
          defaultErrorMessage: "変更の申請に失敗しました",
        });
        setMessage("発注の変更を申請しました");
        setViewMode("LIST");
        handleClearForm();
        void syncOrders(filterStatus);
        return;
      }

      const formData = new FormData();
      formData.append("orderData", JSON.stringify(buildOrderJson()));
      Object.keys(selectedFiles).forEach((key) => {
        const file = selectedFiles[key];
        if (file) formData.append(`files[${file.name}]`, file);
      });

      const url = editingId ? `/api/purchase-orders/${editingId}` : "/api/purchase-orders/register";
      const data = await apiFetch<{ id?: string }>(url, {
        method: editingId ? "PUT" : "POST",
        body: formData,
        defaultErrorMessage: "発注の保存に失敗しました",
      });

      setMessage(editingId ? "発注を更新しました" : "発注を新規登録しました");
      if (!editingId && data.id) {
        setEditingId(data.id);
        setEditingStatus("DRAFT");
      }
      void syncOrders(filterStatus);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitForApproval = async () => {
    if (!editingId) return;
    setIsSubmitting(true);
    setError("");
    try {
      const data = await apiFetch<{ message?: string }>(`/api/purchase-orders/${editingId}/submit-for-approval`, {
        method: "POST",
        json: {},
        defaultErrorMessage: "承認申請に失敗しました",
      });
      setMessage(data.message || "承認を申請しました");
      setViewMode("LIST");
      handleClearForm();
      void syncOrders(filterStatus);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteLink = async (record: PurchaseOrderRecord) => {
    setIsSubmitting(true);
    setError("");
    try {
      const data = await apiFetch<{ message?: string }>(`/api/purchase-orders/${record.id}/request-deletion`, {
        method: "POST",
        defaultErrorMessage: "削除処理に失敗しました",
      });
      setMessage(data.message || "削除処理が完了しました");
      void syncOrders(filterStatus);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadCsv = async () => {
    setMessage("⌛ CSVファイルを生成中...");
    try {
      const res = await fetch("/api/purchase-orders/csv-download", { method: "GET", credentials: "include" });
      if (!res.ok) throw new Error("サーバー側でのCSV生成に失敗しました");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `purchase_orders_export_${todayJst()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setMessage("📊 CSVファイルのダウンロードが完了しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSVのダウンロード中にエラーが発生しました");
    }
  };

  const handleImportCsv = async (file: File) => {
    // BUG-061: ほかの伝票(見積・受注・売上・請求・仕入・支払)と同じく、取り込む前に上書きの確認を出す
    if (
      !(await confirm(
        `選択したCSVファイル [ ${file.name} ] を読み込んで、発注データをCSVインポート(登録・同期)しますか？\n※既存の同一コードデータは明細含め上書きされます。`,
      ))
    ) {
      return false;
    }
    setIsSubmitting(true);
    setError("");
    setMessage("");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const data = await apiFetch<{ message?: string }>("/api/purchase-orders/bulk-register", {
        method: "POST",
        body: formData,
        defaultErrorMessage: "インポートに失敗しました",
      });
      setMessage(data.message || "CSVインポートが完了しました");
      void syncOrders(filterStatus);
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGeneratePdf = async () => {
    if (!editingId) return;
    setIsSubmitting(true);
    setError("");
    try {
      const data = await apiFetch<{ message?: string }>(`/api/purchase-orders/${editingId}/generate-pdf`, {
        method: "POST",
        defaultErrorMessage: "発注書PDFの生成に失敗しました",
      });
      setMessage(data.message || "発注書PDFを生成しました");
      const detail = await apiFetch<PurchaseOrderRecord>(`/api/purchase-orders/${editingId}`);
      setAttachments(detail.attachments || []);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenMailModal = (orderId: string) => {
    setMailModalOrderId(orderId);
    setRecipientEmail("");
    setSelectedContactId("");
    setSupplierContacts([]);
    // フォームの現在の仕入先(partnerId state)に紐づく連絡先マスタを取得する
    // (このモーダルはPurchaseOrderForm.tsx編集中のみ開けるため、partnerIdは常に対象発注の仕入先)
    if (partnerId) {
      apiFetch<PartnerContactOption[] | { data: PartnerContactOption[] }>(
        `/api/partner-contacts?partnerId=${partnerId}`,
      )
        .then((data) => {
          const contactsList = Array.isArray(data) ? data : data.data || [];
          setSupplierContacts(contactsList);
        })
        .catch((err) => {
          console.error("取引先担当者マスタの取得に失敗しました", err);
          setSupplierContacts([]);
        });
    }
  };

  const handleContactSelect = (contactId: string) => {
    setSelectedContactId(contactId);
    if (!contactId) return;
    const contact = supplierContacts.find((c) => c.id === contactId);
    if (contact && contact.email) {
      setRecipientEmail(contact.email);
    }
  };

  const handleSendSingleMail = async () => {
    if (!mailModalOrderId || !recipientEmail) return;
    setIsMailSending(true);
    setError("");
    try {
      const data = await apiFetch<{ message?: string }>(`/api/purchase-orders/${mailModalOrderId}/send-email`, {
        method: "POST",
        json: { recipientEmail },
        defaultErrorMessage: "メール送信に失敗しました",
      });
      setMessage(data.message || "📧 メールの送信を予約しました");
      setMailModalOrderId(null);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsMailSending(false);
    }
  };

  const handleBulkMailSend = async () => {
    if (selectedOrderIds.length === 0) return;
    setIsMailSending(true);
    setError("");
    try {
      const data = await apiFetch<{ message?: string }>("/api/purchase-orders/bulk-send-email", {
        method: "POST",
        json: { orderIds: selectedOrderIds },
        defaultErrorMessage: "一括送信リレーに失敗しました",
      });
      setMessage(data.message || "一括送信を予約しました");
      setSelectedOrderIds([]);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsMailSending(false);
    }
  };


  const setPage = (nextPage: number) =>
    void syncOrders(filterStatus, searchFilters, { page: nextPage });
  const setLimit = (nextLimit: number) =>
    void syncOrders(filterStatus, searchFilters, { limit: nextLimit, page: 1 });

  return {
    paginationEnabled,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    orders,
    sortBy: sortKeys[0]?.key ?? null,
    sortDirection: sortKeys[0]?.direction ?? "asc",
    sortKeys,
    setSort,
    allItems,
    projects,
    suppliers,
    userMaster,
    units,
    taxCategories,
    accounts,
    businessLocations,
    warehouses,
    partnerId,
    setPartnerId,
    onSupplierMasterSelect,
    requestId,
    projectId,
    setProjectId,
    purchasePersonEmployeeNumber,
    setPurchasePersonEmployeeNumber,
    inputPersonEmployeeNumber,
    setInputPersonEmployeeNumber,
    companyName,
    setCompanyName,
    companyDepartment,
    setCompanyDepartment,
    companyAddress,
    setCompanyAddress,
    companyTel,
    setCompanyTel,
    companyFax,
    setCompanyFax,
    deliveryDate,
    setDeliveryDate,
    deliveryPlace,
    setDeliveryPlace,
    deliveryLocationId,
    setDeliveryLocationId,
    deliveryWarehouseId,
    setDeliveryWarehouseId,
    paymentTerms,
    setPaymentTerms,
    isPaid,
    setIsPaid,
    paidAt,
    setPaidAt,
    attachments,
    handleAddAttachmentRow,
    handleRemoveAttachmentRow,
    handleFileSelection,
    handleAttachmentFileNameChange,
    handleAttachmentExternalUrlChange,
    filterStatus,
    setFilterStatus,
    searchFilters,
    setSearchFilters,
    handleClearSearchFilters,
    viewMode,
    setViewMode,
    editingId,
    editingStatus,
    title,
    setTitle,
    orderDate,
    setOrderDate,
    memo,
    setMemo,
    items,
    addItemRow,
    updateItemRow,
    onItemTypeChange,
    onItemMasterSelect,
    onItemQuantityChange,
    removeItemRow,
    moveItemUp,
    moveItemDown,
    totalAmount,
    taxAmount,
    calcSubTotal,
    calcGrossSubTotal,
    calcDiscountTotal,
    calcTax,
    calcTaxBreakdown,
    calcTotal,
    isApprovedEdit,
    isLocked,
    message,
    setMessage,
    error,
    setError,
    isSubmitting,
    isMailSending,
    selectedOrderIds,
    setSelectedOrderIds,
    showRequisitionPicker,
    setShowRequisitionPicker,
    showSalesOrderShortagePicker,
    setShowSalesOrderShortagePicker,
    showOrderReorderPicker,
    setShowOrderReorderPicker,
    showReorderSuggestionPicker,
    setShowReorderSuggestionPicker,
    handlePrefillFromRequisition,
    mailModalOrderId,
    setMailModalOrderId,
    recipientEmail,
    setRecipientEmail,
    supplierContacts,
    selectedContactId,
    handleContactSelect,
    isEmailRestrictedToContacts,
    handleClearForm,
    handleSelectEdit,
    handleSubmit,
    handleSubmitForApproval,
    handleDeleteLink,
    handleDownloadCsv,
    handleImportCsv,
    handleGeneratePdf,
    handleOpenMailModal,
    handleSendSingleMail,
    handleBulkMailSend,
  };
}
