"use client";

import { PartnerRecord } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getMasterLifecycleStatus } from "../../../_shared/status";

interface PartnerTableProps {
  partners: PartnerRecord[];
  canUpdate: boolean;
  canDelete: boolean;
  isSubmitting: boolean;
  onSelectRow: (partner: PartnerRecord) => void;
  onSuspend: (id: string, name: string) => void;
  onPurge: (id: string, name: string) => void;
  onManageDeliveryDestinations?: (partner: PartnerRecord) => void;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export default function PartnerTable({
  partners,
  canUpdate,
  canDelete,
  isSubmitting,
  onSelectRow,
  onSuspend,
  onPurge,
  onManageDeliveryDestinations,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: PartnerTableProps) {
  return (
    <DataTable
      columns={[
        { key: "id", label: "取引先コード", sortable: true },
        { key: "name", label: "取引先名", sortable: true },
        { key: "type", label: "区分", sortable: true },
        { key: "payment", label: "決済サイト / 与信枠" },
        { key: "address", label: "住所", sortable: true },
        { key: "actions", label: "操作", align: "center" },
      ]}
      data={partners}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(c) => (
        <tr
          key={c.id}
          className={`hover:bg-slate-50 transition-colors ${c.status === "suspended" ? "bg-slate-50/60 text-slate-500" : ""} cursor-pointer`}
          onClick={() => onSelectRow(c)}
        >
          <td className="px-4 py-3 font-mono font-bold text-slate-900">
            {c.id}
          </td>
          <td className="px-4 py-3 font-semibold text-slate-900">
            {c.name}
            {c.status !== "active" && (
              <StatusBadge {...getMasterLifecycleStatus(c.status)} className="ml-2" />
            )}
          </td>
          <td className="px-4 py-3">
            <span
              className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded border ${c.type === "CUSTOMER" ? "bg-emerald-50 text-emerald-700 border-emerald-100" : c.type === "SUPPLIER" ? "bg-blue-50 text-blue-700 border-blue-100" : c.type === "PROSPECT" ? "bg-sky-50 text-sky-700 border-sky-100" : "bg-purple-50 text-purple-700 border-purple-100"}`}
            >
              {c.type === "CUSTOMER"
                ? "得意先"
                : c.type === "SUPPLIER"
                  ? "仕入先"
                  : c.type === "PROSPECT"
                    ? "見込み客"
                    : "両方 (双方取引)"}
            </span>
          </td>
          <td className="px-4 py-3">
            <div className="font-semibold text-slate-900">
              ⏱{" "}
              {!c.closingDay || c.paymentMonthOffset === null || !c.paymentDay
                ? "未指定 (都度/個別調整)"
                : `${c.closingDay === 99 ? "月末" : `${c.closingDay}日`}締め / ${c.paymentMonthOffset === 0 ? "当月" : c.paymentMonthOffset === 1 ? "翌月" : `${c.paymentMonthOffset}ヶ月後`}${c.paymentDay === 99 ? "末日" : `${c.paymentDay}日`}払い`}
            </div>
            <div className="text-slate-600 font-mono text-[11px] mt-0.5">
              枠: ¥{c.creditLimit.toLocaleString()}
            </div>
          </td>
          <td className="px-4 py-3 text-slate-700 max-w-[200px]">
            {/* 長い住所は省略記号(…)で切り、マウスを重ねると全文を表示する(title) */}
            <div className="flex flex-col items-start gap-1 min-w-0">
              <span
                className="block w-full truncate"
                title={`〒${c.postalCode ?? ""} ${c.address ?? ""}`}
              >
                〒{c.postalCode} {c.address}
              </span>
              {c.address && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 inline-flex items-center space-x-0.5 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100 hover:text-blue-700 font-bold transition-colors"
                >
                  <span>🗺️</span>
                  <span>地図で見る</span>
                </a>
              )}
            </div>
          </td>
          <td
            className="px-4 py-3 text-center space-x-4 whitespace-nowrap"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => onSelectRow(c)}
              disabled={!canUpdate || isSubmitting}
              className={`font-bold ${canUpdate && !isSubmitting ? "text-indigo-600 hover:underline cursor-pointer" : "text-slate-500 opacity-60 no-underline cursor-not-allowed"}`}
            >
              変更
            </button>

            {onManageDeliveryDestinations && (
              <button
                onClick={() => onManageDeliveryDestinations(c)}
                className="font-bold text-sky-600 hover:underline cursor-pointer"
              >
                📦 納品先
              </button>
            )}

            {c.status !== "suspended" ? (
              <button
                onClick={() => onSuspend(c.id, c.name)}
                disabled={!canDelete || isSubmitting}
                className={`font-bold ${canDelete && !isSubmitting ? "text-amber-600 hover:underline cursor-pointer" : "text-slate-500 opacity-60 no-underline cursor-not-allowed"}`}
              >
                無効化
              </button>
            ) : (
              <button
                onClick={() => onPurge(c.id, c.name)}
                disabled={!canDelete || isSubmitting}
                className={`font-bold ${canDelete && !isSubmitting ? "text-red-600 hover:underline cursor-pointer" : "text-slate-500 opacity-60 no-underline cursor-not-allowed"}`}
              >
                完全に削除 🗑️
              </button>
            )}
          </td>
        </tr>
      )}
    />
  );
}
