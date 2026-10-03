"use client";

import { UnitRecord } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";

interface UnitTableProps {
  units: UnitRecord[];
  editingUnit: UnitRecord | null;
  canUpdate: boolean;
  canDelete: boolean;
  isSubmitting?: boolean;
  onStartEdit: (u: UnitRecord) => void;
  onDelete: (u: UnitRecord) => void;
  onSuspend?: (u: UnitRecord) => void;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function UnitTable({
  units,
  editingUnit,
  canUpdate,
  canDelete,
  isSubmitting = false,
  onStartEdit,
  onDelete,
  onSuspend,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: UnitTableProps) {
  return (
    <DataTable
      columns={[
        { key: "code", label: "単位コード", sortable: true },
        { key: "name", label: "単位名称", sortable: true },
        { key: "actions", label: "操作", align: "center" },
      ]}
      data={units}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(u) => {
        const isCurrentEditing = editingUnit?.code === u.code;
        return (
          <tr
            key={u.code}
            className={`hover:bg-slate-50 transition-colors ${
              isCurrentEditing ? "bg-indigo-50/40" : ""
            } ${u.status === "suspended" ? "bg-slate-50/60 text-slate-500" : ""} cursor-pointer`}
            onClick={() => onStartEdit(u)}
          >
            <td className="px-4 py-3 font-mono font-bold text-slate-900">
              {u.code}
            </td>
            <td className="px-4 py-3 font-semibold text-slate-900">
              {u.name}
              {u.status === "temporary" && (
                <span className="ml-2 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold border border-amber-200">
                  仮登録/申請中
                </span>
              )}
              {u.status === "suspended" && (
                <span className="ml-2 text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold border border-red-200">
                  無効
                </span>
              )}
            </td>
            <td
              className="px-4 py-3 text-center space-x-4 whitespace-nowrap"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => onStartEdit(u)}
                disabled={!canUpdate || isSubmitting}
                className={`font-bold ${
                  canUpdate && !isSubmitting
                    ? "text-indigo-600 hover:underline cursor-pointer"
                    : "text-slate-500 opacity-60 no-underline cursor-not-allowed"
                }`}
              >
                変更
              </button>

              {u.status !== "suspended" ? (
                onSuspend && (
                  <button
                    type="button"
                    onClick={() => onSuspend(u)}
                    disabled={!canDelete || isSubmitting}
                    className={`font-bold ${
                      canDelete && !isSubmitting
                        ? "text-amber-600 hover:underline cursor-pointer"
                        : "text-slate-500 opacity-60 no-underline cursor-not-allowed"
                    }`}
                  >
                    無効化
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => void onDelete(u)}
                  disabled={!canDelete || isSubmitting}
                  className={`font-bold ${
                    canDelete && !isSubmitting
                      ? "text-red-600 hover:underline cursor-pointer"
                      : "text-slate-500 opacity-60 no-underline cursor-not-allowed"
                  }`}
                >
                  完全に削除 🗑️
                </button>
              )}
            </td>
          </tr>
        );
      }}
    />
  );
}
