"use client";

import { useWorkflowTasks } from "./_hooks/useWorkflowTasks";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { BulkActionPanel } from "./_components/BulkActionPanel";
import { TaskTable } from "./_components/TaskTable";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { Pagination } from "../../_shared/ui/Pagination";

export default function WorkflowTasksPage() {
  const {
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
  } = useWorkflowTasks();

  if (loading) {
    return <LoadingGate />;
  }

  if (!canRead) {
    return <AccessDeniedInline />;
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="📥 承認タスク管理(未処理・判定)"
        description="あなたに手番が回ってきている、マスタ登録等の決裁承認待ちリクエストの一覧画面です。"
      />

      <MessageBanner message={message} error={error} />

      {/* 一括操作パネル */}
      {canUpdate && tasks.length > 0 && (
        <BulkActionPanel
          selectedCount={selectedLogIds.length}
          bulkComment={bulkComment}
          isProcessing={processingId !== null}
          onCommentChange={setBulkComment}
          onBulkAction={handleBulkAction}
        />
      )}

      {/* データ一覧テーブル */}
      <TaskTable
        tasks={tasks}
        canUpdate={canUpdate}
        processingId={processingId}
        commentMap={commentMap}
        expandedTaskId={expandedTaskId}
        selectedLogIds={selectedLogIds}
        getTargetTypeJapanese={getTargetTypeJapanese}
        getEligibleApprovers={getEligibleApprovers}
        onSelectAll={handleSelectAll}
        onSelectOne={handleSelectOne}
        onToggleExpand={toggleExpandTask}
        onCommentChange={handleCommentChange}
        onAction={handleAction}
      />

      <Pagination
        paginationEnabled={paginationEnabled}
        page={page}
        totalPages={totalPages}
        total={total}
        limit={limit}
        onPageChange={setPage}
        onLimitChange={setLimit}
      />
    </div>
  );
}
