import React from "react";
import { TableScroll } from "../../../_shared/ui/TableScroll";
import { QuoteRecord, PartnerMaster, UserOption } from "../_types";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getDocumentLifecycleStatus } from "../../../_shared/status/document-lifecycle-status";

interface QuoteTableProps {
  quotes: QuoteRecord[];
  partners: PartnerMaster[];
  userMaster: UserOption[];
  selectedQuoteIds: string[];
  onSelectToggle: (id: string) => void;
  onOpenEditForm: (id: string) => void;
  onDeleteQuote: (id: string) => void;
  onOpenPreview: (id: string) => void;
  canUpdate: boolean;
  canDelete: boolean;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  /** 追加要望J-1-a(複合ソート): 複数キー使用時の優先順位表示用(DataTable.tsxのsortKeysと同じ形) */
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string, additive?: boolean) => void;
}

// DataTable.tsxと同じ見た目(▲/▼表示・クリック可能・Shift+クリックで複合ソート追加)を、
// 独自<table>実装のこの画面でも再現するための小さなヘルパー。このコンポーネント専用でDataTable.tsx側には依存しない
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

export function QuoteTable({
  quotes,
  partners,
  userMaster,
  selectedQuoteIds,
  onSelectToggle,
  onOpenEditForm,
  onDeleteQuote,
  onOpenPreview,
  canUpdate,
  canDelete,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: QuoteTableProps) {
  const groups: { [baseId: string]: QuoteRecord[] } = {};
  quotes.forEach((q) => {
    const lastHyphenIndex = q.id.lastIndexOf("-");
    const baseId =
      lastHyphenIndex !== -1 ? q.id.substring(0, lastHyphenIndex) : q.id;
    if (!groups[baseId]) groups[baseId] = [];
    groups[baseId].push(q);
  });

  const totalGroupsCount = Object.keys(groups).length;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
      {/* 上部固定のヘッダーバー */}
      <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center shrink-0">
        <span className="text-xs font-bold text-slate-700">
          📋 見積データ一覧
        </span>
        {/* BUG-019: 同じ見積の版(枝番)は1行にまとめるため、行の数(見積の数)と版を含めた数が違う場合は両方を出す */}
        <span className="text-xs font-semibold text-slate-700 bg-slate-200/60 px-2 py-0.5 rounded-full">
          該当 {totalGroupsCount} 件
          {quotes.length !== totalGroupsCount && `(版を含めて ${quotes.length} 件)`}
        </span>
      </div>
      {/* K-1(2026-09-14): Shift+クリックでの複合ソートの常時表示ヒント(DataTable.tsxと同じ) */}
      {onSortChange && (
        <div className="px-3 py-1 text-[10px] text-slate-600 border-b border-slate-100 bg-slate-50 shrink-0">
          💡 列見出しクリックでソート /
          Shift+クリックで複数列を優先順位付きソート
        </div>
      )}

      {/* 縦横スクロールを管理するコンテナ */}
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
                label="見積コード"
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
                label="見積日 / 有効期限"
                sortKey="quoteDate"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-40"
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
            {totalGroupsCount > 0 ? (
              Object.keys(groups).map((baseId) => {
                const groupItems = groups[baseId].sort((a, b) =>
                  b.id.localeCompare(a.id),
                );
                const mainQuote = groupItems[0];
                const handlerUser = userMaster.find(
                  (u) =>
                    u.employeeNumber === mainQuote.salesPersonEmployeeNumber,
                );
                const inputPersonUser = userMaster.find(
                  (u) =>
                    u.employeeNumber === mainQuote.inputPersonEmployeeNumber,
                );
                const isChecked = selectedQuoteIds.includes(mainQuote.id);

                return (
                  <tr
                    key={mainQuote.id}
                    onClick={() => onOpenEditForm(mainQuote.id)}
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
                        disabled={mainQuote.status !== "APPROVED"}
                        checked={isChecked}
                        onChange={() => onSelectToggle(mainQuote.id)}
                        className="disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-3 font-mono font-bold text-indigo-600 whitespace-nowrap">
                      <div
                        className="flex flex-col gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-slate-900 text-xs font-semibold">
                          {baseId}
                        </span>
                        <select
                          value={mainQuote.id}
                          onChange={(e) =>
                            e.target.value && onOpenEditForm(e.target.value)
                          }
                          className="mt-0.5 block w-full text-[11px] rounded border border-slate-300 py-0.5 pl-1.5 text-indigo-600 bg-indigo-50/50 font-sans focus:outline-none cursor-pointer"
                        >
                          {groupItems.map((q) => {
                            const parts = q.id.split("-");
                            const revNum = parts[parts.length - 1];
                            return (
                              <option key={q.id} value={q.id}>
                                枝番: {revNum} (Ver.{revNum})
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-semibold font-mono text-slate-600 min-w-[8rem]">
                      {partners.find((c) => c.id === mainQuote.customerId)
                        ?.name || mainQuote.customerId}
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-700 whitespace-nowrap">
                      {handlerUser ? handlerUser.name : "未設定"}
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-700 whitespace-nowrap">
                      {inputPersonUser ? inputPersonUser.name : "未設定"}
                    </td>
                    <td className="px-3 py-3 text-slate-600 whitespace-nowrap">
                      <div className="font-mono font-medium">
                        {mainQuote.quoteDate
                          ? mainQuote.quoteDate.split("T")[0]
                          : ""}
                      </div>
                      <div className="text-[10px] text-slate-600 font-mono mt-0.5">
                        至:{" "}
                        {mainQuote.validUntil
                          ? mainQuote.validUntil.split("T")[0]
                          : "未設定"}
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {mainQuote.attachments &&
                      mainQuote.attachments.length > 0 ? (
                        <span className="inline-flex items-center gap-1 font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded text-[11px] border border-indigo-100">
                          📎 あり
                        </span>
                      ) : (
                        <span className="text-slate-500 italic">なし</span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono font-bold text-slate-900 text-right whitespace-nowrap">
                      ¥{(mainQuote.totalAmount ?? 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-center whitespace-nowrap">
                      <StatusBadge
                        {...getDocumentLifecycleStatus(mainQuote.status)}
                      />
                    </td>
                    <td
                      className="px-3 py-3 text-center whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenPreview(mainQuote.id)}
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
                        onClick={() => onOpenEditForm(mainQuote.id)}
                        disabled={!canUpdate}
                        className="font-bold text-indigo-600 hover:text-indigo-900 hover:underline disabled:opacity-30 disabled:no-underline cursor-pointer disabled:cursor-not-allowed"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteQuote(mainQuote.id)}
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
                  colSpan={11}
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
