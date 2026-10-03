"use client";

import { BusinessLocationRecord } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getMasterLifecycleStatus } from "../../../_shared/status/master-lifecycle-status";

interface BusinessLocationTableProps {
  businessLocations: BusinessLocationRecord[];
  editingId: string | null;
  onSelect: (loc: BusinessLocationRecord) => void;
  onDelete: (id: string, name: string) => void;
  onSuspend?: (loc: BusinessLocationRecord) => void;
  canUpdate: boolean;
  canDelete: boolean;
  isSubmitting?: boolean;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function BusinessLocationTable({
  businessLocations,
  editingId,
  onSelect,
  onDelete,
  onSuspend,
  canUpdate,
  canDelete,
  isSubmitting = false,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: BusinessLocationTableProps) {
  return (
    <DataTable
      columns={[
        { key: "id", label: "拠点コード", sortable: true },
        { key: "status", label: "状態", sortable: true },
        { key: "name", label: "拠点名", sortable: true },
        { key: "contact", label: "連絡先 / 住所" },
        { key: "memo", label: "備考" },
        { key: "actions", label: "操作", align: "center" },
      ]}
      data={businessLocations}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(loc) => {
        const isCurrentEditing = editingId === loc.id;
        return (
          <tr
            key={loc.id}
            className={`transition-colors cursor-pointer ${
              isCurrentEditing
                ? "bg-indigo-50/40 hover:bg-indigo-50/60"
                : "hover:bg-slate-50"
            }`}
            onClick={() => onSelect(loc)}
          >
            <td className="px-4 py-3 font-mono font-bold text-slate-900 whitespace-nowrap">
              {loc.id}
            </td>
            <td className="px-4 py-3">
              <StatusBadge {...getMasterLifecycleStatus(loc.status)} />
            </td>
            <td className="px-4 py-3 font-semibold text-slate-900">{loc.name}</td>
            <td className="px-4 py-3">
              <div className="text-slate-700 font-medium">
                TEL: {loc.phoneNumber || "-"}
              </div>
              <div className="text-slate-600 text-[11px] mt-0.5">
                <span>
                  〒{loc.postalCode || "---"} {loc.address || ""}
                </span>
                {loc.address && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center space-x-0.5 ml-2 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 hover:text-blue-800 font-bold transition-colors"
                    title="GoogleMapで場所を確認する"
                  >
                    <span>🗺️</span>
                    <span>地図で見る</span>
                  </a>
                )}
              </div>
            </td>
            <td className="px-4 py-3 text-slate-700 font-medium">
              {loc.memo || <span className="text-slate-500">-</span>}
            </td>
            <td
              className="px-4 py-3 text-center space-x-3 whitespace-nowrap"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => onSelect(loc)}
                disabled={!canUpdate || isSubmitting}
                className={`font-bold ${
                  canUpdate && !isSubmitting
                    ? "text-indigo-600 hover:underline cursor-pointer"
                    : "text-slate-500 no-underline cursor-not-allowed"
                }`}
              >
                {isCurrentEditing ? "調整中" : "変更"}
              </button>
              {loc.status !== "suspended" ? (
                onSuspend && (
                  <button
                    type="button"
                    onClick={() => onSuspend(loc)}
                    disabled={!canDelete || isSubmitting}
                    className={`font-bold ${
                      canDelete && !isSubmitting
                        ? "text-amber-600 hover:underline cursor-pointer"
                        : "text-slate-500 no-underline cursor-not-allowed"
                    }`}
                  >
                    無効化
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => onDelete(loc.id, loc.name)}
                  disabled={!canDelete || isSubmitting}
                  className={`font-bold ${
                    canDelete && !isSubmitting
                      ? "text-red-600 hover:underline cursor-pointer"
                      : "text-slate-500 no-underline cursor-not-allowed"
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
