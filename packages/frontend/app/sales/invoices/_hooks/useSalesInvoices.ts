import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { ApiListResponse } from "../../../_shared/api/response-types";
import {
  SalesInvoiceRecord,
  PartnerMaster,
  ProductMaster,
  UserOption,
  UnitLookup,
  TaxCategoryLookup,
  AccountLookup,
  ProjectLookup,
} from "../_types";
import { todayJst } from "../../../_shared/jst-date";

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

interface UseSalesInvoicesProps {
  canRead: boolean;
  permsLoading: boolean;
}

// Item8: quotes/_hooks/useQuotes.tsと同じ構成(メール送信・特殊ダミーデータ生成は対象外)
export function useSalesInvoices({ canRead, permsLoading }: UseSalesInvoicesProps) {
  const { paginationEnabled } = usePaginationSetting();
  const [invoices, setInvoices] = useState<SalesInvoiceRecord[]>([]);
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
  const [accounts, setAccounts] = useState<AccountLookup[]>([]);
  const [projects, setProjects] = useState<ProjectLookup[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMailSending, setIsMailSending] = useState(false);

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
      const data = await apiFetch<PartnerMaster[]>("/api/partners?type=CUSTOMER");
      setPartners(data.filter((p) => !p.type || p.type === "CUSTOMER"));
    } catch (err) {
      console.error("取引先マスタの取得に失敗しました", err);
      setPartners([]);
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const data = await apiFetch<
        Array<Omit<ProductMaster, "price"> & { standardSalesPrice?: number }>
      >("/api/products");
      setProducts(data.map((p) => ({ ...p, price: p.standardSalesPrice ?? 0 })));
    } catch (err) {
      console.error("品目マスタの取得に失敗しました", err);
      setProducts([]);
    }
  }, []);

  useEffect(() => {
    if (permsLoading || !canRead) return;

    async function loadMasterData() {
      try {
        const [fetchedUsers, fetchedDepts] = await Promise.all([
          apiFetch<RawUserRecord[]>("/api/users"),
          apiFetch<DepartmentOption[]>("/api/departments?status=active"),
        ]);

        try {
          const [fetchedUnits, fetchedTaxCategories, fetchedAccounts] = await Promise.all([
            apiFetch<UnitLookup[]>("/api/units"),
            apiFetch<TaxCategoryLookup[]>("/api/tax-categories"),
            apiFetch<AccountLookup[]>("/api/accounts"),
          ]);
          setUnits(fetchedUnits);
          setTaxCategories(fetchedTaxCategories);
          setAccounts(fetchedAccounts);
        } catch (err) {
          console.error("単位・税区分・勘定科目マスタの取得に失敗しました", err);
        }

        // 追加要望: プロジェクト選択肢(受注からそのまま引き継ぎ、単独売上は手動選択)
        try {
          setProjects(await apiFetch<ProjectLookup[]>("/api/projects?status=active"));
        } catch (err) {
          console.error("プロジェクトマスタの取得に失敗しました", err);
        }

        setDepartments(fetchedDepts);

        const formattedUsers = fetchedUsers.map((u) => {
          const deptNames = (u.relations || [])
            .map((r) => {
              if (!r.departmentId) return "全社共通";
              const foundDept = fetchedDepts.find((d) => d.id === r.departmentId);
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

  const syncInvoices = useCallback(
    async (filters: Record<string, string>, overrides?: { page?: number; limit?: number }) => {
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

        const data = await apiFetch<SalesInvoiceRecord[] | ApiListResponse<SalesInvoiceRecord>>(
          `/api/sales-invoices?${params.toString()}`,
        );

        if (Array.isArray(data)) {
          setInvoices(data);
          setTotal(data.length);
          setTotalPages(1);
        } else {
          setInvoices(data.data);
          setTotal(data.pagination.total);
          setTotalPages(data.pagination.totalPages);
        }

        if (overrides?.page !== undefined) setPageState(overrides.page);
        if (overrides?.limit !== undefined) setLimitState(overrides.limit);
      } catch (err) {
        console.error("売上一覧の取得に失敗しました", err);
      }
    },
    [permsLoading, canRead, paginationEnabled, page, limit, sortKeys],
  );

  const setPage = useCallback(
    (nextPage: number) => {
      void syncInvoices(lastFiltersRef.current, { page: nextPage });
    },
    [syncInvoices],
  );

  const setLimit = useCallback(
    (nextLimit: number) => {
      void syncInvoices(lastFiltersRef.current, { limit: nextLimit, page: 1 });
    },
    [syncInvoices],
  );

  const handleImportCSV = async (file: File) => {
    setIsSubmitting(true);
    setError("");
    setMessage("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const data = await apiFetch<{ message?: string }>("/api/sales-invoices/bulk-register", {
        method: "POST",
        body: formData,
        defaultErrorMessage: "インポートに失敗しました",
      });

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
      const res = await fetch("/api/sales-invoices/csv-download", {
        method: "GET",
        credentials: "include",
      });

      if (!res.ok) throw new Error("サーバー側でのCSV生成に失敗しました");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `sales_invoices_export_${todayJst()}.csv`);
      document.body.appendChild(link);
      link.click();

      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setMessage("📊 CSVファイルのダウンロードが完了しました");
    } catch (err) {
      console.error("CSVダウンロードエラー:", err);
      setError(err instanceof Error ? err.message : "CSVのダウンロード中にエラーが発生しました");
    }
  };

  const handleDeleteInvoice = async (id: string) => {
    setIsSubmitting(true);
    try {
      const data = await apiFetch<{ message?: string }>(`/api/sales-invoices/${id}/request-deletion`, {
        method: "POST",
        defaultErrorMessage: "削除処理に失敗しました",
      });
      setMessage(data.message || "削除処理が完了しました");
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitForApproval = async (
    id: string,
    applicantDepartmentSurrogateId?: string | null,
  ) => {
    setIsSubmitting(true);
    try {
      const data = await apiFetch<{ message?: string }>(
        `/api/sales-invoices/${id}/submit-for-approval`,
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

  // K-4-1: useQuotes.tsのhandleBulkMailSend/handleSingleMailSendと同型
  const handleBulkMailSend = async (selectedInvoiceIds: string[]) => {
    setIsMailSending(true);
    setMessage("");
    setError("");

    try {
      const data = await apiFetch<{ message?: string }>("/api/sales-invoices/bulk-send-email", {
        method: "POST",
        json: {
          invoiceIds: selectedInvoiceIds,
          fallbackOperatorId: "CURRENT_USER",
        },
        defaultErrorMessage: "一括送信リレーに失敗しました",
      });

      setMessage(data.message || "一括送信を予約しました");
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
    } finally {
      setIsMailSending(false);
    }
  };

  const handleSingleMailSend = async (params: { invoiceId: string; recipientEmail: string }) => {
    setIsMailSending(true);
    setMessage("");
    setError("");

    try {
      await apiFetch(`/api/sales-invoices/${params.invoiceId}/send-email`, {
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

  const fetchSpecialPrice = async (
    partnerId: string,
    prodID: string,
    quantity: number,
  ): Promise<number | null> => {
    if (!partnerId || !prodID) return null;
    try {
      const data = await apiFetch<{ unitPrice?: number }[]>(
        `/api/product-prices?partnerId=${partnerId}&itemId=${prodID}&quantity=${quantity}`,
      );
      if (data && data.length > 0) {
        return data[0].unitPrice ?? null;
      }
    } catch (err) {
      console.error("得値の取得に失敗しました", err);
    }
    return null;
  };

  return {
    invoices,
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
    accounts,
    projects,
    message,
    setMessage,
    error,
    setError,
    isSubmitting,
    setIsSubmitting,
    isMailSending,
    syncInvoices,
    handleImportCSV,
    handleExportCSV,
    handleDeleteInvoice,
    handleSubmitForApproval,
    handleBulkMailSend,
    handleSingleMailSend,
    fetchSpecialPrice,
  };
}
