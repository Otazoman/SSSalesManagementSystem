import React from "react";
import { TableScroll } from "../../../_shared/ui/TableScroll";
import { PaymentRecord, PartnerMaster } from "../_types";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getReconciliationStatus } from "../../../_shared/status";

interface PaymentTableProps {
  payments: PaymentRecord[];
  partners: PartnerMaster[];
  onOpenDetail: (id: string) => void;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string, additive?: boolean) => void;
  // ファームバンキング: 一覧からの振込データ作成対象選択(未指定なら選択列自体を表示しない)
  selectedPaymentIds?: string[];
  onToggleSelectPayment?: (id: string) => void;
}

const MODE_LABELS: Record<string, string> = {
  PER_TRANSACTION: "都度支払",
  PERIODIC: "締め支払",
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

// Item10 Phase5: sales/billing/_components/BillingTable.tsxと同じ構成
export function PaymentTable({
  payments,
  partners,
  onOpenDetail,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
  selectedPaymentIds,
  onToggleSelectPayment,
}: PaymentTableProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
      <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center shrink-0">
        <span className="text-xs font-bold text-slate-700">
          📋 支払データ一覧
        </span>
        <span className="text-xs font-semibold text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-full">
          該当 {payments.length} 件
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
              {onToggleSelectPayment && (
                <th className="px-4 py-3 w-10 text-center bg-slate-100 border-b border-slate-200 shadow-xs">
                  選択
                </th>
              )}
              <SortableTh
                label="支払コード"
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
                label="支払先"
                sortKey="partnerId"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-32"
              />
              <SortableTh
                label="支払日"
                sortKey="paymentDate"
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
            {payments.length > 0 ? (
              payments.map((p) => {
                return (
                  <tr
                    key={p.id}
                    onClick={() => onOpenDetail(p.id)}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    {onToggleSelectPayment && (
                      <td
                        className="px-4 py-3 text-center whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          disabled={p.reconciliationStatus === "RECONCILED"}
                          checked={!!selectedPaymentIds?.includes(p.id)}
                          onChange={() => onToggleSelectPayment(p.id)}
                          className="disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 font-mono font-bold text-indigo-600 whitespace-nowrap">
                      {p.id}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {MODE_LABELS[p.mode] || p.mode}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold font-mono text-slate-600 whitespace-nowrap">
                      {partners.find((partner) => partner.id === p.partnerId)
                        ?.name || p.partnerId}
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-slate-600 whitespace-nowrap">
                      {p.paymentDate ? p.paymentDate.split("T")[0] : ""}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 text-right whitespace-nowrap">
                      ¥{(p.totalAmount ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <StatusBadge
                        {...getReconciliationStatus(p.reconciliationStatus)}
                      />
                    </td>
                    <td
                      className="px-4 py-3 text-center whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenDetail(p.id)}
                        className="font-bold text-indigo-600 hover:text-indigo-900 hover:underline cursor-pointer transition-colors text-xs"
                      >
                        詳細
                      </button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={onToggleSelectPayment ? 8 : 7}
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
