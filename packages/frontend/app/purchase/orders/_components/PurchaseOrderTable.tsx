"use client";

import { DataTable } from "../../../_shared/ui/DataTable";
import { PurchaseOrderRecord, PartnerLookup } from "../_types";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getDocumentLifecycleStatus } from "../../../_shared/status/document-lifecycle-status";

interface PurchaseOrderTableProps {
  orders: PurchaseOrderRecord[];
  partners: PartnerLookup[];
  selectedOrderIds: string[];
  onSelectToggle: (id: string) => void;
  canUpdate: boolean;
  canDelete: boolean;
  isSubmitting: boolean;
  onSelectEdit: (r: PurchaseOrderRecord) => void;
  onDeleteLink: (r: PurchaseOrderRecord) => void;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function PurchaseOrderTable({
  orders,
  partners,
  selectedOrderIds,
  onSelectToggle,
  canUpdate,
  canDelete,
  isSubmitting,
  onSelectEdit,
  onDeleteLink,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: PurchaseOrderTableProps) {
  const partnerName = (partnerId?: string | null) =>
    partners.find((p) => p.id === partnerId)?.name || partnerId || "-";

  return (
    <DataTable
      columns={[
        { key: "select", label: "選択", align: "center" },
        { key: "id", label: "発注番号", sortable: true },
        { key: "title", label: "件名", sortable: true },
        { key: "partnerId", label: "仕入先", sortable: true },
        { key: "status", label: "ステータス", sortable: true },
        { key: "attachments", label: "添付" },
        { key: "totalAmount", label: "合計金額", align: "right", sortable: true },
        { key: "actions", label: "操作", align: "center" },
      ]}
      data={orders}
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      emptyMessage="該当するデータはありません"
      renderRow={(r) => (
        <tr key={r.id} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => onSelectEdit(r)}>
          <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              // メール送信は承認済(APPROVED)の発注書PDFにのみ意味があるため、下書き等は選択させない
              // (見積(QuoteTable.tsx)・受注(OrderTable.tsx)と同じガード)
              disabled={r.status !== "APPROVED"}
              checked={selectedOrderIds.includes(r.id)}
              onChange={() => onSelectToggle(r.id)}
              className="disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            />
          </td>
          <td className="px-4 py-3 font-mono text-xs font-bold text-slate-900">{r.id}</td>
          <td className="px-4 py-3 font-semibold text-slate-900">{r.title || "-"}</td>
          <td className="px-4 py-3 text-xs text-slate-600">{partnerName(r.partnerId)}</td>
          <td className="px-4 py-3">
            <StatusBadge {...getDocumentLifecycleStatus(r.status)} />
          </td>
          <td className="px-4 py-3 whitespace-nowrap">
            {r.attachments && r.attachments.length > 0 ? (
              <span className="inline-flex items-center gap-1 font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded text-[11px] border border-indigo-100">
                📎 あり
              </span>
            ) : (
              <span className="text-slate-600 italic">なし</span>
            )}
          </td>
          <td className="px-4 py-3 text-right text-xs font-mono text-slate-700">
            ¥{Number(r.totalAmount || 0).toLocaleString()}
          </td>
          <td className="px-4 py-3 text-center space-x-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => onSelectEdit(r)}
              disabled={!canUpdate || isSubmitting}
              className={`font-bold ${
                canUpdate && !isSubmitting
                  ? "text-indigo-600 hover:underline cursor-pointer"
                  : "text-slate-600 no-underline cursor-not-allowed"
              }`}
            >
              変更
            </button>
            {r.status !== "PENDING_DELETION" && (
              <button
                type="button"
                onClick={() => void onDeleteLink(r)}
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
