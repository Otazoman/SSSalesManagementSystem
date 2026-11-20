import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { WorkflowHistoryTask, SearchFilters } from "../_types";

interface UseWorkflowHistoryProps {
  userId: string | undefined;
  canRead: boolean;
  loadingPermissions: boolean;
}

interface HistoryCounts {
  approved: number;
  remanded: number;
  pending: number;
  canceled: number;
}

interface HistoryPageResponse {
  data: WorkflowHistoryTask[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  isAdmin?: boolean;
  counts?: HistoryCounts;
}

const initialFilters: SearchFilters = {
  startDate: "",
  endDate: "",
  applicantId: "",
  targetName: "",
  requestType: "",
  status: "ACTIVE_TASKS", // 💡 "PENDING" と "REMANDED" を合わせた状態名として定義
};

const initialCounts: HistoryCounts = {
  approved: 0,
  remanded: 0,
  pending: 0,
  canceled: 0,
};

// Item5後の実機検証を受け、件数集計(タブごとのバッジ)と「要対応(ACTIVE_TASKS)」タブの
// targetIdごとの重複排除ロジックをbackend(WorkflowTasksService.getHistoryPage)へ移管した。
// 以前はここで全件取得してクライアント側で絞り込み・集計していたが、ページングと両立しない
// 設計だったため、ページング対応のGET /api/workflow-tasks/history(page/limit指定)を
// 使う形に書き換えている。
export function useWorkflowHistory({
  userId,
  canRead,
  loadingPermissions,
}: UseWorkflowHistoryProps) {
  const [histories, setHistories] = useState<WorkflowHistoryTask[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>(initialFilters);
  const [counts, setCounts] = useState<HistoryCounts>(initialCounts);

  const [page, setPageState] = useState(1);
  const [limit, setLimitState] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const fetchWorkflowHistory = useCallback(
    async (overrides?: { page?: number; limit?: number }) => {
      if (loadingPermissions || !canRead || !userId) return;

      const effectivePage = overrides?.page ?? page;
      const effectiveLimit = overrides?.limit ?? limit;

      setLoadingData(true);
      try {
        const params = new URLSearchParams();
        params.append("userId", userId);
        if (filters.applicantId) params.append("applicantId", filters.applicantId);
        if (filters.startDate) params.append("startDate", filters.startDate);
        if (filters.endDate) params.append("endDate", filters.endDate);
        if (filters.targetName) params.append("targetName", filters.targetName);
        if (filters.requestType) params.append("requestType", filters.requestType);
        // 💡 以前は"ACTIVE_TASKS"/"all"の間はstatusを送らずクライアント側で絞り込んでいたが、
        // backend側で全タブ値を解釈するようになったため常に送る
        if (filters.status) params.append("status", filters.status);

        // PERF-02: 申請履歴は、会社設定のページングの有無にかかわらず常にページ単位(既定50件。API の上限も50件)で
        // 取得し、ページ送りを出す。以前はページングが無効の時に500件まで1回で取得していたが、件数に比例して
        // 重くなり、無料プランの CPU 時間の上限を超えていた。会社設定を読み終えるのを待たないため、
        // 画面を開いた時の取得も1回で済む(以前は読み込みの前後で2回取得していた)
        params.append("page", String(effectivePage));
        params.append("limit", String(effectiveLimit));

        const data = await apiFetch<HistoryPageResponse>(
          `/api/workflow-tasks/history?${params.toString()}`,
        );

        setHistories(data.data ?? []);
        setIsAdmin(data.isAdmin || false);
        setTotal(data.pagination?.total ?? 0);
        setTotalPages(data.pagination?.totalPages ?? 1);
        setCounts(data.counts || initialCounts);

        if (overrides?.page !== undefined) setPageState(overrides.page);
        if (overrides?.limit !== undefined) setLimitState(overrides.limit);
      } catch (err) {
        console.error("履歴データの取得に失敗しました", err);
      } finally {
        setLoadingData(false);
      }
    },
    [loadingPermissions, canRead, userId, filters, page, limit],
  );

  useEffect(() => {
    void fetchWorkflowHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingPermissions, canRead, userId, filters]);

  const setPage = useCallback(
    (nextPage: number) => {
      setPageState(nextPage);
      void fetchWorkflowHistory({ page: nextPage });
    },
    [fetchWorkflowHistory],
  );

  const setLimit = useCallback(
    (nextLimit: number) => {
      setLimitState(nextLimit);
      void fetchWorkflowHistory({ limit: nextLimit, page: 1 });
    },
    [fetchWorkflowHistory],
  );

  const handleClearFilters = useCallback(() => {
    setFilters(initialFilters);
  }, []);

  const handleCancelRequest = useCallback(
    async (targetId: string, logId: string) => {
      try {
        await apiFetch("/api/workflow-tasks/cancel", {
          method: "POST",
          json: { targetId, logId, userId },
          defaultErrorMessage: "取下げに失敗しました",
        });

        await fetchWorkflowHistory();
      } catch (err) {
        console.error("取下げエラー:", err);
        throw err;
      }
    },
    [userId, fetchWorkflowHistory],
  );

  return {
    histories,
    loadingData,
    isAdmin,
    filters,
    setFilters,
    counts,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    handleClearFilters,
    handleCancelRequest,
    refetch: fetchWorkflowHistory,
  };
}
