import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
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

// 💡 GET /api/workflow-tasks/historyはpage/limit未指定時も常にオブジェクトを返す
// (`WorkflowTasksService.getHistory()`の戻り値`{histories, isAdmin}`をそのままJSON化)。
// 他master画面のAPI(未指定時は配列を返す)とは異なる形なので、bareな配列は想定しない。
interface HistoryUnpagedResponse {
  histories: WorkflowHistoryTask[];
  isAdmin?: boolean;
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
  const { paginationEnabled } = usePaginationSetting();

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

        // 💡 件数集計(counts)・ACTIVE_TASKSの重複排除はgetHistoryPage()側にしかないため、
        // 会社設定でページングが無効(is_pagination_enabled=false)の間も、常にpage/limitを
        // 送って正しい集計・絞り込みロジックを通す(masterのuse-paginated-listのように
        // page/limitを省略すると、履歴画面だけgetHistory()の従来形式にフォールバックし
        // 集計・絞り込みが効かなくなってしまうため、この画面だけ意図的に挙動を変えている)。
        // ページング無効時はUIを隠しつつバックエンドの上限(MAX_LIMIT=500、platform/http/
        // pagination.ts)まで1回で取得する(D1無料枠のコスト制御を尊重し、無制限取得はしない)。
        params.append("page", String(paginationEnabled ? effectivePage : 1));
        params.append("limit", String(paginationEnabled ? effectiveLimit : 500));

        const data = await apiFetch<HistoryPageResponse | HistoryUnpagedResponse>(
          `/api/workflow-tasks/history?${params.toString()}`,
        );

        if ("data" in data) {
          // page/limit指定時: ページング済みレスポンス(counts・重複排除済み)
          setHistories(data.data);
          setIsAdmin(data.isAdmin || false);
          setTotal(data.pagination.total);
          setTotalPages(data.pagination.totalPages);
          setCounts(data.counts || initialCounts);
        } else {
          // page/limit未指定時(paginationEnabledがfalse、またはまだ読み込み中): 従来形式
          // ({histories, isAdmin}、全件・件数集計はクライアント側フォールバック)
          const fetchedList = data.histories;
          setHistories(fetchedList);
          setIsAdmin(data.isAdmin || false);
          setTotal(fetchedList.length);
          setTotalPages(1);
          setCounts({
            approved: fetchedList.filter((h) => h.status === "APPROVED").length,
            remanded: fetchedList.filter((h) => h.status === "REMANDED").length,
            pending: fetchedList.filter((h) => h.status === "PENDING").length,
            canceled: fetchedList.filter((h) => h.status === "CANCELED").length,
          });
        }

        if (overrides?.page !== undefined) setPageState(overrides.page);
        if (overrides?.limit !== undefined) setLimitState(overrides.limit);
      } catch (err) {
        console.error("履歴データの取得に失敗しました", err);
      } finally {
        setLoadingData(false);
      }
    },
    [loadingPermissions, canRead, userId, filters, paginationEnabled, page, limit],
  );

  useEffect(() => {
    void fetchWorkflowHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingPermissions, canRead, userId, filters, paginationEnabled]);

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
    paginationEnabled,
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
