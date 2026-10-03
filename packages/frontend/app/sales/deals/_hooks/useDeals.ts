"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { useCsvImport } from "../../../_shared/hooks/use-csv-import";
import {
  DEAL_PARTNER_TYPES,
  DealDetail,
  DealFilters,
  DealSummary,
  EMPTY_FILTERS,
  EmployeeOption,
  OpenTask,
  PartnerOption,
} from "../_types";

const BASE = "/api/sales-deals";

const buildQuery = (filters: DealFilters) => {
  const params = new URLSearchParams();
  if (filters.partnerId) params.set("partnerId", filters.partnerId);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.keyword) params.set("keyword", filters.keyword);
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.openTasks) params.set("openTasks", "true");
  return params.toString();
};

// 商談一覧・検索・削除・CSV出力と、未完了タスク一覧(完了の切替)
export function useDeals(enabled: boolean) {
  const [rows, setRows] = useState<DealSummary[]>([]);
  const [openTasks, setOpenTasks] = useState<OpenTask[]>([]);
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [draft, setDraft] = useState<DealFilters>(EMPTY_FILTERS);
  // BUG-031: 他の一覧と同じく、条件を入力するとすぐ絞り込む(入力のたびに検索しないよう、少し待つ)
  const debouncedDraft = useDebouncedValue(draft);
  const applied = useMemo(
    () => ({ ...debouncedDraft, keyword: debouncedDraft.keyword.trim() }),
    [debouncedDraft],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // BUG-032: 会社設定の「一覧のページ分割」に従う(他の一覧と同じ)
  const { paginationEnabled } = usePaginationSetting();
  const [page, setPage] = useState(1);
  const [limit, setLimitState] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(buildQuery(applied));
      if (paginationEnabled) {
        params.set("page", String(page));
        params.set("limit", String(limit));
      }
      const query = params.toString();
      // 次回までのタスクも、検索した取引先のタスクのみに絞り込む
      const taskQuery = applied.partnerId ? `?${new URLSearchParams({ partnerId: applied.partnerId })}` : "";
      const [list, tasks] = await Promise.all([
        apiFetch<DealSummary[] | { data: DealSummary[]; pagination: { total: number; totalPages: number } }>(
          `${BASE}${query ? `?${query}` : ""}`,
        ),
        apiFetch<OpenTask[]>(`${BASE}/tasks${taskQuery}`),
      ]);
      if (Array.isArray(list)) {
        setRows(list);
        setTotal(list.length);
        setTotalPages(1);
      } else {
        setRows(list.data);
        setTotal(list.pagination.total);
        setTotalPages(list.pagination.totalPages);
      }
      setOpenTasks(tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "商談の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [applied, paginationEnabled, page, limit]);

  const setLimit = (next: number) => {
    setLimitState(next);
    setPage(1);
  };

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      await load();
    })();
  }, [enabled, load]);

  // 取引先(見込み客・顧客)と社員の選択肢。取得できなくても一覧の表示自体は継続する
  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      try {
        const [partnerList, userList] = await Promise.all([
          apiFetch<PartnerOption[]>("/api/partners?status=active"),
          apiFetch<(EmployeeOption & { isActive?: boolean })[]>("/api/users"),
        ]);
        setPartners(partnerList.filter((p) => !p.type || DEAL_PARTNER_TYPES.includes(p.type)));
        setEmployees(
          userList
            .filter((u) => u.isActive !== false && !!u.employeeNumber)
            .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber)),
        );
      } catch {
        // 選択肢が取れない場合、商談の登録はできないが一覧の閲覧は可能
      }
    })();
  }, [enabled]);

  // 一覧の「プレビュー」(右側に読み取り専用で表示する確認パネル)。開く操作で詳細を取得する
  const [previewDeal, setPreviewDeal] = useState<DealDetail | null>(null);
  const openPreview = async (id: string) => {
    setError("");
    try {
      setPreviewDeal(await apiFetch<DealDetail>(`${BASE}/${id}`, { defaultErrorMessage: "商談の詳細の取得に失敗しました" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "商談の詳細の取得に失敗しました");
    }
  };

  // CSV出力。取込の書き込み上限に収まる先頭の商談のみを出力した場合は、件数の差(レスポンスヘッダー)で警告する
  const [downloading, setDownloading] = useState(false);
  const [warning, setWarning] = useState("");

  // CSV一括取込。不正な行の一覧は複数行のメッセージになるため、通常のエラーとは別に保持して整形表示する
  const [importError, setImportError] = useState("");
  const { importCsv, importing } = useCsvImport({
    onSuccess: load,
    onMessage: setMessage,
    onError: setImportError,
  });
  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError("");
    setError("");
    setMessage("");
    await importCsv(`${BASE}/bulk-register`, e);
  };

  // 条件を変えたら1ページ目から表示する
  const changeDraft = <K extends keyof DealFilters>(key: K, value: DealFilters[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleClear = () => {
    setDraft(EMPTY_FILTERS);
    setPage(1);
  };

  const handleDownloadCsv = async () => {
    const query = buildQuery(applied);
    setError("");
    setWarning("");
    setDownloading(true);
    try {
      const res = await fetch(`${BASE}/csv-download${query ? `?${query}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("CSVのダウンロードに失敗しました");
      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `deals_${Date.now()}.csv`;
      a.click();
      window.URL.revokeObjectURL(objectUrl);

      const total = Number(res.headers.get("X-Deals-Export-Total"));
      const included = Number(res.headers.get("X-Deals-Export-Included"));
      if (total > 0 && included > 0 && included < total) {
        setWarning(
          `検索条件に一致した${total}件のうち、CSVインポートで1回に取り込める範囲の先頭${included}件のみ出力しました。` +
            "残りは、商談日などの検索条件を絞り込んで分けて出力してください。",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSVのダウンロードに失敗しました");
    } finally {
      setDownloading(false);
    }
  };

  const removeDeal = async (id: string) => {
    setError("");
    setMessage("");
    try {
      await apiFetch(`${BASE}/${id}`, { method: "DELETE", defaultErrorMessage: "商談の削除に失敗しました" });
      setMessage("商談を削除しました");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "商談の削除に失敗しました");
    }
  };

  // 次回までのタスクの完了/未完了の切替
  const setTaskDone = async (dealId: string, taskId: string, isDone: boolean) => {
    setError("");
    try {
      await apiFetch(`${BASE}/${dealId}/tasks/${taskId}/done`, {
        method: "PUT",
        json: { isDone },
        defaultErrorMessage: "タスクの更新に失敗しました",
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "タスクの更新に失敗しました");
    }
  };

  return {
    rows,
    paginationEnabled,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    openTasks,
    isPartnerFiltered: !!applied.partnerId,
    partners,
    employees,
    draft,
    changeDraft,
    handleClear,
    loading,
    error,
    setError,
    message,
    setMessage,
    previewDeal,
    openPreview,
    closePreview: () => setPreviewDeal(null),
    downloading,
    warning,
    handleDownloadCsv,
    importing,
    importError,
    clearImportError: () => setImportError(""),
    handleImportCsv,
    removeDeal,
    setTaskDone,
    reload: load,
  };
}
