"use client";

import { AccountRecord } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getMasterLifecycleStatus } from "../../../_shared/status/master-lifecycle-status";

interface AccountTableProps {
  accounts: AccountRecord[];
  onSelectAccount: (account: AccountRecord) => void;
  onDelete: (account: AccountRecord) => Promise<void>;
  onSuspend?: (account: AccountRecord) => Promise<void>;
  canUpdate: boolean;
  canDelete: boolean;
  isSubmitting?: boolean;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function AccountTable({
  accounts,
  onSelectAccount,
  onDelete,
  onSuspend,
  canUpdate,
  canDelete,
  isSubmitting = false,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: AccountTableProps) {
  return (
    <DataTable
      columns={[
        { key: "code", label: "科目コード", sortable: true },
        { key: "name", label: "科目名称", sortable: true },
        { key: "externalMappingCode", label: "外部会計コード", sortable: true },
        { key: "status", label: "統制状態", align: "center", sortable: true },
        { key: "memo", label: "備考説明", sortable: true },
        { key: "actions", label: "操作", align: "center" },
      ]}
      data={accounts}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(a) => (
        <tr
          key={a.code}
          className="hover:bg-slate-50 transition-colors cursor-pointer"
          onClick={() => onSelectAccount(a)}
        >
          <td className="px-4 py-3 font-mono font-bold text-slate-900">
            {a.code}
          </td>
          <td className="px-4 py-3 font-semibold text-slate-900">{a.name}</td>
          <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
            {a.externalMappingCode || (
              <span className="text-slate-600 italic">未割当</span>
            )}
          </td>
          <td className="px-4 py-3 text-center whitespace-nowrap">
            <StatusBadge {...getMasterLifecycleStatus(a.status)} />
          </td>
          <td className="px-4 py-3 text-slate-500 truncate max-w-[150px]">
            {a.memo || "—"}
          </td>
          <td
            className="px-4 py-3 text-center space-x-4 whitespace-nowrap"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => onSelectAccount(a)}
              disabled={!canUpdate || isSubmitting}
              className={`font-bold ${
                canUpdate && !isSubmitting
                  ? "text-indigo-600 hover:underline cursor-pointer"
                  : "text-slate-600 no-underline cursor-not-allowed"
              }`}
            >
              変更
            </button>

            {a.status !== "suspended" ? (
              onSuspend && (
                <button
                  onClick={() => void onSuspend(a)}
                  disabled={!canDelete || isSubmitting}
                  className={`font-bold ${
                    canDelete && !isSubmitting
                      ? "text-amber-600 hover:underline cursor-pointer"
                      : "text-slate-600 no-underline cursor-not-allowed"
                  }`}
                >
                  無効化
                </button>
              )
            ) : (
              <button
                onClick={() => void onDelete(a)}
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
