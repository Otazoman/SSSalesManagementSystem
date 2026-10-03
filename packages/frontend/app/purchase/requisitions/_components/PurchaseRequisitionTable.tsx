"use client";

import { DataTable } from "../../../_shared/ui/DataTable";
import { PurchaseRequisitionRecord } from "../_types";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getDocumentLifecycleStatus } from "../../../_shared/status/document-lifecycle-status";

const CATEGORY_LABEL: Record<string, string> = {
  ONE_TIME: "都度",
  PERIODIC: "定期",
  PREPAYMENT: "前払",
};

interface PurchaseRequisitionTableProps {
  requisitions: PurchaseRequisitionRecord[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isSubmitting: boolean;
  onSelectEdit: (r: PurchaseRequisitionRecord) => void;
  onDeleteLink: (r: PurchaseRequisitionRecord) => void;
  // Phase4: 「コピーして下書き作成」。ステータス問わず、別レコードとして新規複製する
  onCopyToNewDraft: (r: PurchaseRequisitionRecord) => void;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function PurchaseRequisitionTable({
  requisitions,
  canCreate,
  canUpdate,
  canDelete,
  isSubmitting,
  onSelectEdit,
  onDeleteLink,
  onCopyToNewDraft,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: PurchaseRequisitionTableProps) {
  return (
    <DataTable
      columns={[
        { key: "id", label: "申請番号", sortable: true },
        { key: "title", label: "件名", sortable: true },
        { key: "requestType", label: "購買区分", sortable: true },
        { key: "status", label: "ステータス", sortable: true },
        { key: "totalAmount", label: "合計金額", align: "right", sortable: true },
        { key: "actions", label: "操作", align: "center" },
      ]}
      data={requisitions}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(r) => (
        <tr
          key={r.id}
          className="hover:bg-slate-50 transition-colors cursor-pointer"
          onClick={() => onSelectEdit(r)}
        >
          <td className="px-4 py-3 font-mono text-xs font-bold text-slate-900">{r.id}</td>
          <td className="px-4 py-3 font-semibold text-slate-900">{r.title}</td>
          <td className="px-4 py-3 text-xs text-slate-600">
            {CATEGORY_LABEL[r.requestType] || r.requestType}
          </td>
          <td className="px-4 py-3">
            <StatusBadge {...getDocumentLifecycleStatus(r.status)} />
          </td>
          <td className="px-4 py-3 text-right text-xs font-mono text-slate-700">
            ¥{Number(r.totalAmount || 0).toLocaleString()}
          </td>
          <td
            className="px-4 py-3 text-center space-x-4 whitespace-nowrap"
            onClick={(e) => e.stopPropagation()}
          >
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
            <button
              type="button"
              onClick={() => void onCopyToNewDraft(r)}
              disabled={!canCreate || isSubmitting}
              className={`font-bold ${
                canCreate && !isSubmitting
                  ? "text-slate-500 hover:underline cursor-pointer"
                  : "text-slate-600 no-underline cursor-not-allowed"
              }`}
            >
              コピー
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
