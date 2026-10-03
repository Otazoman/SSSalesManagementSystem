import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { ApiListResponse } from "../../../_shared/api/response-types";
import {
  QuoteRecord,
  PartnerMaster,
  ProductMaster,
  UserOption,
  UnitLookup,
  TaxCategoryLookup,
  ProjectLookup,
} from "../_types";
import { todayJst } from "../../../_shared/jst-date";
import { fetchPartnersOfTypes } from "../../../_shared/partner-options";

const DUMMY_PRODUCTS: ProductMaster[] = [
  { id: "PROD-001", name: "スタンダードサーバープラン", price: 50000 },
  { id: "PROD-002", name: "プレミアムデータベース", price: 120000 },
  { id: "PROD-003", name: "クラウドストレージ 1TB", price: 15000 },
  { id: "PROD-004", name: "導入保守サポートマニュアル", price: 30000 },
];

interface RawUserRelation {
  departmentId?: string;
  department_id?: string;
}

interface RawUserRecord {
  id: string;
  name: string;
  employeeNumber: string;
  department?: string;
  relations?: RawUserRelation[];
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface UseQuotesProps {
  canRead: boolean;
  permsLoading: boolean;
}

export function useQuotes({ canRead, permsLoading }: UseQuotesProps) {
  const { paginationEnabled } = usePaginationSetting();
  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);
  const [page, setPageState] = useState(1);
  const [limit, setLimitState] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const lastFiltersRef = useRef<Record<string, string>>({});
  const [partners, setPartners] = useState<PartnerMaster[]>([]);
  const [products, setProducts] = useState<ProductMaster[]>([]);
  const [userMaster, setUserMaster] = useState<UserOption[]>([]);
  const [units, setUnits] = useState<UnitLookup[]>([]);
  const [taxCategories, setTaxCategories] = useState<TaxCategoryLookup[]>([]);
  const [projects, setProjects] = useState<ProjectLookup[]>([]);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMailSending, setIsMailSending] = useState(false);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

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

  const fetchPartners = useCallback(async () => {
    try {
      // 得意先・兼用に加え、見込み客(商談管理の対象)宛にも見積を作れる(BUG-067: 兼用を含める)
      const partnerList = await fetchPartnersOfTypes<PartnerMaster>(["CUSTOMER", "BOTH", "PROSPECT"]);
      const filtered = partnerList.filter(
        (c) => !c.type || c.type === "CUSTOMER" || c.type === "BOTH" || c.type === "PROSPECT",
      );
      setPartners(filtered);
    } catch (err) {
      console.error("取引先マスタの取得に失敗しました", err);
      setPartners([
        { id: "CUSTOMER-001", name: "鈴木産業 株式会社", type: "CUSTOMER" },
        {
          id: "CUSTOMER-002",
          name: "マトリクスシステムズ 開発部",
          type: "CUSTOMER",
        },
        {
          id: "CUSTOMER-003",
          name: "合同会社 東海ロジスティクス",
          type: "CUSTOMER",
        },
      ]);
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      // GET /api/products はstandardSalesPrice/standardPurchasePriceで返す
      // (products.repository.tsのPRODUCT_SELECT_COLUMNS参照。ProductMasterの`price`という
      // キーはbackendに存在しないため、ここで得意先向けの標準売価へ変換する)
      const data = await apiFetch<
        Array<Omit<ProductMaster, "price"> & { standardSalesPrice?: number }>
      >("/api/products");
      setProducts(data.map((p) => ({ ...p, price: p.standardSalesPrice ?? 0 })));
    } catch (err) {
      console.error("品目マスタの取得に失敗しました", err);
      setProducts(DUMMY_PRODUCTS);
    }
  }, []);

  useEffect(() => {
    if (permsLoading || !canRead) return;

    async function loadMasterData() {
      try {
        // 💡 ユーザー一覧と部署マスタを同時に取得
        const [fetchedUsers, fetchedDepts] = await Promise.all([
          apiFetch<RawUserRecord[]>("/api/users"),
          apiFetch<DepartmentOption[]>("/api/departments?status=active"),
        ]);

        // Item4-b: 見積明細の単位・税区分選択肢(master/productsと同じ取得パターン)
        try {
          const [fetchedUnits, fetchedTaxCategories] = await Promise.all([
            apiFetch<UnitLookup[]>("/api/units"),
            apiFetch<TaxCategoryLookup[]>("/api/tax-categories"),
          ]);
          setUnits(fetchedUnits);
          setTaxCategories(fetchedTaxCategories);
        } catch (err) {
          console.error("単位・税区分マスタの取得に失敗しました", err);
        }

        // 追加要望: プロジェクト選択肢(受注作成時にそのまま引き継ぐ)
        try {
          setProjects(await apiFetch<ProjectLookup[]>("/api/projects?status=active"));
        } catch (err) {
          console.error("プロジェクトマスタの取得に失敗しました", err);
        }

        // 💡 部署マスタ（全件）をステートにセット
        setDepartments(fetchedDepts);

        // 💡 ユーザーデータに relations から変換した「部署名一覧 (departmentNames)」を統合してセット
        const formattedUsers = fetchedUsers.map((u) => {
          const deptNames = (u.relations || [])
            .map((r) => {
              if (!r.departmentId) return "全社共通";
              const foundDept = fetchedDepts.find(
                (d) => d.id === r.departmentId,
              );
              return foundDept ? foundDept.name : "";
            })
            .filter(Boolean);

          return {
            ...u,
            departments: deptNames.length > 0 ? deptNames : [u.department || ""],
          };
        });

        setUserMaster(formattedUsers);
      } catch (err) {
        console.error("マスタの取得に失敗しました", err);
      }
    }

    void loadMasterData();
    void fetchPartners();
    void fetchProducts();
  }, [permsLoading, canRead, fetchPartners, fetchProducts]);

  // 💡 他master画面の`usePaginatedList`と異なり、呼び出し元(useQuoteListActions.ts等)が
  // 「現在の検索条件filtersを都度渡す」という既存の呼び出し規約になっているため、
  // ここでは`usePaginatedList`には委譲せず、同等のページング状態(page/limit/total/totalPages)を
  // 手動管理する。overrides未指定時は現在のpage/limitをそのまま使うため、
  // 呼び出し元の既存コード(`syncQuotes(filters)`)は変更なしでページングに対応する。
  const syncQuotes = useCallback(
    async (
      filters: Record<string, string>,
      overrides?: { page?: number; limit?: number },
    ) => {
      if (permsLoading || !canRead) return;
      lastFiltersRef.current = filters;
      const effectivePage = overrides?.page ?? page;
      const effectiveLimit = overrides?.limit ?? limit;

      try {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
          if (value && value !== "all") {
            params.append(key, value);
          }
        });
        if (paginationEnabled) {
          params.append("page", String(effectivePage));
          params.append("limit", String(effectiveLimit));
        }
        if (sortKeys.length > 0) {
          params.append("sortBy", sortKeys.map((s) => s.key).join(","));
          params.append("sortOrder", sortKeys.map((s) => s.direction).join(","));
        }

        const data = await apiFetch<QuoteRecord[] | ApiListResponse<QuoteRecord>>(
          `/api/quotes?${params.toString()}`,
        );

        if (Array.isArray(data)) {
          setQuotes(data);
          setTotal(data.length);
          setTotalPages(1);
        } else {
          setQuotes(data.data);
          setTotal(data.pagination.total);
          setTotalPages(data.pagination.totalPages);
        }

        if (overrides?.page !== undefined) setPageState(overrides.page);
        if (overrides?.limit !== undefined) setLimitState(overrides.limit);
      } catch (err) {
        console.error("見積一覧の取得に失敗しました", err);
      }
    },
    [permsLoading, canRead, paginationEnabled, page, limit, sortKeys],
  );

  const setPage = useCallback(
    (nextPage: number) => {
      void syncQuotes(lastFiltersRef.current, { page: nextPage });
    },
    [syncQuotes],
  );

  const setLimit = useCallback(
    (nextLimit: number) => {
      void syncQuotes(lastFiltersRef.current, { limit: nextLimit, page: 1 });
    },
    [syncQuotes],
  );

  // CSVインポートロジック（※ダイアログ確認後に実行する想定）
  const handleImportCSV = async (file: File) => {
    setIsSubmitting(true);
    setError("");
    setMessage("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const data = await apiFetch<{ message?: string }>(
        "/api/quotes/bulk-register",
        {
          method: "POST",
          body: formData,
          defaultErrorMessage: "インポートに失敗しました",
        },
      );

      setMessage(data.message || "CSVインポートが完了しました");
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportCSV = async () => {
    setMessage("⌛ CSVファイルを生成中...");
    try {
      const res = await fetch("/api/quotes/csv-download", {
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
        `quotes_export_${todayJst()}.csv`,
      );
      document.body.appendChild(link);
      link.click();

      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setMessage("📊 CSVファイルのダウンロードが完了しました");
    } catch (err) {
      console.error("CSVダウンロードエラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "CSVのダウンロード中にエラーが発生しました",
      );
    }
  };

  // Item4-e: DRAFT・未申請は直接削除、APPROVEDは削除承認申請となる(バックエンド側でステータスに応じて判定)
  const handleDeleteQuote = async (id: string) => {
    setIsSubmitting(true);
    try {
      const data = await apiFetch<{ message?: string }>(
        `/api/quotes/${id}/request-deletion`,
        {
          method: "POST",
          defaultErrorMessage: "削除処理に失敗しました",
        },
      );
      setMessage(data.message || "削除処理が完了しました");
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  // Item4-e: 下書き(DRAFT)の見積を承認申請する(承認機能OFF時はバックエンド側で直接確定される)
  const handleSubmitForApproval = async (
    id: string,
    applicantDepartmentSurrogateId?: string | null,
  ) => {
    setIsSubmitting(true);
    try {
      const data = await apiFetch<{ message?: string }>(
        `/api/quotes/${id}/submit-for-approval`,
        {
          method: "POST",
          json: { applicantDepartmentSurrogateId: applicantDepartmentSurrogateId || null },
          defaultErrorMessage: "承認申請に失敗しました",
        },
      );
      setMessage(data.message || "承認を申請しました");
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBulkMailSend = async (selectedQuoteIds: string[]) => {
    setIsMailSending(true);
    setMessage("");
    setError("");

    try {
      const data = await apiFetch<{ message?: string }>(
        "/api/quotes/bulk-send-email",
        {
          method: "POST",
          json: {
            quoteIds: selectedQuoteIds,
            fallbackOperatorId: "CURRENT_USER",
          },
          defaultErrorMessage: "一括送信リレーに失敗しました",
        },
      );

      setMessage(data.message || "一括送信を予約しました");
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
    } finally {
      setIsMailSending(false);
    }
  };

  const fetchSpecialPrice = async (
    custID: string,
    prodID: string,
    quantity: number,
  ): Promise<number | null> => {
    if (!custID || !prodID) return null;
    try {
      const data = await apiFetch<{ unitPrice?: number }[]>(
        `/api/product-prices?partnerId=${custID}&itemId=${prodID}&quantity=${quantity}`,
      );
      if (data && data.length > 0) {
        return data[0].unitPrice ?? null;
      }
    } catch (err) {
      console.error("得値の取得に失敗しました", err);
    }
    return null;
  };

  // 💡 個別メール送信ハンドラーの追加
  const handleSingleMailSend = async (params: {
    quoteId: string;
    recipientEmail: string;
    recipientName?: string;
    department?: string;
    customMessage?: string;
  }) => {
    setIsMailSending(true);
    setMessage("");
    setError("");

    try {
      await apiFetch(`/api/quotes/${params.quoteId}/send-email`, {
        method: "POST",
        json: params,
        defaultErrorMessage: "メール送信に失敗しました",
      });

      setMessage("📧 メールの送信を予約しました");
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
    } finally {
      setIsMailSending(false);
    }
  };

  return {
    quotes,
    sortBy: sortKeys[0]?.key ?? null,
    sortDirection: sortKeys[0]?.direction ?? "asc",
    sortKeys,
    setSort,
    paginationEnabled,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    partners,
    products,
    userMaster,
    departments,
    units,
    taxCategories,
    projects,
    message,
    setMessage,
    error,
    setError,
    isSubmitting,
    setIsSubmitting,
    isMailSending,
    syncQuotes,
    handleImportCSV,
    handleExportCSV,
    handleDeleteQuote,
    handleSubmitForApproval,
    handleBulkMailSend,
    handleSingleMailSend,
    fetchSpecialPrice,
  };
}
