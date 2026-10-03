import React from "react";
import { TableScroll } from "../../../_shared/ui/TableScroll";
import { SalesInvoiceRecord, PartnerMaster, UserOption } from "../_types";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getDocumentLifecycleStatus } from "../../../_shared/status/document-lifecycle-status";

interface SalesInvoiceTableProps {
  invoices: SalesInvoiceRecord[];
  partners: PartnerMaster[];
  userMaster: UserOption[];
  onOpenEditForm: (id: string) => void;
  // 追加要望L-2-a: 元の売上から赤伝を起票する(承認済みの通常売上のみ)
  onIssueRedSlip?: (id: string) => void;
  canCreate?: boolean;
  onDeleteInvoice: (id: string) => void;
  onOpenPreview: (id: string) => void;
  canUpdate: boolean;
  canDelete: boolean;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string, additive?: boolean) => void;
  // K-4-1: 一覧からの一括メール送信用チェックボックス選択(QuoteTable.tsxと同型)
  selectedInvoiceIds?: string[];
  onSelectToggle?: (id: string) => void;
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  SALE: "通常売上",
  RETURN: "赤伝(返品)",
  DISCOUNT: "赤伝(値引)",
  CORRECTION: "赤伝(訂正)",
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
  const priority =
    sortKeys &&
    sortKeys.length > 1 &&
    multiIndex !== undefined &&
    multiIndex >= 0
      ? multiIndex + 1
      : undefined;
  return (
    <th
      className={`px-3 py-3 bg-slate-100 border-b border-slate-200 shadow-xs ${
        isSortable ? "cursor-pointer select-none hover:bg-slate-200" : ""
      } ${className}`}
      onClick={
        isSortable ? (e) => onSortChange!(sortKey, e.shiftKey) : undefined
      }
      title={
        isSortable
          ? "クリック: ソート / Shift+クリック: 複合ソートに追加"
          : undefined
      }
      aria-sort={
        isActive
          ? activeSortKey!.direction === "asc"
            ? "ascending"
            : "descending"
          : undefined
      }
    >
      {label}
      {isSortable && (
        <span className="ml-1 inline-block w-4 text-slate-600">
          {isActive
            ? `${priority ?? ""}${activeSortKey!.direction === "asc" ? "▲" : "▼"}`
            : ""}
        </span>
      )}
    </th>
  );
}

export function SalesInvoiceTable({
  invoices,
  partners,
  userMaster,
  onOpenEditForm,
  onIssueRedSlip,
  canCreate,
  onDeleteInvoice,
  onOpenPreview,
  canUpdate,
  canDelete,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
  selectedInvoiceIds = [],
  onSelectToggle,
}: SalesInvoiceTableProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
      <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center shrink-0">
        <span className="text-xs font-bold text-slate-700">
          📋 売上データ一覧
        </span>
        <span className="text-xs font-semibold text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-full">
          該当 {invoices.length} 件
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
        // BUG-018: 画面幅 1280px で右端の列が切れないよう、取引先名は折り返し、余白を詰めて 900px にする
        minWidth={900}
        className="overflow-y-auto max-h-[calc(100vh-280px)] relative"
      >
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-slate-100 text-slate-600 font-bold select-none sticky top-0 z-10">
            <tr>
              {onSelectToggle && (
                <th className="px-3 py-3 w-12 text-center bg-slate-100 border-b border-slate-200 shadow-xs">
                  選択
                </th>
              )}
              <SortableTh
                label="売上コード"
                sortKey="id"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-32"
              />
              <SortableTh
                label="種別"
                sortKey="documentType"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-20"
              />
              <SortableTh
                label="取引先名"
                sortKey="partnerId"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-32"
              />
              <SortableTh
                label="自社担当者"
                sortKey="salesPersonEmployeeNumber"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-32"
              />
              <SortableTh
                label="売上日"
                sortKey="invoiceDate"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-28"
              />
              <th className="px-3 py-3 w-24 bg-slate-100 border-b border-slate-200 shadow-xs">
                請求状況
              </th>
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
                label="ステータス"
                sortKey="status"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-28 text-center"
              />
              <th className="px-3 py-3 w-24 text-center bg-slate-100 border-b border-slate-200 shadow-xs">
                内容確認
              </th>
              <th className="px-3 py-3 w-32 text-center bg-slate-100 border-b border-slate-200 shadow-xs">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-700">
            {invoices.length > 0 ? (
              invoices.map((inv) => {
                const handlerUser = userMaster.find(
                  (u) => u.employeeNumber === inv.salesPersonEmployeeNumber,
                );
                const isChecked = selectedInvoiceIds.includes(inv.id);
                return (
                  <tr
                    key={inv.id}
                    onClick={() => onOpenEditForm(inv.id)}
                    className={`hover:bg-slate-50 transition-colors cursor-pointer ${
                      isChecked ? "bg-indigo-50/40" : ""
                    }`}
                  >
                    {onSelectToggle && (
                      <td
                        className="px-3 py-3 text-center whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          disabled={inv.status !== "APPROVED"}
                          checked={isChecked}
                          onChange={() => onSelectToggle(inv.id)}
                          className="disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-3 py-3 font-mono font-bold text-indigo-600 whitespace-nowrap">
                      {inv.id}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          inv.documentType === "SALE"
                            ? "bg-slate-100 text-slate-800"
                            : "bg-rose-100 text-rose-800 border border-rose-300"
                        }`}
                      >
                        {DOCUMENT_TYPE_LABELS[inv.documentType] ||
                          inv.documentType}
                      </span>
                      {inv.documentType !== "SALE" && inv.originalInvoiceId && (
                        <div className="text-[10px] text-slate-700 mt-0.5">
                          元: {inv.originalInvoiceId}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 font-semibold font-mono text-slate-600 min-w-[8rem]">
                      {partners.find((p) => p.id === inv.partnerId)?.name ||
                        inv.partnerId}
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-700 whitespace-nowrap">
                      {handlerUser ? handlerUser.name : "未設定"}
                    </td>
                    <td className="px-3 py-3 font-mono font-medium text-slate-600 whitespace-nowrap">
                      {inv.invoiceDate ? inv.invoiceDate.split("T")[0] : ""}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="text-[10px] font-bold text-slate-500">
                        {inv.billingStatus === "BILLED" ? "請求済" : "未請求"}
                      </span>
                    </td>
                    <td
                      className={`px-3 py-3 font-mono font-bold text-right whitespace-nowrap ${
                        inv.documentType === "SALE"
                          ? "text-slate-900"
                          : "text-rose-800"
                      }`}
                    >
                      {inv.documentType === "SALE" ? "" : "△"}¥
                      {(inv.totalAmount ?? 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-center whitespace-nowrap">
                      <StatusBadge
                        {...getDocumentLifecycleStatus(inv.status)}
                      />
                    </td>
                    <td
                      className="px-3 py-3 text-center whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenPreview(inv.id)}
                        className="font-bold text-indigo-600 hover:text-indigo-900 hover:underline cursor-pointer transition-colors text-xs"
                      >
                        確認
                      </button>
                    </td>
                    <td
                      className="px-3 py-3 text-center space-x-2.5 whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {onIssueRedSlip &&
                        inv.documentType === "SALE" &&
                        inv.status === "APPROVED" && (
                          <button
                            type="button"
                            onClick={() => onIssueRedSlip(inv.id)}
                            disabled={!canCreate}
                            title="この売上の内容で赤伝(訂正)を起票します"
                            className="font-bold text-rose-800 hover:text-rose-900 hover:underline disabled:opacity-30 disabled:no-underline cursor-pointer disabled:cursor-not-allowed"
                          >
                            赤伝を起票
                          </button>
                        )}
                      <button
                        type="button"
                        onClick={() => onOpenEditForm(inv.id)}
                        disabled={!canUpdate}
                        className="font-bold text-indigo-600 hover:text-indigo-900 hover:underline disabled:opacity-30 disabled:no-underline cursor-pointer disabled:cursor-not-allowed"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteInvoice(inv.id)}
                        disabled={!canDelete}
                        className="font-bold text-red-500 hover:text-red-700 hover:underline disabled:opacity-30 disabled:no-underline cursor-pointer disabled:cursor-not-allowed"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={onSelectToggle ? 11 : 10}
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
