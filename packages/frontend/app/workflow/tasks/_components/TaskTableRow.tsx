import React from "react";
import { WorkflowTask } from "../_types";
import { Button } from "../../../_shared/ui/Button";
import { formFieldInputClass } from "../../../_shared/ui/FormField";
import { stackedTable } from "../../../_shared/ui/stacked-table";

interface TaskTableRowProps {
  task: WorkflowTask;
  targetTypeName: string;
  isSelected: boolean;
  isExpanded: boolean;
  canUpdate: boolean;
  comment: string;
  isProcessing: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onCommentChange: (comment: string) => void;
  onAction: (actionType: "approve" | "remand") => void;
}

export function TaskTableRow({
  task,
  targetTypeName,
  isSelected,
  isExpanded,
  canUpdate,
  comment,
  isProcessing,
  onSelect,
  onToggleExpand,
  onCommentChange,
  onAction,
}: TaskTableRowProps) {
  return (
    <tr className={`${stackedTable.tr} hover:bg-slate-50 transition-colors`}>
      <td
        className={`${stackedTable.td} md:text-center`}
        data-label="選択"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          aria-label="この申請を選択"
          className="h-5 w-5 md:h-4 md:w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          checked={isSelected}
          onChange={onSelect}
        />
      </td>
      <td
        className={`${stackedTable.td} font-medium text-slate-900`}
        data-label="申請対象マスタ / コード"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="bg-slate-200 text-slate-800 text-[10px] px-1.5 py-0.5 rounded font-bold">
            {targetTypeName}
          </span>
          <Button variant="secondary" size="sm" onClick={onToggleExpand}>
            {isExpanded ? "▲ 閉じる" : "👁️ プレビュー"}
          </Button>
        </div>
        <span className="font-bold text-slate-900 block mt-1.5">
          {task.targetName}
        </span>
        <div className="text-[10px] text-slate-600 font-mono mt-1">
          管理コード: {task.targetId}
        </div>
      </td>
      <td className={stackedTable.td} data-label="申請種別 / 申請者">
        <span className="px-1.5 py-0.5 rounded font-bold text-[10px] bg-indigo-50 border border-indigo-100 text-indigo-700">
          {task.requestType}
        </span>
        <div className="text-slate-700 text-[11px] mt-1.5 font-medium">
          申請者ユーザーID: {task.applicantId}
        </div>
      </td>
      <td className={stackedTable.td} data-label="現在の承認段階">
        <span className="bg-amber-50 border border-amber-200 text-amber-800 font-bold px-2 py-0.5 rounded-full text-[10px]">
          第 {task.layer} 段階審査
        </span>
        <div className="text-[10px] text-slate-600 font-mono mt-1.5">
          申請日時: {new Date(task.createdAt).toLocaleString("ja-JP")}
        </div>
      </td>
      <td
        className={`${stackedTable.td} md:min-w-[250px]`}
        data-label="承認・差戻しコメント入力"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          className={formFieldInputClass}
          placeholder="差戻し理由の記述、または承認メモ(任意)"
          value={comment}
          onChange={(e) => onCommentChange(e.target.value)}
          disabled={isProcessing || !canUpdate}
        />
      </td>
      <td
        className={`${stackedTable.td} md:text-center md:whitespace-nowrap`}
        data-label="操作"
        onClick={(e) => e.stopPropagation()}
      >
        {canUpdate ? (
          <div className="grid grid-cols-2 gap-2 md:inline-flex">
            <Button
              variant="success"
              size="sm"
              className="min-h-11 md:min-h-0"
              onClick={() => onAction("approve")}
              disabled={isProcessing}
            >
              承認
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="min-h-11 md:min-h-0"
              onClick={() => onAction("remand")}
              disabled={isProcessing}
            >
              差戻し
            </Button>
          </div>
        ) : (
          <span className="text-slate-600 font-bold cursor-not-allowed select-none">
            🔒 権限なし
          </span>
        )}
      </td>
    </tr>
  );
}
