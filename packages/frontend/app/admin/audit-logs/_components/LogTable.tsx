"use client";

import { AuditLogRecord } from "../_types/index";
import { DataTable } from "../../../_shared/ui/DataTable";

interface LogTableProps {
  logs: AuditLogRecord[];
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function LogTable({ logs, sortBy, sortDirection, sortKeys, onSortChange }: LogTableProps) {
  return (
    <DataTable
      columns={[
        { key: "performedAt", label: "実行日時", className: "min-w-[140px]", sortable: true },
        { key: "userId", label: "実行ユーザー", sortable: true },
        { key: "tableName", label: "対象アプリケーション・画面", sortable: true },
        { key: "action", label: "操作 (Action)", sortable: true },
        { key: "diff", label: "詳細なデータ変更履歴 (JSON)", className: "max-w-[300px]" },
      ]}
      data={logs}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(log) => (
        <tr key={log.id} className="hover:bg-slate-50 transition-colors">
          <td className="px-4 py-3 font-mono text-[11px] whitespace-nowrap">
            {new Date(log.performedAt).toLocaleString("ja-JP")}
          </td>
          <td className="px-4 py-3">
            <span className="font-semibold text-slate-900 font-mono">
              {log.userId}
            </span>
          </td>
          <td className="px-4 py-3">
            <div className="font-bold text-slate-900 text-xs">
              {log.screenName}
            </div>
            <div className="text-[10px] text-slate-600 font-mono">
              {log.tableName}
            </div>
          </td>
          <td className="px-4 py-3">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                log.action.includes("CREATE") || log.action.includes("SUCCESS")
                  ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                  : log.action.includes("UPDATE")
                    ? "bg-amber-50 text-amber-700 border-amber-100"
                    : "bg-rose-50 text-rose-700 border-rose-100"
              }`}
            >
              {log.action}
            </span>
          </td>
          <td className="px-4 py-3 max-w-[400px]">
            <div className="space-y-1 text-[10px] font-mono leading-tight max-h-[100px] overflow-y-auto bg-slate-50 p-2 rounded border border-slate-200">
              {log.oldValues && (
                <div className="text-rose-600 truncate" title={log.oldValues}>
                  <span className="font-bold">[前]</span> {log.oldValues}
                </div>
              )}
              {log.newValues && (
                <div
                  className="text-emerald-600 truncate"
                  title={log.newValues}
                >
                  <span className="font-bold">[後]</span> {log.newValues}
                </div>
              )}
              {!log.oldValues && !log.newValues && (
                <span className="text-slate-600 italic">付帯データなし</span>
              )}
            </div>
          </td>
        </tr>
      )}
    />
  );
}
