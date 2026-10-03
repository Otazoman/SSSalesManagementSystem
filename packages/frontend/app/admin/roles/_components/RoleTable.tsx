"use client";

import { RoleRecord } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface RoleTableProps {
  roles: RoleRecord[];
  canUpdate: boolean;
  canDelete: boolean;
  isSubmitting?: boolean;
  onSelectRow: (role: RoleRecord) => void;
  onDelete: (id: string) => Promise<void>;
  setError: (err: string) => void;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function RoleTable({
  roles,
  canUpdate,
  canDelete,
  isSubmitting = false,
  onSelectRow,
  onDelete,
  setError,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: RoleTableProps) {
  const confirm = useConfirm();
  const handleDeleteCheck = async (id: string) => {
    if (!canDelete || isSubmitting) return;
    if (id === "admin" || id === "workflow_admin") {
      setError("システム組み込みロールは削除できません");
      return;
    }
    if (
      !(await confirm(
        "このロールを削除しますか？紐づいているユーザーの権限に影響が出る場合があります。",
      ))
    )
      return;
    await onDelete(id);
  };

  return (
    <DataTable
      columns={[
        { key: "id", label: "ロールID", sortable: true },
        { key: "name", label: "ロール表示名", sortable: true },
        { key: "description", label: "職責説明", sortable: true },
        { key: "actions", label: "操作", align: "center", className: "w-[120px]" },
      ]}
      data={roles}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(r) => {
        const isSystemBasic = r.id === "admin" || r.id === "workflow_admin";

        return (
          <tr
            key={r.id}
            className="hover:bg-slate-50 transition-colors cursor-pointer"
            onClick={() => onSelectRow(r)}
          >
            <td className="px-4 py-3 font-mono font-bold text-slate-900">
              {r.id}
            </td>
            <td className="px-4 py-3 font-semibold text-slate-900">
              {r.name}
              {isSystemBasic && (
                <span className="ml-2 text-[9px] bg-slate-100 border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded font-mono font-bold">
                  SYSTEM
                </span>
              )}
            </td>
            <td className="px-4 py-3 text-slate-500 truncate max-w-[300px]">
              {r.description || "—"}
            </td>
            <td
              className="px-4 py-3 text-center space-x-3 whitespace-nowrap w-[120px]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => onSelectRow(r)}
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
                disabled={isSystemBasic || !canDelete || isSubmitting}
                onClick={() => handleDeleteCheck(r.id)}
                className={`font-bold ${
                  !isSystemBasic && canDelete && !isSubmitting
                    ? "text-red-600 hover:underline cursor-pointer"
                    : "text-slate-600 no-underline cursor-not-allowed"
                }`}
              >
                削除
              </button>
            </td>
          </tr>
        );
      }}
    />
  );
}
