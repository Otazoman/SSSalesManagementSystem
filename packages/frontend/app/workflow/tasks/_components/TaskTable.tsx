import React from "react";
import { WorkflowTask } from "../_types";
import { TaskTableRow } from "./TaskTableRow";
import { TaskPreviewRow } from "./TaskPreviewRow";
import { stackedTable } from "../../../_shared/ui/stacked-table";

interface TaskTableProps {
  tasks: WorkflowTask[];
  canUpdate: boolean;
  processingId: string | null;
  commentMap: Record<string, string>;
  expandedTaskId: string | null;
  selectedLogIds: string[];
  getTargetTypeJapanese: (targetType: string) => string;
  getEligibleApprovers: (
    roleId: string,
    departmentId?: string | null,
    applicantDepartmentId?: string | null,
  ) => string;
  onSelectAll: (checked: boolean) => void;
  onSelectOne: (logId: string) => void;
  onToggleExpand: (logId: string) => void;
  onCommentChange: (logId: string, comment: string) => void;
  onAction: (task: WorkflowTask, actionType: "approve" | "remand") => void;
}

/**
 * `workflow/histories`の`WorkflowTable.tsx`と対称の、tasks側の専用テーブルコンポーネント。
 * 従来page.tsxに直書きされていたテーブルタグをそのまま移設（マークアップ・挙動は変更していない）。
 */
export function TaskTable({
  tasks,
  canUpdate,
  processingId,
  commentMap,
  expandedTaskId,
  selectedLogIds,
  getTargetTypeJapanese,
  getEligibleApprovers,
  onSelectAll,
  onSelectOne,
  onToggleExpand,
  onCommentChange,
  onAction,
}: TaskTableProps) {
  return (
    <div className="md:bg-white md:border md:border-slate-200 md:rounded-xl md:overflow-x-auto md:overflow-y-auto md:max-h-[600px] md:shadow-sm relative">
      <div className="bg-slate-50 border border-slate-200 rounded-lg mb-3 md:mb-0 md:rounded-none md:border-0 md:border-b px-4 py-3 flex justify-between items-center md:min-w-[900px] md:sticky md:top-0 z-20">
        <span className="text-xs font-bold text-slate-700">
          📋 承認待ちリクエスト一覧
        </span>
        <span className="text-xs text-slate-700 font-medium">
          現在の未決済件数:{" "}
          <strong className="text-indigo-600 font-bold">{tasks.length}</strong>{" "}
          件
        </span>
      </div>

      <table
        className={`${stackedTable.table} md:min-w-[900px] md:border-separate md:border-spacing-0`}
      >
        <thead
          className={`${stackedTable.thead} bg-slate-100 text-slate-700 font-bold uppercase sticky top-[41px] z-10`}
        >
          <tr>
            <th className="px-4 py-3 w-12 text-center bg-slate-100 border-b border-slate-200">
              <input
                type="checkbox"
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                onChange={(e) => onSelectAll(e.target.checked)}
                checked={
                  tasks.length > 0 && selectedLogIds.length === tasks.length
                }
              />
            </th>
            <th className="px-4 py-3 bg-slate-100 border-b border-slate-200">
              申請対象マスタ / コード
            </th>
            <th className="px-4 py-3 bg-slate-100 border-b border-slate-200">
              申請種別 / 申請者
            </th>
            <th className="px-4 py-3 bg-slate-100 border-b border-slate-200">
              現在の承認段階
            </th>
            <th className="px-4 py-3 min-w-[250px] bg-slate-100 border-b border-slate-200">
              承認・差戻しコメント入力
            </th>
            <th className="px-4 py-3 text-center bg-slate-100 border-b border-slate-200">
              操作
            </th>
          </tr>
        </thead>
        <tbody
          className={`${stackedTable.tbody} md:divide-y md:divide-slate-200 text-slate-700`}
        >
          {tasks.length > 0 ? (
            tasks.map((task) => (
              <React.Fragment key={task.logId}>
                <TaskTableRow
                  task={task}
                  targetTypeName={getTargetTypeJapanese(task.targetType)}
                  isSelected={selectedLogIds.includes(task.logId)}
                  isExpanded={expandedTaskId === task.logId}
                  canUpdate={canUpdate}
                  comment={commentMap[task.logId] || ""}
                  isProcessing={processingId === task.logId}
                  onSelect={() => onSelectOne(task.logId)}
                  onToggleExpand={() => onToggleExpand(task.logId)}
                  onCommentChange={(comment) =>
                    onCommentChange(task.logId, comment)
                  }
                  onAction={(actionType) => onAction(task, actionType)}
                />
                {expandedTaskId === task.logId && (
                  <TaskPreviewRow
                    task={task}
                    getEligibleApprovers={getEligibleApprovers}
                  />
                )}
              </React.Fragment>
            ))
          ) : (
            <tr className={stackedTable.trBare}>
              <td
                colSpan={6}
                className={`${stackedTable.tdBare} text-center py-12 text-slate-600 italic bg-slate-50 rounded-lg`}
              >
                現在、あなた宛ての未決済承認タスクはありません。📥
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
