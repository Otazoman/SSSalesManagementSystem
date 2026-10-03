import React from "react";
import { FlowStepProgress } from "../histories/_types";

interface WorkflowTimelineProps {
  flowProgress: FlowStepProgress[];
  getEligibleApprovers: (
    roleId: string,
    departmentId?: string | null,
    applicantDepartmentId?: string | null,
  ) => string;
  applicantDepartmentId?: string | null;
}

// 申請履歴画面(WorkflowTable.tsx)・承認タスク画面(TaskPreviewRow.tsx)の両方から使う
// 承認フロー進捗タイムライン表示。以前はhistories専用だったが、承認タスク画面でも
// 同じ進捗詳細を表示できるように共有コンポーネントとして移設した。
export function WorkflowTimeline({
  flowProgress,
  getEligibleApprovers,
  applicantDepartmentId,
}: WorkflowTimelineProps) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-3">
      <h4 className="text-[11px] font-bold text-slate-700 flex items-center">
        🌲 承認フロー進行プロセスの詳細
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {flowProgress.map((step, idx) => {
          // 表示名ラベルの構築
          let stepLabel = "";
          if (step.stepOrder === 1) {
            stepLabel = `第 1 段階: 起票・申請`;
          } else {
            // 第2段階以降：ステップ名がある場合は「第 X 段階 [ステップ名]: 役職名」の形式で横並びにする
            const stepNameSection = step.stepName ? ` [${step.stepName}]` : "";
            const roleSection = step.roleName ? `: ${step.roleName}` : "";
            stepLabel = `第 ${step.stepOrder} 段階${stepNameSection}${roleSection}`;
          }

          let statusBadge = (
            <span className="text-[9px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded">
              待機中
            </span>
          );
          let cardBg = "bg-white border-slate-200 text-slate-600";

          if (step.stepOrder === 1) {
            statusBadge = (
              <span className="text-[9px] bg-indigo-100 text-indigo-800 font-bold px-1.5 py-0.5 rounded border border-indigo-200">
                申請済
              </span>
            );
            cardBg = "bg-indigo-50/40 border-indigo-200 text-slate-700";
          } else if (step.status === "APPROVED") {
            statusBadge = (
              <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded border border-emerald-200">
                承認済み
              </span>
            );
            cardBg = "bg-emerald-50/40 border-emerald-200 text-slate-700";
          } else if (step.status === "REMANDED") {
            statusBadge = (
              <span className="text-[9px] bg-rose-100 text-rose-800 font-bold px-1.5 py-0.5 rounded border border-rose-200">
                差戻し
              </span>
            );
            cardBg = "bg-rose-50/40 border-rose-200 text-slate-700";
          } else if (step.status === "PENDING") {
            statusBadge = (
              <span className="text-[9px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded border border-amber-200 animate-pulse">
                判定中
              </span>
            );
            cardBg =
              "bg-amber-50/60 border-amber-300 ring-2 ring-amber-400/20 text-slate-800";
          }

          return (
            <div
              key={idx}
              className={`border rounded-md p-2.5 text-xs flex flex-col justify-between ${cardBg} shadow-xs transition-all`}
            >
              <div>
                <div className="flex justify-between items-start">
                  <span className="font-bold text-slate-900 text-[11px]">
                    {stepLabel}
                  </span>
                  {statusBadge}
                </div>
                <div className="mt-2 text-[10px] space-y-1">
                  <div>
                    <span className="text-slate-600">担当者:</span>{" "}
                    <strong className="text-slate-700">
                      {step.performedBy ? (
                        `✅ ${step.performedBy}`
                      ) : (
                        <span className="text-indigo-600 font-bold">
                          {getEligibleApprovers(
                            step.roleId,
                            step.departmentId,
                            applicantDepartmentId,
                          )}
                        </span>
                      )}
                    </strong>
                  </div>
                  {step.performedAt && (
                    <div>
                      <span className="text-slate-600">処理日時:</span>{" "}
                      <span className="text-slate-600 font-mono">
                        {new Date(step.performedAt).toLocaleString("ja-JP")}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {step.comment && (
                <div className="mt-2 pt-1.5 border-t border-dashed border-slate-200 text-[10px] text-slate-600 bg-white/70 p-1 rounded italic">
                  💬 {step.comment}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
