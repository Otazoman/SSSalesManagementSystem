import React from "react";
import { WorkflowTask } from "../_types";
import { PreviewRenderer } from "../../_shared/PreviewRenderer";
import { WorkflowTimeline } from "../../_shared/WorkflowTimeline";
import { stackedTable } from "../../../_shared/ui/stacked-table";

interface TaskPreviewRowProps {
  task: WorkflowTask;
  getEligibleApprovers: (
    roleId: string,
    departmentId?: string | null,
    applicantDepartmentId?: string | null,
  ) => string;
}

export function TaskPreviewRow({
  task,
  getEligibleApprovers,
}: TaskPreviewRowProps) {
  return (
    <tr className={`${stackedTable.trBare} bg-slate-50/80 mb-3 md:mb-0`}>
      <td
        colSpan={6}
        className={`${stackedTable.tdBare} px-2 py-3 md:px-6 md:py-4 border-b border-slate-200`}
      >
        <div className="space-y-4">
          {/* 承認フロー進行プロセスの詳細(申請履歴画面と共通の部品) */}
          {task.flowProgress && task.flowProgress.length > 0 && (
            <WorkflowTimeline
              flowProgress={task.flowProgress}
              getEligibleApprovers={getEligibleApprovers}
              applicantDepartmentId={task.applicantDepartmentId}
            />
          )}

          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-inner">
            <h4 className="text-xs font-bold text-slate-800 border-b pb-1.5 flex items-center">
              <span>📝 申請内容のプレビュー</span>
            </h4>
            <PreviewRenderer
              targetType={task.targetType}
              mode="task"
              newData={task.previewData}
            />
          </div>
        </div>
      </td>
    </tr>
  );
}
