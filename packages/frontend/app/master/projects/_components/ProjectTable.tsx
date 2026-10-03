"use client";

import { ProjectRecord } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getMasterLifecycleStatus } from "../../../_shared/status/master-lifecycle-status";

interface ProjectTableProps {
  projects: ProjectRecord[];
  onSelectProject: (project: ProjectRecord) => void;
  onDelete: (project: ProjectRecord) => Promise<void>;
  onSuspend: (project: ProjectRecord) => Promise<void>;
  canUpdate: boolean;
  canDelete: boolean;
  isSubmitting?: boolean;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function ProjectTable({
  projects,
  onSelectProject,
  onDelete,
  onSuspend,
  canUpdate,
  canDelete,
  isSubmitting = false,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: ProjectTableProps) {
  return (
    <DataTable
      columns={[
        { key: "id", label: "PJコード", sortable: true },
        { key: "name", label: "プロジェクト名称", sortable: true },
        { key: "startDate", label: "開始時期", sortable: true },
        { key: "endDate", label: "終了時期", sortable: true },
        { key: "status", label: "状態", align: "center", sortable: true },
        { key: "memo", label: "メモ" },
        { key: "actions", label: "操作", align: "center" },
      ]}
      data={projects}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(p) => (
        <tr
          key={p.id}
          className="hover:bg-slate-50 transition-colors cursor-pointer"
          onClick={() => onSelectProject(p)}
        >
          <td className="px-4 py-3 font-mono font-bold text-slate-900">{p.id}</td>
          <td className="px-4 py-3 font-semibold text-slate-900">{p.name}</td>
          <td className="px-4 py-3 text-slate-600 font-mono whitespace-nowrap">
            {p.startDate ? p.startDate.split("T")[0] : "—"}
          </td>
          <td className="px-4 py-3 text-slate-600 font-mono whitespace-nowrap">
            {p.endDate ? p.endDate.split("T")[0] : "—"}
          </td>
          <td className="px-4 py-3 text-center whitespace-nowrap">
            <StatusBadge {...getMasterLifecycleStatus(p.status)} />
          </td>
          <td className="px-4 py-3 text-slate-500 truncate max-w-[150px]">{p.memo || "—"}</td>
          <td
            className="px-4 py-3 text-center space-x-4 whitespace-nowrap"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => onSelectProject(p)}
              disabled={!canUpdate || isSubmitting}
              className={`font-bold ${
                canUpdate && !isSubmitting
                  ? "text-indigo-600 hover:underline cursor-pointer"
                  : "text-slate-600 no-underline cursor-not-allowed"
              }`}
            >
              変更
            </button>

            {p.status !== "suspended" ? (
              <button
                onClick={() => void onSuspend(p)}
                disabled={!canDelete || isSubmitting}
                className={`font-bold ${
                  canDelete && !isSubmitting
                    ? "text-amber-600 hover:underline cursor-pointer"
                    : "text-slate-600 no-underline cursor-not-allowed"
                }`}
              >
                無効化
              </button>
            ) : (
              <button
                onClick={() => void onDelete(p)}
                disabled={!canDelete || isSubmitting}
                className={`font-bold ${
                  canDelete && !isSubmitting
                    ? "text-red-600 hover:underline cursor-pointer"
                    : "text-slate-600 no-underline cursor-not-allowed"
                }`}
              >
                削除
              </button>
            )}
          </td>
        </tr>
      )}
    />
  );
}
