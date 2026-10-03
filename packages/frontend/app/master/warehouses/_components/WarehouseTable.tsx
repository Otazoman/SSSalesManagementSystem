"use client";

import { WarehouseRecord, WEEKDAYS } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getMasterLifecycleStatus } from "../../../_shared/status/master-lifecycle-status";

interface WarehouseTableProps {
  warehouses: WarehouseRecord[];
  editingId: string | null;
  onSelect: (w: WarehouseRecord) => void;
  onDelete: (id: string, name: string) => void;
  onSuspend?: (w: WarehouseRecord) => void;
  onManageContacts?: (w: WarehouseRecord) => void;
  canUpdate: boolean;
  canDelete: boolean;
  isSubmitting?: boolean;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function WarehouseTable({
  warehouses,
  editingId,
  onSelect,
  onDelete,
  onSuspend,
  onManageContacts,
  canUpdate,
  canDelete,
  isSubmitting = false,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: WarehouseTableProps) {
  return (
    <DataTable
      columns={[
        { key: "id", label: "倉庫コード", sortable: true },
        { key: "status", label: "状態", sortable: true },
        { key: "name", label: "倉庫名", sortable: true },
        { key: "contact", label: "連絡先 / 住所" },
        { key: "availability", label: "受付可能日時・制限仕様" },
        { key: "actions", label: "操作", align: "center" },
      ]}
      data={warehouses}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(w) => {
        const isCurrentEditing = editingId === w.id;
        return (
          <tr
            key={w.id}
            className={`transition-colors cursor-pointer ${
              isCurrentEditing
                ? "bg-indigo-50/40 hover:bg-indigo-50/60"
                : "hover:bg-slate-50"
            }`}
            onClick={() => onSelect(w)}
          >
            <td className="px-4 py-3 font-mono font-bold text-slate-900 whitespace-nowrap">
              {w.id}
            </td>
            <td className="px-4 py-3">
              <StatusBadge {...getMasterLifecycleStatus(w.status)} />
            </td>
            <td className="px-4 py-3 font-semibold text-slate-900">
              <div className="flex items-center gap-1.5">
                <span>{w.name}</span>
                {w.warehouseType === "EXTERNAL" && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-sky-100 text-sky-800 border border-sky-200 whitespace-nowrap">
                    🚚 外部倉庫
                  </span>
                )}
              </div>
            </td>
            <td className="px-4 py-3">
              <div className="text-slate-600 font-medium">
                TEL: {w.phoneNumber || "-"} / FAX: {w.faxNumber || "-"}
              </div>
              {w.email && (
                <div className="text-slate-500 text-[11px] font-medium truncate">
                  ✉️ {w.email}
                </div>
              )}
              <div className="text-slate-500 text-[11px] mt-0.5">
                <span>
                  〒{w.postalCode || "---"} {w.address || ""}
                </span>
                {w.address && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(w.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center space-x-0.5 ml-2 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100 hover:text-blue-700 font-bold transition-colors"
                    title="GoogleMapで場所を確認する"
                  >
                    <span>🗺️</span>
                    <span>地図で見る</span>
                  </a>
                )}
              </div>
            </td>
            <td className="px-4 py-3 space-y-1 text-slate-600 font-medium">
              <div className="text-[11px] text-slate-800 font-bold">
                🕒 営業時間: {w.businessStartTime || "未設定"} 〜{" "}
                {w.businessEndTime || "未設定"}
              </div>
              {w.storageRestrictions && (
                <div className="text-[11px] text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 inline-block">
                  📦 制限: {w.storageRestrictions}
                </div>
              )}

              <div className="flex flex-wrap gap-1 pt-1">
                {w.availableDays && w.availableDays.length > 0 ? (
                  w.availableDays.map((day, idx) => (
                    <span
                      key={idx}
                      title={day.timeSlotMemo || "終日受入可能"}
                      className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-indigo-50 border border-indigo-100 text-indigo-700 font-bold whitespace-nowrap"
                    >
                      {WEEKDAYS.find(
                        (wd) => wd.key === day.availabledayOfWeek,
                      )?.label.replace("曜日", "")}
                      {day.timeSlotMemo ? ` (${day.timeSlotMemo})` : ""}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-500 italic text-[11px]">
                    受付曜日 未設定
                  </span>
                )}
              </div>

              {w.attachments && w.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1.5 border-t border-slate-100 mt-1">
                  {w.attachments.map((att, idx) => {
                    const fileUrl =
                      att.storageType === "R2" && att.id
                        ? `/api/warehouses/files/${w.id}/${att.id}`
                        : att.externalUrl || "#";

                    return (
                      <a
                        key={idx}
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-slate-100 hover:bg-indigo-50 border text-slate-600 hover:text-indigo-700 font-bold transition-colors"
                      >
                        <span>{att.storageType === "R2" ? "📁" : "🔗"}</span>
                        <span className="truncate max-w-[120px]">
                          {att.fileName}
                        </span>
                      </a>
                    );
                  })}
                </div>
              )}
            </td>
            <td
              className="px-4 py-3 text-center space-x-3 whitespace-nowrap"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => onSelect(w)}
                disabled={!canUpdate || isSubmitting}
                className={`font-bold ${
                  canUpdate && !isSubmitting
                    ? "text-indigo-600 hover:underline cursor-pointer"
                    : "text-slate-500 opacity-60 no-underline cursor-not-allowed"
                }`}
              >
                {isCurrentEditing ? "調整中" : "変更"}
              </button>
              {onManageContacts && (
                <button
                  type="button"
                  onClick={() => onManageContacts(w)}
                  className="font-bold text-sky-600 hover:underline cursor-pointer"
                >
                  📇 連絡先
                </button>
              )}
              {w.status !== "suspended" ? (
                onSuspend && (
                  <button
                    type="button"
                    onClick={() => onSuspend(w)}
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
                  onClick={() => onDelete(w.id, w.name)}
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
