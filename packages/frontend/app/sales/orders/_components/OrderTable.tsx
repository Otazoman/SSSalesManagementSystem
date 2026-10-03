import React from "react";
import { TableScroll } from "../../../_shared/ui/TableScroll";
import { OrderRecord, PartnerMaster, UserOption } from "../_types";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getDocumentLifecycleStatus } from "../../../_shared/status/document-lifecycle-status";

interface OrderTableProps {
  orders: OrderRecord[];
  partners: PartnerMaster[];
  userMaster: UserOption[];
  selectedOrderIds: string[];
  onSelectToggle: (id: string) => void;
  onOpenEditForm: (id: string) => void;
  onDeleteOrder: (id: string) => void;
  onOpenPreview: (id: string) => void;
  canUpdate: boolean;
  canDelete: boolean;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  /** 追加要望J-1-a(複合ソート): 複数キー使用時の優先順位表示用(DataTable.tsxのsortKeysと同じ形) */
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string, additive?: boolean) => void;
}

// quotes/_components/QuoteTable.tsxの`SortableTh`と同じ方針(独自<table>実装のためDataTable.tsxには依存しない)
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

// Item7: quotes/_components/QuoteTable.tsxと同じ方針。見積の改定(Ver.UP)に相当する
// バージョン管理が受注には無いため、baseIdによるグルーピングは行わず1受注=1行で表示する
export function OrderTable({
  orders,
  partners,
  userMaster,
  selectedOrderIds,
  onSelectToggle,
  onOpenEditForm,
  onDeleteOrder,
  onOpenPreview,
  canUpdate,
  canDelete,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: OrderTableProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
      <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center shrink-0">
        <span className="text-xs font-bold text-slate-700">
          📋 受注データ一覧
        </span>
        <span className="text-xs font-semibold text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-full">
          該当 {orders.length} 件
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
              <th className="px-3 py-3 w-12 text-center bg-slate-100 border-b border-slate-200 shadow-xs">
                選択
              </th>
              <SortableTh
                label="受注コード"
                sortKey="id"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-40"
              />
              <SortableTh
                label="得意先名"
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
                label="入力担当者"
                sortKey="inputPersonEmployeeNumber"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-32"
              />
              <SortableTh
                label="受注日"
                sortKey="orderDate"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-32"
              />
              <SortableTh
                label="対象見積"
                sortKey="sourceQuoteId"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-24"
              />
              <th className="px-3 py-3 w-20 bg-slate-100 border-b border-slate-200 shadow-xs">
                添付
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
              <th className="px-3 py-3 w-36 text-center bg-slate-100 border-b border-slate-200 shadow-xs">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-700">
            {orders.length > 0 ? (
              orders.map((order) => {
                const handlerUser = userMaster.find(
                  (u) => u.employeeNumber === order.salesPersonEmployeeNumber,
                );
                const inputPersonUser = userMaster.find(
                  (u) => u.employeeNumber === order.inputPersonEmployeeNumber,
                );
                const isChecked = selectedOrderIds.includes(order.id);

                return (
                  <tr
                    key={order.id}
                    onClick={() => onOpenEditForm(order.id)}
                    className={`hover:bg-slate-50 transition-colors cursor-pointer ${
                      isChecked ? "bg-indigo-50/40" : ""
                    }`}
                  >
                    <td
                      className="px-3 py-3 text-center whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        disabled={order.status !== "APPROVED"}
                        checked={isChecked}
                        onChange={() => onSelectToggle(order.id)}
                        className="disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-3 font-mono font-bold text-indigo-600 whitespace-nowrap">
                      {order.id}
                    </td>
                    <td className="px-3 py-3 font-semibold font-mono text-slate-600 min-w-[8rem]">
                      {partners.find((p) => p.id === order.partnerId)?.name ||
                        order.partnerId}
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-700 whitespace-nowrap">
                      {handlerUser ? handlerUser.name : "未設定"}
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-700 whitespace-nowrap">
                      {inputPersonUser ? inputPersonUser.name : "未設定"}
                    </td>
                    <td className="px-3 py-3 text-slate-600 whitespace-nowrap font-mono font-medium">
                      {order.orderDate ? order.orderDate.split("T")[0] : ""}
                    </td>
                    <td className="px-3 py-3 text-slate-500 whitespace-nowrap font-mono text-[11px]">
                      {order.sourceQuoteId || "-"}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {order.attachments && order.attachments.length > 0 ? (
                        <span className="inline-flex items-center gap-1 font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded text-[11px] border border-indigo-100">
                          📎 あり
                        </span>
                      ) : (
                        <span className="text-slate-500 italic">なし</span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono font-bold text-slate-900 text-right whitespace-nowrap">
                      ¥{(order.totalAmount ?? 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-center whitespace-nowrap">
                      <StatusBadge
                        {...getDocumentLifecycleStatus(order.status)}
                      />
                    </td>
                    <td
                      className="px-3 py-3 text-center whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenPreview(order.id)}
                        className="font-bold text-indigo-600 hover:text-indigo-900 hover:underline cursor-pointer transition-colors text-xs"
                      >
                        確認
                      </button>
                    </td>
                    <td
                      className="px-3 py-3 text-center space-x-2.5 whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenEditForm(order.id)}
                        disabled={!canUpdate}
                        className="font-bold text-indigo-600 hover:text-indigo-900 hover:underline disabled:opacity-30 disabled:no-underline cursor-pointer disabled:cursor-not-allowed"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteOrder(order.id)}
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
                  colSpan={12}
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
