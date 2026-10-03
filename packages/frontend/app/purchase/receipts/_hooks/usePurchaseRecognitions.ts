import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { ApiListResponse } from "../../../_shared/api/response-types";
import {
  PurchaseRecognitionRecord,
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

interface UsePurchaseRecognitionsProps {
  canRead: boolean;
  permsLoading: boolean;
}

// Item10: sales/invoices/_hooks/useSalesInvoices.tsと同じ構成(メール送信・特殊ダミーデータ生成は対象外)
export function usePurchaseRecognitions({ canRead, permsLoading }: UsePurchaseRecognitionsProps) {
  const { paginationEnabled } = usePaginationSetting();
  const [recognitions, setRecognitions] = useState<PurchaseRecognitionRecord[]>([]);
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
      const data = await apiFetch<PartnerMaster[]>("/api/partners?type=SUPPLIER");
      setPartners(data.filter((p) => !p.type || p.type === "SUPPLIER"));
    } catch (err) {
      console.error("仕入先マスタの取得に失敗しました", err);
      setPartners([]);
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const data = await apiFetch<ProductMaster[]>("/api/products");
      setProducts(data);
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

        // 追加要望: プロジェクト選択肢(発注からそのまま引き継ぎ、単独仕入は手動選択)
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

  const syncRecognitions = useCallback(
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

        const data = await apiFetch<
          PurchaseRecognitionRecord[] | ApiListResponse<PurchaseRecognitionRecord>
        >(`/api/purchase-recognitions?${params.toString()}`);

        if (Array.isArray(data)) {
          setRecognitions(data);
          setTotal(data.length);
          setTotalPages(1);
        } else {
          setRecognitions(data.data);
          setTotal(data.pagination.total);
          setTotalPages(data.pagination.totalPages);
        }

        if (overrides?.page !== undefined) setPageState(overrides.page);
        if (overrides?.limit !== undefined) setLimitState(overrides.limit);
      } catch (err) {
        console.error("仕入一覧の取得に失敗しました", err);
      }
    },
    [permsLoading, canRead, paginationEnabled, page, limit, sortKeys],
  );

  const setPage = useCallback(
    (nextPage: number) => {
      void syncRecognitions(lastFiltersRef.current, { page: nextPage });
    },
    [syncRecognitions],
  );

  const setLimit = useCallback(
    (nextLimit: number) => {
      void syncRecognitions(lastFiltersRef.current, { limit: nextLimit, page: 1 });
    },
    [syncRecognitions],
  );

  const handleImportCSV = async (file: File) => {
    setIsSubmitting(true);
    setError("");
    setMessage("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const data = await apiFetch<{ message?: string }>("/api/purchase-recognitions/bulk-register", {
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
      const res = await fetch("/api/purchase-recognitions/csv-download", {
        method: "GET",
        credentials: "include",
      });

      if (!res.ok) throw new Error("サーバー側でのCSV生成に失敗しました");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `purchase_recognitions_export_${todayJst()}.csv`);
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

  const handleDeleteRecognition = async (id: string) => {
    setIsSubmitting(true);
    try {
      const data = await apiFetch<{ message?: string }>(
        `/api/purchase-recognitions/${id}/request-deletion`,
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

  const handleSubmitForApproval = async (
    id: string,
    applicantDepartmentSurrogateId?: string | null,
  ) => {
    setIsSubmitting(true);
    try {
      const data = await apiFetch<{ message?: string }>(
        `/api/purchase-recognitions/${id}/submit-for-approval`,
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

  return {
    recognitions,
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
    syncRecognitions,
    handleImportCSV,
    handleExportCSV,
    handleDeleteRecognition,
    handleSubmitForApproval,
  };
}
