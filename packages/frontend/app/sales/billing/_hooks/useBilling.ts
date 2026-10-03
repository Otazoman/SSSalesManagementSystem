import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { ApiListResponse } from "../../../_shared/api/response-types";
import { BillingRecord, PartnerMaster, TaxCategoryLookup } from "../_types";
import { todayJst } from "../../../_shared/jst-date";
import { fetchPartnersOfTypes } from "../../../_shared/partner-options";

interface UseBillingProps {
  canRead: boolean;
  permsLoading: boolean;
}

// Item8 Phase4: sales/invoices/_hooks/useSalesInvoices.tsと同じ構成(一覧+マスタ取得+CSV入出力)
export function useBilling({ canRead, permsLoading }: UseBillingProps) {
  const { paginationEnabled } = usePaginationSetting();
  const [billings, setBillings] = useState<BillingRecord[]>([]);
  const [page, setPageState] = useState(1);
  const [limit, setLimitState] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const lastFiltersRef = useRef<Record<string, string>>({});
  const [partners, setPartners] = useState<PartnerMaster[]>([]);
  const [taxCategories, setTaxCategories] = useState<TaxCategoryLookup[]>([]);

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
      // BUG-067: 兼用(BOTH)の取引先も選べるようにする
      const data = await fetchPartnersOfTypes<PartnerMaster>(["CUSTOMER", "BOTH"]);
      setPartners(data.filter((p) => !p.type || p.type === "CUSTOMER" || p.type === "BOTH"));
    } catch (err) {
      console.error("取引先マスタの取得に失敗しました", err);
      setPartners([]);
    }
  }, []);

  // K-4-3: 完全手動入力の明細行の税区分選択肢用
  const fetchTaxCategories = useCallback(async () => {
    try {
      const data = await apiFetch<TaxCategoryLookup[]>("/api/tax-categories");
      setTaxCategories(data);
    } catch (err) {
      console.error("税区分マスタの取得に失敗しました", err);
      setTaxCategories([]);
    }
  }, []);

  useEffect(() => {
    if (permsLoading || !canRead) return;
    void fetchPartners();
    void fetchTaxCategories();
  }, [permsLoading, canRead, fetchPartners, fetchTaxCategories]);

  const syncBillings = useCallback(
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

        const data = await apiFetch<BillingRecord[] | ApiListResponse<BillingRecord>>(
          `/api/sales-billing?${params.toString()}`,
        );

        if (Array.isArray(data)) {
          setBillings(data);
          setTotal(data.length);
          setTotalPages(1);
        } else {
          setBillings(data.data);
          setTotal(data.pagination.total);
          setTotalPages(data.pagination.totalPages);
        }

        if (overrides?.page !== undefined) setPageState(overrides.page);
        if (overrides?.limit !== undefined) setLimitState(overrides.limit);
      } catch (err) {
        console.error("請求一覧の取得に失敗しました", err);
      }
    },
    [permsLoading, canRead, paginationEnabled, page, limit, sortKeys],
  );

  const setPage = useCallback(
    (nextPage: number) => {
      void syncBillings(lastFiltersRef.current, { page: nextPage });
    },
    [syncBillings],
  );

  const setLimit = useCallback(
    (nextLimit: number) => {
      void syncBillings(lastFiltersRef.current, { limit: nextLimit, page: 1 });
    },
    [syncBillings],
  );

  const handleExportCSV = async () => {
    setMessage("⌛ CSVファイルを生成中...");
    try {
      const res = await fetch("/api/sales-billing/csv-download", {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) throw new Error("サーバー側でのCSV生成に失敗しました");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `billing_export_${todayJst()}.csv`);
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

  // BUG-060: 入金消込・支払消込のCSV取込にも使うため、取込先を指定できるようにする(省略時は従来の取込先)
  const handleImportCSV = async (file: File, url = "/api/sales-billing/bulk-register") => {
    setIsSubmitting(true);
    setError("");
    setMessage("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const data = await apiFetch<{ message?: string }>(url, {
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

  return {
    billings,
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
    taxCategories,
    message,
    setMessage,
    error,
    setError,
    isSubmitting,
    setIsSubmitting,
    syncBillings,
    handleExportCSV,
    handleImportCSV,
  };
}
