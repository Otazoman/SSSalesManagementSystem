import React from "react";
import { TableScroll } from "../../../_shared/ui/TableScroll";
import { BillingRecord, PartnerMaster } from "../_types";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import {
  getReconciliationStatus,
  getBillingPaymentHeaderStatus,
} from "../../../_shared/status";

interface BillingTableProps {
  billings: BillingRecord[];
  partners: PartnerMaster[];
  onOpenDetail: (id: string) => void;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string, additive?: boolean) => void;
  // 追加要望: 一覧からの一括メール送信用チェックボックス選択(sales/invoices/SalesInvoiceTable.tsxと同型)
  selectedBillingIds?: string[];
  onSelectToggle?: (id: string) => void;
  // 追加要望: 詳細画面を経由せず、一覧から直接1件だけ送信する(初回送信・再送付とも)
  onSendEmail?: (id: string) => void;
}

const MODE_LABELS: Record<string, string> = {
  PER_TRANSACTION: "都度請求",
  PERIODIC: "締め請求",
};

function SortableTh({
  label,
  sortKey,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
  className = "",
}: {
  label: string;
  sortKey: string;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string, additive?: boolean) => void;
  className?: string;
}) {
  const isSortable = !!onSortChange;
  const multiIndex = sortKeys?.findIndex((s) => s.key === sortKey);
  const activeSortKey =
    sortKeys && multiIndex !== undefined && multiIndex >= 0
      ? sortKeys[multiIndex]
      : isSortable && sortBy === sortKey
        ? { key: sortKey, direction: sortDirection ?? "asc" }
        : undefined;
  const isActive = isSortable && !!activeSortKey;
  return (
    <th
      className={`px-4 py-3 bg-slate-100 border-b border-slate-200 shadow-xs ${
        isSortable ? "cursor-pointer select-none hover:bg-slate-200" : ""
      } ${className}`}
      onClick={
        isSortable ? (e) => onSortChange!(sortKey, e.shiftKey) : undefined
      }
    >
      {label}
      {isSortable && (
        <span className="ml-1 inline-block w-4 text-slate-600">
          {isActive ? (activeSortKey!.direction === "asc" ? "▲" : "▼") : ""}
        </span>
      )}
    </th>
  );
}

// Item8 Phase4: sales/invoices/_components/SalesInvoiceTable.tsxと同じ構成
export function BillingTable({
  billings,
  partners,
  onOpenDetail,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
  selectedBillingIds = [],
  onSelectToggle,
  onSendEmail,
}: BillingTableProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
      <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center shrink-0">
        <span className="text-xs font-bold text-slate-700">
          📋 請求データ一覧
        </span>
        <span className="text-xs font-semibold text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-full">
          該当 {billings.length} 件
        </span>
      </div>
      {/* K-1(2026-09-14): Shift+クリックでの複合ソートの常時表示ヒント(DataTable.tsxと同じ) */}
      {onSortChange && (
        <div className="px-3 py-1 text-[10px] text-slate-600 border-b border-slate-100 bg-slate-50 shrink-0">
          💡 列見出しクリックでソート /
          Shift+クリックで複数列を優先順位付きソート
        </div>
      )}

      <TableScroll
        bare
        minWidth={900}
        className="overflow-y-auto max-h-[calc(100vh-280px)] relative"
      >
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-slate-100 text-slate-600 font-bold select-none sticky top-0 z-10">
            <tr>
              {onSelectToggle && (
                <th className="px-4 py-3 w-12 text-center bg-slate-100 border-b border-slate-200 shadow-xs">
                  選択
                </th>
              )}
              <SortableTh
                label="請求コード"
                sortKey="id"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-32"
              />
              <SortableTh
                label="モード"
                sortKey="mode"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-24"
              />
              <SortableTh
                label="請求先"
                sortKey="partnerId"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-32"
              />
              <SortableTh
                label="請求日"
                sortKey="billingDate"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-28"
              />
              <SortableTh
                label="合計金額 (税込)"
                sortKey="totalAmount"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-32 text-right"
              />
              <th className="px-4 py-3 w-28 text-center bg-slate-100 border-b border-slate-200 shadow-xs">
                状態
              </th>
              <SortableTh
                label="消込状況"
                sortKey="reconciliationStatus"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-28 text-center"
              />
              <th className="px-4 py-3 w-24 text-center bg-slate-100 border-b border-slate-200 shadow-xs">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-700">
            {billings.length > 0 ? (
              billings.map((b) => {
                const isChecked = selectedBillingIds.includes(b.id);
                return (
                  <tr
                    key={b.id}
                    onClick={() => onOpenDetail(b.id)}
                    className={`hover:bg-slate-50 transition-colors cursor-pointer ${
                      isChecked ? "bg-indigo-50/40" : ""
                    }`}
                  >
                    {onSelectToggle && (
                      <td
                        className="px-4 py-3 text-center whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => onSelectToggle(b.id)}
                          className="cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 font-mono font-bold text-indigo-600 whitespace-nowrap">
                      {b.id}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {MODE_LABELS[b.mode] || b.mode}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold font-mono text-slate-600 whitespace-nowrap">
                      {partners.find((p) => p.id === b.partnerId)?.name ||
                        b.partnerId}
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-slate-600 whitespace-nowrap">
                      {b.billingDate ? b.billingDate.split("T")[0] : ""}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 text-right whitespace-nowrap">
                      ¥{(b.totalAmount ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <StatusBadge
                        {...getBillingPaymentHeaderStatus(b.status)}
                      />
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <StatusBadge
                        {...getReconciliationStatus(b.reconciliationStatus)}
                      />
                    </td>
                    <td
                      className="px-4 py-3 text-center whitespace-nowrap space-x-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenDetail(b.id)}
                        className="font-bold text-indigo-600 hover:text-indigo-900 hover:underline cursor-pointer transition-colors text-xs"
                      >
                        詳細
                      </button>
                      {onSendEmail && (
                        <button
                          type="button"
                          onClick={() => onSendEmail(b.id)}
                          className="font-bold text-emerald-600 hover:text-emerald-800 hover:underline cursor-pointer transition-colors text-xs"
                        >
                          📧 送信
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={onSelectToggle ? 9 : 8}
                  className="text-center py-8 text-slate-600 italic bg-slate-50"
                >
                  レコードが見つかりません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}
