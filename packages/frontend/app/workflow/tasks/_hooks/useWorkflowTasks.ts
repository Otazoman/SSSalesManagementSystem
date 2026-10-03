import { useState } from "react";
import { usePagePermissions } from "../../../hooks/use-page-permission";
import { usePermissionContext } from "../../../context/permissioncontext";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { useWorkflowScreensAndUsers } from "../../_shared/useWorkflowScreensAndUsers";
import { WorkflowTask } from "../_types";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

export function useWorkflowTasks() {
  const confirm = useConfirm();
  const { user } = usePermissionContext();
  const { canRead, canUpdate, loading } = usePagePermissions();
  const { paginationEnabled } = usePaginationSetting();

  const [processingId, setProcessingId] = useState<string | null>(null);
  const [commentMap, setCommentMap] = useState<Record<string, string>>({});
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
  const [bulkComment, setBulkComment] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // 💡 対象マスタ名の日本語表示・承認フロー進捗タイムラインの承認候補者解決
  // (申請履歴画面と共通、workflow/_shared/useWorkflowScreensAndUsers.ts)
  const { getTargetTypeJapanese, getEligibleApprovers } =
    useWorkflowScreensAndUsers(!loading && canRead);

  const {
    items: tasks,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    refetch: syncPendingTasks,
  } = usePaginatedList<WorkflowTask>(
    `/api/workflow-tasks/my-pending?userId=${user?.id ?? ""}`,
    { paginationEnabled, enabled: canRead && !loading && !!user?.id },
  );

  // 全選択トグル(ページング後は現在のページ内のみが対象になる)
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedLogIds(tasks.map((t) => t.logId));
    } else {
      setSelectedLogIds([]);
    }
  };

  // 個別選択トグル
  const handleSelectOne = (logId: string) => {
    setSelectedLogIds((prev) =>
      prev.includes(logId)
        ? prev.filter((id) => id !== logId)
        : [...prev, logId],
    );
  };

  // コメント更新
  const handleCommentChange = (logId: string, comment: string) => {
    setCommentMap((prev) => ({
      ...prev,
      [logId]: comment,
    }));
  };

  // 一括処理
  const handleBulkAction = async (
    actionType: "bulk-approve" | "bulk-remand",
  ) => {
    setError("");
    setMessage("");

    if (!canUpdate || !user?.id) {
      setError("決裁する権限がありません");
      return;
    }

    if (selectedLogIds.length === 0) {
      setError("一括処理を行うリクエストが選択されていません");
      return;
    }

    const actionName =
      actionType === "bulk-approve" ? "一括承認" : "一括差戻し";
    if (
      !(await confirm(
        `選択された ${selectedLogIds.length} 件を ${actionName} してよろしいですか？`,
      ))
    ) {
      return;
    }

    setProcessingId("bulk");

    const payload = {
      logIds: selectedLogIds,
      userId: user.id,
      comment: bulkComment || null,
    };

    try {
      const data = await apiFetch<{ message?: string }>(
        `/api/workflow-tasks/${actionType}`,
        {
          method: "POST",
          json: payload,
          defaultErrorMessage: "一括処理に失敗しました",
        },
      );

      setMessage(data.message || `${actionName}が完了しました`);
      setBulkComment("");
      setSelectedLogIds([]);
      void syncPendingTasks();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  // 個別処理
  const handleAction = async (
    task: WorkflowTask,
    actionType: "approve" | "remand",
  ) => {
    setError("");
    setMessage("");

    if (!canUpdate || !user?.id) {
      setError("決裁する権限がありません");
      return;
    }

    if (
      !(await confirm(
        `この申請を${actionType === "approve" ? "承認" : "差戻し"}してよろしいですか？`,
      ))
    )
      return;

    setProcessingId(task.logId);

    const payload = {
      logId: task.logId,
      requestId: task.requestId,
      userId: user.id,
      comment: commentMap[task.logId] || null,
    };

    try {
      await apiFetch(`/api/workflow-tasks/${actionType}`, {
        method: "POST",
        json: payload,
        defaultErrorMessage: "処理に失敗しました",
      });

      setMessage(
        actionType === "approve"
          ? `「${task.targetName}」の申請を承認しました`
          : `「${task.targetName}」の申請を差戻しました`,
      );

      setCommentMap((prev) => {
        const next = { ...prev };
        delete next[task.logId];
        return next;
      });

      setSelectedLogIds([]);
      void syncPendingTasks();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const toggleExpandTask = (logId: string) => {
    setExpandedTaskId((prev) => (prev === logId ? null : logId));
  };

  return {
    tasks,
    loading,
    canRead,
    canUpdate,
    processingId,
    commentMap,
    expandedTaskId,
    selectedLogIds,
    bulkComment,
    message,
    error,
    getTargetTypeJapanese,
    getEligibleApprovers,
    paginationEnabled,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    setBulkComment,
    handleSelectAll,
    handleSelectOne,
    handleCommentChange,
    handleBulkAction,
    handleAction,
    toggleExpandTask,
  };
}
