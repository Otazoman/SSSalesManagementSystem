"use client";

import { ApprovalFlowRecord, ScreenRecord } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";

interface FlowListProps {
  filteredFlows: ApprovalFlowRecord[];
  screens: ScreenRecord[];
  canUpdate: boolean;
  canDelete: boolean;
  isSubmitting?: boolean;
  onSelectRow: (flow: ApprovalFlowRecord) => void;
  handleDisableFlow: (id: string, name: string) => void;
  handleRestoreFlow: (flow: ApprovalFlowRecord) => void;
  handlePurgeFlow: (id: string, name: string) => void;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function FlowList({
  filteredFlows,
  screens,
  canUpdate,
  canDelete,
  isSubmitting = false,
  onSelectRow,
  handleDisableFlow,
  handleRestoreFlow,
  handlePurgeFlow,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: FlowListProps) {
  return (
    <DataTable
      columns={[
        { key: "name", label: "フロー名称 / 金額判定", sortable: true },
        { key: "requestType", label: "対象種別", sortable: true },
        { key: "steps", label: "シークエンス(承認順序)" },
        { key: "actions", label: "操作", align: "center", className: "w-[160px]" },
      ]}
      data={filteredFlows}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(f) => (
        <tr
          key={f.id}
          className={`hover:bg-slate-50 transition-colors ${
            !f.isActive ? "bg-slate-50/60 text-slate-600" : ""
          } cursor-pointer`}
          onClick={() => onSelectRow(f)}
        >
          <td className="px-4 py-3">
            <div className="font-bold text-slate-900">{f.name}</div>
            <div className="text-[10px] text-slate-600 font-mono mt-0.5">
              {f.minAmount.toLocaleString()} 円 ≦ 金額 ＜{" "}
              {f.maxAmount.toLocaleString()} 円
            </div>
            {f.matchField && (
              <div className="mt-1">
                <span className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-indigo-50 border border-indigo-100 text-indigo-700">
                  条件: {f.matchField} = {f.matchValue}
                </span>
              </div>
            )}
          </td>
          <td className="px-4 py-3">
            <span className="px-1.5 py-0.5 rounded font-bold text-[10px] bg-slate-100 border text-slate-700">
              {screens.find((s) => s.resource === f.requestType)?.name ||
                f.requestType}
            </span>
          </td>
          <td className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-1">
              {f.steps.map((s, sIdx) => (
                <div key={s.id} className="flex items-center">
                  {sIdx > 0 && <span className="text-slate-600 mx-1">➔</span>}
                  <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-semibold text-[11px]">
                    {s.stepName ? `${s.stepName} ` : `${sIdx + 1}. `}
                    {s.targetDepartmentName ? `[${s.targetDepartmentName}] ` : ""}
                    {s.roleName}
                  </span>
                </div>
              ))}
            </div>
          </td>
          <td
            className="px-4 py-3 text-center space-x-3 whitespace-nowrap w-[160px]"
            onClick={(e) => e.stopPropagation()}
          >
            {f.isActive ? (
              <>
                <button
                  onClick={() => onSelectRow(f)}
                  disabled={!canUpdate || isSubmitting}
                  className={`font-bold ${
                    canUpdate && !isSubmitting
                      ? "text-indigo-600 hover:underline cursor-pointer"
                      : "text-slate-600 no-underline cursor-not-allowed"
                  }`}
                >
                  変更
                </button>
                <button
                  onClick={() => handleDisableFlow(f.id, f.name)}
                  disabled={!canUpdate || isSubmitting}
                  className={`font-bold ${
                    canUpdate && !isSubmitting
                      ? "text-amber-600 hover:underline cursor-pointer"
                      : "text-slate-600 no-underline cursor-not-allowed"
                  }`}
                >
                  無効化
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleRestoreFlow(f)}
                  disabled={!canUpdate || isSubmitting}
                  className={`font-bold ${
                    canUpdate && !isSubmitting
                      ? "text-emerald-600 hover:underline cursor-pointer"
                      : "text-slate-600 no-underline cursor-not-allowed"
                  }`}
                >
                  復元
                </button>
                <button
                  onClick={() => handlePurgeFlow(f.id, f.name)}
                  disabled={!canDelete || isSubmitting}
                  className={`font-bold ${
                    canDelete && !isSubmitting
                      ? "text-red-600 hover:underline cursor-pointer"
                      : "text-slate-600 no-underline cursor-not-allowed"
                  }`}
                >
                  削除
                </button>
              </>
            )}
          </td>
        </tr>
      )}
    />
  );
}
