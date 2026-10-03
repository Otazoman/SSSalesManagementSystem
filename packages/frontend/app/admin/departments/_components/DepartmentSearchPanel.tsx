"use client";

import { FilterStatus } from "../_types";
import { formFieldInputClass } from "../../../_shared/ui/FormField";
import { StatusTabs } from "../../../_shared/ui/StatusTabs";

interface DepartmentSearchPanelProps {
  targetDate: string;
  setTargetDate: (val: string) => void;
  filterStatus: FilterStatus;
  setFilterStatus: (status: FilterStatus) => void;
  departmentsCount: number;
}

export function DepartmentSearchPanel({
  targetDate,
  setTargetDate,
  filterStatus,
  setFilterStatus,
  departmentsCount,
}: DepartmentSearchPanelProps) {
  const inputClass = formFieldInputClass;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between border-b pb-2 border-slate-100">
        <h2 className="text-xs font-bold text-slate-700 flex items-center space-x-1">
          <span>📅 組織ツリー図 タイムトラベル指定日参照</span>
        </h2>
        <span className="text-[10px] text-slate-600 font-bold">
          指定日:{" "}
          <span className="text-slate-700 font-mono">
            {targetDate
              ? new Date(targetDate).toLocaleDateString("ja-JP")
              : "未指定"}
          </span>{" "}
          時点
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-500">
            参照基準日
          </label>
          <input
            type="date"
            className={inputClass}
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </div>

        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-500">
            表示フィルタ
          </label>
          <StatusTabs
            options={[
              { value: "active", label: "🟢 有効組織" },
              { value: "inactive", label: "🔴 無効" },
              { value: "all", label: "🌐 全履歴" },
            ]}
            value={filterStatus}
            onChange={(v) => setFilterStatus(v as FilterStatus)}
          />
        </div>
      </div>
    </div>
  );
}
