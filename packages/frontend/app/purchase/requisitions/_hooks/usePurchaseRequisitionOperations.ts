import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import {
  PurchaseRequisitionRecord,
  PurchaseRequisitionItemRecord,
  PurchaseRequisitionCategory,
  PurchaseRequisitionAttachment,
  ItemMaster,
  ProjectLookup,
  DepartmentOption,
  PartnerLookup,
  UserOption,
  UnitLookup,
  TaxCategoryLookup,
  AccountLookup,
  PurchaseRequisitionPrefillData,
} from "../_types";
import type { ApplicantDepartmentOption } from "../../../types";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { roundTaxAmount } from "../../../_shared/tax-amounts";
import { useTaxRoundingMode } from "../../../_shared/hooks/use-tax-rounding-mode";
import { todayJst } from "../../../_shared/jst-date";

interface UsePurchaseRequisitionOperationsProps {
  canRead: boolean;
  isPurchaseRequisitionWfEnabled: boolean;
  departments: ApplicantDepartmentOption[];
  permsLoading: boolean;
  // Item7残課題(見積へも展開)と同じ、申請者/入力者欄の新規作成時の既定値
  currentUserEmployeeNumber?: string;
}

// Item9 Phase3: master/product-structures(_hooks/useBomOperations.ts)のスタイルに倣い、
// 検索/CRUD/承認申請/CSVを1つのフックに集約する(見積の4分割は本機能の規模には過剰なため踏襲しない)
export function usePurchaseRequisitionOperations({
  canRead,
  isPurchaseRequisitionWfEnabled,
  departments,
  permsLoading,
  currentUserEmployeeNumber,
}: UsePurchaseRequisitionOperationsProps) {
  const [requisitions, setRequisitions] = useState<PurchaseRequisitionRecord[]>([]);
  const [allItems, setAllItems] = useState<ItemMaster[]>([]);
  const [projects, setProjects] = useState<ProjectLookup[]>([]);
  const [orgDepartments, setOrgDepartments] = useState<DepartmentOption[]>([]);
  const [suppliers, setSuppliers] = useState<PartnerLookup[]>([]);
  const [userMaster, setUserMaster] = useState<UserOption[]>([]);
  const [units, setUnits] = useState<UnitLookup[]>([]);
  const [taxCategories, setTaxCategories] = useState<TaxCategoryLookup[]>([]);
  const [accounts, setAccounts] = useState<AccountLookup[]>([]);

  const [filterStatus, setFilterStatus] = useState("all");
  // 追加要望: コード/件名/仕入先/含まれる商品/作成日(FROM・TO)/自社担当者での絞り込み検索
  // (billing/paymentのfilters(Record<string,string>)と同じ方針)
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
  // 見積(useQuoteListActions.ts)と同じ「LIST/FORM完全切替」パターン
  const [viewMode, setViewMode] = useState<"LIST" | "FORM">("LIST");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [departmentSurrogateId, setDepartmentSurrogateId] = useState("");
  const [requestType, setRequestType] = useState<PurchaseRequisitionCategory>("ONE_TIME");
  const [memo, setMemo] = useState("");
  const [items, setItems] = useState<PurchaseRequisitionItemRecord[]>([]);
  // Phase3フォローアップ: 仕入先(マスタ選択/手入力両対応、品目と同じパターン)
  const [partnerId, setPartnerId] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [partnerInputType, setPartnerInputType] = useState<"MASTER" | "DIRECT">("MASTER");
  // Phase3フォローアップ: 見積との項目整合。勘定科目はヘッダー1件につき1つ
  const [projectId, setProjectId] = useState("");
  // 見積のsalesPersonEmployeeNumber/inputPersonEmployeeNumberと同じ2担当者分離
  const [applicantId, setApplicantId] = useState("");
  const [inputPersonEmployeeNumber, setInputPersonEmployeeNumber] = useState("");
  // Phase3フォローアップ: 添付ファイル(R2/共有リンク両対応、quote_attachmentsと同じ行配列モデル)
  const [attachments, setAttachments] = useState<PurchaseRequisitionAttachment[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File>>({});

  const [applicantDepartmentSurrogateId, setApplicantDepartmentSurrogateId] = useState<
    string | null
  >(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // departmentsはusePagePermissions()から非同期に取得されるため、useState初期値の反映漏れ対策
  // (追加要望F実装時に発見した既存パターン、受注/購買申請とも同じ対策を踏襲)
  useEffect(() => {
    if (applicantDepartmentSurrogateId === null && departments.length > 0) {
      setApplicantDepartmentSurrogateId(departments[0].surrogateId);
      if (!departmentSurrogateId) {
        setDepartmentSurrogateId(departments[0].surrogateId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments]);

  // currentUserEmployeeNumberも非同期に取得されるため、departmentsと同じ反映漏れ対策
  // (新規作成時の申請者/入力者の既定値。ユーザーが既に選択済みの値は上書きしない)
  useEffect(() => {
    if (!currentUserEmployeeNumber || editingId) return;
    setApplicantId((prev) => prev || currentUserEmployeeNumber);
    setInputPersonEmployeeNumber((prev) => prev || currentUserEmployeeNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserEmployeeNumber]);

  useEffect(() => {
    if (permsLoading || !canRead) return;

    // グループ化を一切せず、7つのマスタ取得を完全に独立させる。1つ前の修正で
    // 「品目/勘定科目/部署」を新規追加の「ユーザー」取得と同じグループにまとめてしまい、
    // ユーザー取得の失敗が他の3つまで巻き添えにする同種のバグを再発させていたため、
    // 今回はPromise.allSettledで各取得を完全に独立させ、1つの失敗が他に一切影響しない設計にする
    async function loadMasterData() {
      const [
        itemsResult,
        projectsResult,
        deptsResult,
        usersResult,
        suppliersResult,
        unitsResult,
        taxCategoriesResult,
        accountsResult,
      ] = await Promise.allSettled([
        // Item9 Phase3フォローアップで発覚した不具合修正: "/api/items"という存在しないエンドポイントを
        // 呼んでいたため品目マスタが常に空だった。品目(products)マスタは/api/products(quotesの
        // ProductMasterと同じ、内部的にitemsテーブルを参照)を使う
        apiFetch<ItemMaster[]>("/api/products"),
        apiFetch<ProjectLookup[]>("/api/projects?status=active"),
        apiFetch<DepartmentOption[]>("/api/departments?status=active"),
        apiFetch<UserOption[]>("/api/users"),
        apiFetch<PartnerLookup[]>("/api/partners?type=SUPPLIER"),
        apiFetch<UnitLookup[]>("/api/units"),
        apiFetch<TaxCategoryLookup[]>("/api/tax-categories"),
        apiFetch<AccountLookup[]>("/api/accounts"),
      ]);

      if (itemsResult.status === "fulfilled") setAllItems(itemsResult.value);
      else console.error("品目マスタの取得に失敗しました", itemsResult.reason);

      if (projectsResult.status === "fulfilled") setProjects(projectsResult.value);
      else console.error("プロジェクトマスタの取得に失敗しました", projectsResult.reason);

      if (deptsResult.status === "fulfilled") setOrgDepartments(deptsResult.value);
      else console.error("部署マスタの取得に失敗しました", deptsResult.reason);

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
    }

    void loadMasterData();
  }, [permsLoading, canRead]);

  // BUG-032: 会社設定の「一覧のページ分割」に従う(仕入計上など他の一覧と同じ作り)
  const { paginationEnabled } = usePaginationSetting();
  const [page, setPageState] = useState(1);
  const [limit, setLimitState] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const syncRequisitions = useCallback(
    async (
      status: string,
      filters: Record<string, string> = searchFilters,
      overrides?: { page?: number; limit?: number },
    ) => {
      if (permsLoading || !canRead) return;
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
          | PurchaseRequisitionRecord[]
          | { data: PurchaseRequisitionRecord[]; pagination: { total: number; totalPages: number } }
        >(
          `/api/purchase-requisitions?${params.toString()}`,
        );
        if (Array.isArray(data)) {
          setRequisitions(data);
          setTotal(data.length);
          setTotalPages(1);
        } else {
          setRequisitions(data.data);
          setTotal(data.pagination.total);
          setTotalPages(data.pagination.totalPages);
        }
        if (overrides?.page !== undefined) setPageState(overrides.page);
        if (overrides?.limit !== undefined) setLimitState(overrides.limit);
      } catch (err) {
        console.error("購買申請一覧の取得に失敗しました", err);
      }
    },
    [permsLoading, canRead, sortKeys, searchFilters, paginationEnabled, page, limit],
  );

  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedSearchFilters = useDebouncedValue(searchFilters);
  useEffect(() => {
    void syncRequisitions(filterStatus, debouncedSearchFilters, { page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoading, canRead, filterStatus, sortKeys, debouncedSearchFilters, paginationEnabled]);

  const handleClearForm = useCallback(() => {
    setEditingId(null);
    setEditingStatus(null);
    setTitle("");
    setDepartmentSurrogateId(departments[0]?.id ?? "");
    setRequestType("ONE_TIME");
    setMemo("");
    setItems([]);
    setPartnerId("");
    setPartnerName("");
    setPartnerInputType("MASTER");
    setProjectId("");
    setApplicantId(currentUserEmployeeNumber || "");
    setInputPersonEmployeeNumber(currentUserEmployeeNumber || "");
    setAttachments([]);
    setSelectedFiles({});
    setError("");
  }, [departments, currentUserEmployeeNumber]);

  // 一覧の検索結果(searchRequisitions)は明細を含まないため、必ず詳細取得
  // (GET /api/purchase-requisitions/:id)でヘッダー・明細・添付を取り直してからフォームへ反映する。
  // 一覧の行データをそのまま使うと明細が空のままフォームが開き、上書き保存で明細が全消しされる
  const handleSelectEdit = useCallback(async (record: PurchaseRequisitionRecord) => {
    setError("");
    let detail: PurchaseRequisitionRecord;
    try {
      detail = await apiFetch<PurchaseRequisitionRecord>(
        `/api/purchase-requisitions/${record.id}`,
        { defaultErrorMessage: "購買申請詳細の取得に失敗しました" },
      );
    } catch (err) {
      // 詳細取得に失敗した状態でフォームを開くと、明細が空のまま保存されて既存明細を失うため開かない
      setError(err instanceof Error ? err.message : "購買申請詳細の取得に失敗しました");
      return;
    }

    setEditingId(detail.id);
    setEditingStatus(detail.status);
    setTitle(detail.title);
    setDepartmentSurrogateId(detail.departmentSurrogateId);
    setRequestType(detail.requestType);
    setMemo(detail.memo || "");
    setItems(detail.items || []);
    setPartnerId(detail.partnerId || "");
    setPartnerName(detail.partnerName || "");
    setPartnerInputType(detail.partnerInputType || "MASTER");
    setProjectId(detail.projectId || "");
    setApplicantId(detail.applicantId || "");
    setInputPersonEmployeeNumber(detail.inputPersonEmployeeNumber || "");
    setAttachments(detail.attachments || []);
    setSelectedFiles({});
    setViewMode("FORM");
  }, []);

  // Phase4: 起票トリガー②③・「コピーして下書き作成」共通。purchase/orders/_hooks/usePurchaseOrderOperations.ts
  // のhandlePrefillFromRequisitionと同じ方針。この時点ではDBに一切書き込まず、フォームへ初期値を反映するのみ
  // (確定は通常の保存操作/申請操作で行う)
  const applyPrefillData = useCallback(
    (data: PurchaseRequisitionPrefillData) => {
      handleClearForm();
      setTitle(data.title);
      setPartnerId(data.partnerId || "");
      setPartnerName(data.partnerName || "");
      setPartnerInputType(data.partnerInputType || "MASTER");
      setProjectId(data.projectId || "");
      setMemo(data.memo || "");
      setItems(data.items);
      setViewMode("FORM");
    },
    [handleClearForm],
  );

  // 起票トリガー②: 受注の欠品明細から購買申請を起票する(SalesOrderPickerModal経由)
  const handlePrefillFromSalesOrder = useCallback(
    (data: PurchaseRequisitionPrefillData) => applyPrefillData(data),
    [applyPrefillData],
  );

  // 起票トリガー③: 過去の発注を選び直して再発注する(PurchaseOrderPickerModal経由)
  const handlePrefillFromPurchaseOrder = useCallback(
    (data: PurchaseRequisitionPrefillData) => applyPrefillData(data),
    [applyPrefillData],
  );

  // Item9 Phase7: 起票トリガー①(欠品自動提案②、発注点/安全在庫方式、ReorderSuggestionPickerModal経由)
  const handlePrefillFromReorderSuggestion = useCallback(
    (data: PurchaseRequisitionPrefillData) => applyPrefillData(data),
    [applyPrefillData],
  );

  // 「コピーして下書き作成」: 既存の購買申請(ステータス問わず)を別レコードとしてコピーする。
  // 一覧の検索結果(searchRequisitions)は明細を含まないため、明細のみ詳細取得で補う
  // (ヘッダー項目は一覧の行データで揃っているため再取得しない)
  const handleCopyToNewDraft = useCallback(
    async (record: PurchaseRequisitionRecord) => {
      setError("");
      try {
        const detail = await apiFetch<{ items?: PurchaseRequisitionItemRecord[] }>(
          `/api/purchase-requisitions/${record.id}`,
        );
        applyPrefillData({
          title: `${record.title}(コピー)`,
          partnerId: record.partnerId,
          partnerName: record.partnerName,
          partnerInputType: record.partnerInputType || "MASTER",
          projectId: record.projectId,
          memo: record.memo,
          items: (detail.items || []).map((it) => ({
            itemId: it.itemId,
            itemName: it.itemName,
            inputType: it.inputType || "MASTER",
            quantity: it.quantity,
            estimatedUnitPrice: it.estimatedUnitPrice,
            unitCode: it.unitCode,
            taxCategoryCode: it.taxCategoryCode,
            memo: it.memo,
            // コピー元の受注紐付けトレーサビリティは引き継がない(新規に独立した申請のため)
            salesOrderItemId: null,
          })),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "購買申請明細の取得に失敗しました");
      }
    },
    [applyPrefillData],
  );

  const addItemRow = useCallback(() => {
    setItems((prev) => [
      ...prev,
      {
        itemId: "",
        itemName: "",
        inputType: "MASTER",
        quantity: 1,
        estimatedUnitPrice: 0,
        unitCode: "",
        taxCategoryCode: "",
        memo: "",
      },
    ]);
  }, []);

  // quote_itemsのhandleMoveItemUp/handleMoveItemDownと同じ方針(配列の並び順=sortOrder、
  // サーバー側はinsert時の配列インデックスをsortOrderとして保存する)
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

  const updateItemRow = useCallback(
    (index: number, patch: Partial<PurchaseRequisitionItemRecord>) => {
      setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
    },
    [],
  );

  // quote_itemsのhandleItemTypeChangeと同じ方針: 形式(マスタ選択/手入力)切替時は
  // itemId/itemNameをクリアする(切替前の値を引きずらないため)
  const onItemTypeChange = useCallback((index: number, type: "MASTER" | "DIRECT") => {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, inputType: type, itemId: "", itemName: "" } : it)),
    );
  }, []);

  const removeItemRow = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // 見積のfetchSpecialPriceと同じ方針(/api/product-prices)。priceType="PURCHASE"+仕入先(partnerId)+
  // 品目+数量で、商品単価マスタに登録済みの仕入単価(数量帯に応じた特値)を検索する。
  // 一致する行が無ければnullを返し、その場合estimatedUnitPriceは変更しない(手入力のまま)
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

  // 品目をマスタ選択した際、単位/税区分に加えて仕入先向けの登録済み単価があれば自動反映する
  const onItemMasterSelect = useCallback(
    async (index: number, itemId: string) => {
      const selected = allItems.find((i) => i.id === itemId);
      updateItemRow(index, {
        itemId,
        unitCode: selected?.baseUnitCode || "",
        taxCategoryCode: selected?.taxCategoryCode || "",
      });
      if (partnerInputType === "MASTER" && partnerId && itemId) {
        const currentQuantity = items[index]?.quantity || 1;
        const price = await fetchPurchasePrice(partnerId, itemId, currentQuantity);
        if (price !== null) updateItemRow(index, { estimatedUnitPrice: price });
      }
    },
    [allItems, partnerId, partnerInputType, items, updateItemRow, fetchPurchasePrice],
  );

  // 数量変更時も数量帯によって単価が変わりうるため、マスタ選択済みの行は仕入単価を再取得する
  const onItemQuantityChange = useCallback(
    async (index: number, quantity: number) => {
      updateItemRow(index, { quantity });
      const currentItem = items[index];
      if (
        currentItem &&
        (currentItem.inputType || "MASTER") === "MASTER" &&
        partnerInputType === "MASTER" &&
        partnerId &&
        currentItem.itemId
      ) {
        const price = await fetchPurchasePrice(partnerId, currentItem.itemId, quantity);
        if (price !== null) updateItemRow(index, { estimatedUnitPrice: price });
      }
    },
    [items, partnerId, partnerInputType, updateItemRow, fetchPurchasePrice],
  );

  // 品目のonItemTypeChangeと同じ方針: 仕入先の形式(マスタ選択/手入力)切替時は
  // partnerId/partnerNameをクリアする(切替前の値を引きずらないため)
  const onPartnerTypeChange = useCallback((type: "MASTER" | "DIRECT") => {
    setPartnerInputType(type);
    setPartnerId("");
    setPartnerName("");
  }, []);

  // 見積のhandleCustomerChangeと同じ方針: 仕入先(マスタ選択)を切り替えた際、既に選択済みの
  // マスタ品目行すべてについて、新しい仕入先での登録単価を再取得して反映する
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
          return found ? { ...it, estimatedUnitPrice: found.price } : it;
        }),
      );
    },
    [items, fetchPurchasePrice],
  );

  // useQuoteForm.tsの添付ファイルハンドラと同じ方針
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

  const handleFileSelection = useCallback(
    (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setAttachments((prev) =>
        prev.map((att, i) => (i === index ? { ...att, fileName: file.name } : att)),
      );
      setSelectedFiles((prev) => ({ ...prev, [file.name]: file }));
    },
    [],
  );

  const handleAttachmentFileNameChange = useCallback((index: number, value: string) => {
    setAttachments((prev) => prev.map((att, i) => (i === index ? { ...att, fileName: value } : att)));
  }, []);

  const handleAttachmentExternalUrlChange = useCallback((index: number, value: string) => {
    setAttachments((prev) =>
      prev.map((att, i) => (i === index ? { ...att, externalUrl: value } : att)),
    );
  }, []);

  // useQuoteForm.tsのcalcSubTotal/calcTaxBreakdown/calcTax/calcTotalをそのまま移植
  // (unitPrice→estimatedUnitPriceに読み替えのみ)。値引き行(金額マイナス)にも対応
  const calcDiscountTotal = useCallback(
    () =>
      items.reduce((sum, it) => {
        const amount = (it.quantity || 0) * (it.estimatedUnitPrice || 0);
        return amount < 0 ? sum + amount : sum;
      }, 0),
    [items],
  );

  const calcGrossSubTotal = useCallback(
    () =>
      items.reduce((sum, it) => {
        const amount = (it.quantity || 0) * (it.estimatedUnitPrice || 0);
        return amount >= 0 ? sum + amount : sum;
      }, 0),
    [items],
  );

  const calcSubTotal = useCallback(
    () => calcGrossSubTotal() + calcDiscountTotal(),
    [calcGrossSubTotal, calcDiscountTotal],
  );

  // BUG-042: 消費税の端数処理(会社設定)
  const taxRoundingMode = useTaxRoundingMode();

  const calcTaxBreakdown = useCallback(() => {
    const buckets = {
      rate10: { excl: 0, tax: 0 },
      rate8: { excl: 0, tax: 0 },
      rate0: { excl: 0, tax: 0 },
    };
    for (const it of items) {
      const amount = (it.quantity || 0) * (it.estimatedUnitPrice || 0);
      const rate = it.taxCategoryCode
        ? (taxCategories.find((t) => t.code === it.taxCategoryCode)?.taxRate ?? 0.1)
        : 0.1;
      const bucket =
        Math.abs(rate - 0.1) < 1e-9 ? "rate10" : Math.abs(rate - 0.08) < 1e-9 ? "rate8" : "rate0";
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

  const isApprovedEdit = editingStatus === "APPROVED" && isPurchaseRequisitionWfEnabled;
  const isLocked =
    isPurchaseRequisitionWfEnabled &&
    (editingStatus === "PENDING_APPROVAL" || editingStatus === "PENDING_DELETION");

  const buildRequisitionJson = () => ({
    id: editingId || undefined,
    title,
    departmentSurrogateId,
    requestType,
    partnerId: partnerId || null,
    partnerName: partnerName || null,
    partnerInputType,
    projectId: projectId || null,
    applicantId: applicantId || null,
    inputPersonEmployeeNumber: inputPersonEmployeeNumber || null,
    totalAmount,
    taxAmount,
    memo: memo.trim() === "" ? null : memo,
    items: items.map((it) => ({
      itemId: it.itemId,
      itemName: it.itemName || null,
      inputType: it.inputType || "MASTER",
      quantity: it.quantity,
      estimatedUnitPrice: it.estimatedUnitPrice,
      unitCode: it.unitCode || null,
      taxCategoryCode: it.taxCategoryCode || null,
      memo: it.memo || null,
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

    const hasInvalidItem = items.some(
      (it) => !it.itemId || (it.inputType === "DIRECT" && !it.itemName),
    );
    if (hasInvalidItem) {
      setError("品目(またはマスタ外品目の品目名)が未入力の明細行があります");
      return;
    }
    if (!departmentSurrogateId) {
      setError("申請部署(所属部署)を選択してください");
      return;
    }
    if (partnerInputType === "DIRECT" ? !partnerName : !partnerId) {
      setError("仕入先(またはマスタ外仕入先の名称)を選択・入力してください");
      return;
    }
    if (!projectId) {
      setError("勘定科目を選択してください");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isApprovedEdit) {
        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "purchase_requisitions",
            targetId: editingId,
            requestType: "UPDATE",
            payload: {
              header: {
                title,
                departmentSurrogateId,
                requestType,
                partnerId: partnerId || null,
                partnerName: partnerName || null,
                partnerInputType,
                projectId: projectId || null,
                applicantId: applicantId || null,
                inputPersonEmployeeNumber: inputPersonEmployeeNumber || null,
                totalAmount,
                taxAmount,
                memo: memo.trim() === "" ? null : memo,
              },
              items: items.map((it) => ({
                itemId: it.itemId,
                itemName: it.itemName || null,
                inputType: it.inputType || "MASTER",
                quantity: it.quantity,
                estimatedUnitPrice: it.estimatedUnitPrice,
                unitCode: it.unitCode || null,
                taxCategoryCode: it.taxCategoryCode || null,
                memo: it.memo || null,
              })),
            },
            applicantDepartmentSurrogateId,
            comment: `購買申請[${editingId}]の変更申請`,
          },
          defaultErrorMessage: "変更の申請に失敗しました",
        });
        setMessage("購買申請の変更を申請しました");
        setViewMode("LIST");
        handleClearForm();
        void syncRequisitions(filterStatus);
        return;
      }

      const formData = new FormData();
      formData.append("requisitionData", JSON.stringify(buildRequisitionJson()));
      Object.keys(selectedFiles).forEach((key) => {
        const file = selectedFiles[key];
        if (file) formData.append(`files[${file.name}]`, file);
      });

      const url = editingId
        ? `/api/purchase-requisitions/${editingId}`
        : "/api/purchase-requisitions/register";
      const data = await apiFetch<{ id?: string }>(url, {
        method: editingId ? "PUT" : "POST",
        body: formData,
        defaultErrorMessage: "購買申請の保存に失敗しました",
      });

      setMessage(editingId ? "購買申請を更新しました" : "購買申請を新規登録しました");
      if (!editingId && data.id) {
        setEditingId(data.id);
        setEditingStatus("DRAFT");
      }
      void syncRequisitions(filterStatus);
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
      const data = await apiFetch<{ message?: string }>(
        `/api/purchase-requisitions/${editingId}/submit-for-approval`,
        {
          method: "POST",
          json: { applicantDepartmentSurrogateId: applicantDepartmentSurrogateId || null },
          defaultErrorMessage: "承認申請に失敗しました",
        },
      );
      setMessage(data.message || "承認を申請しました");
      setViewMode("LIST");
      handleClearForm();
      void syncRequisitions(filterStatus);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteLink = async (record: PurchaseRequisitionRecord) => {
    setIsSubmitting(true);
    setError("");
    try {
      const data = await apiFetch<{ message?: string }>(
        `/api/purchase-requisitions/${record.id}/request-deletion`,
        { method: "POST", defaultErrorMessage: "削除処理に失敗しました" },
      );
      setMessage(data.message || "削除処理が完了しました");
      void syncRequisitions(filterStatus);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadCsv = async () => {
    setMessage("⌛ CSVファイルを生成中...");
    try {
      const res = await fetch("/api/purchase-requisitions/csv-download", {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) throw new Error("サーバー側でのCSV生成に失敗しました");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `purchase_requisitions_export_${todayJst()}.csv`,
      );
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
    setIsSubmitting(true);
    setError("");
    setMessage("");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const data = await apiFetch<{ message?: string }>("/api/purchase-requisitions/bulk-register", {
        method: "POST",
        body: formData,
        defaultErrorMessage: "インポートに失敗しました",
      });
      setMessage(data.message || "CSVインポートが完了しました");
      void syncRequisitions(filterStatus);
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };


  const setPage = (nextPage: number) =>
    void syncRequisitions(filterStatus, searchFilters, { page: nextPage });
  const setLimit = (nextLimit: number) =>
    void syncRequisitions(filterStatus, searchFilters, { limit: nextLimit, page: 1 });

  return {
    paginationEnabled,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    requisitions,
    sortBy: sortKeys[0]?.key ?? null,
    sortDirection: sortKeys[0]?.direction ?? "asc",
    sortKeys,
    setSort,
    allItems,
    projects,
    orgDepartments,
    suppliers,
    userMaster,
    units,
    taxCategories,
    accounts,
    partnerId,
    setPartnerId,
    partnerName,
    setPartnerName,
    partnerInputType,
    onPartnerTypeChange,
    onSupplierMasterSelect,
    projectId,
    setProjectId,
    applicantId,
    setApplicantId,
    inputPersonEmployeeNumber,
    setInputPersonEmployeeNumber,
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
    departmentSurrogateId,
    setDepartmentSurrogateId,
    requestType,
    setRequestType,
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
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    message,
    setMessage,
    error,
    setError,
    isSubmitting,
    handleClearForm,
    handleSelectEdit,
    handlePrefillFromSalesOrder,
    handlePrefillFromPurchaseOrder,
    handlePrefillFromReorderSuggestion,
    handleCopyToNewDraft,
    handleSubmit,
    handleSubmitForApproval,
    handleDeleteLink,
    handleDownloadCsv,
    handleImportCsv,
  };
}
