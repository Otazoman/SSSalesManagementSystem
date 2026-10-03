import React from "react";
import { TableScroll } from "../../../_shared/ui/TableScroll";
import {
  PurchaseRecognitionRecord,
  PartnerMaster,
  UserOption,
} from "../_types";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getDocumentLifecycleStatus } from "../../../_shared/status/document-lifecycle-status";

interface PurchaseRecognitionTableProps {
  recognitions: PurchaseRecognitionRecord[];
  partners: PartnerMaster[];
  userMaster: UserOption[];
  onOpenEditForm: (id: string) => void;
  // 追加要望L-2-a: 元の仕入から赤伝を起票する(承認済みの通常仕入のみ)
  onIssueRedSlip?: (id: string) => void;
  canCreate?: boolean;
  onDeleteRecognition: (id: string) => void;
  onOpenPreview: (id: string) => void;
  canUpdate: boolean;
  canDelete: boolean;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string, additive?: boolean) => void;
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  PURCHASE: "通常仕入",
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

export function PurchaseRecognitionTable({
  recognitions,
  partners,
  userMaster,
  onOpenEditForm,
  onIssueRedSlip,
  canCreate,
  onDeleteRecognition,
  onOpenPreview,
  canUpdate,
  canDelete,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: PurchaseRecognitionTableProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
      <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center shrink-0">
        <span className="text-xs font-bold text-slate-700">
          📋 仕入データ一覧
        </span>
        <span className="text-xs font-semibold text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-full">
          該当 {recognitions.length} 件
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
              <SortableTh
                label="仕入コード"
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
                label="仕入先名"
                sortKey="partnerId"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-32"
              />
              <SortableTh
                label="自社担当者"
                sortKey="purchasePersonEmployeeNumber"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-32"
              />
              <SortableTh
                label="仕入日"
                sortKey="recognitionDate"
                sortBy={sortBy}
                sortDirection={sortDirection}
                sortKeys={sortKeys}
                onSortChange={onSortChange}
                className="w-28"
              />
              <th className="px-3 py-3 w-24 bg-slate-100 border-b border-slate-200 shadow-xs">
                支払状況
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
            {recognitions.length > 0 ? (
              recognitions.map((rec) => {
                const handlerUser = userMaster.find(
                  (u) => u.employeeNumber === rec.purchasePersonEmployeeNumber,
                );
                return (
                  <tr
                    key={rec.id}
                    onClick={() => onOpenEditForm(rec.id)}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <td className="px-3 py-3 font-mono font-bold text-indigo-600 whitespace-nowrap">
                      {rec.id}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          rec.documentType === "PURCHASE"
                            ? "bg-slate-100 text-slate-800"
                            : "bg-rose-100 text-rose-800 border border-rose-300"
                        }`}
                      >
                        {DOCUMENT_TYPE_LABELS[rec.documentType] ||
                          rec.documentType}
                      </span>
                      {rec.documentType !== "PURCHASE" &&
                        rec.originalRecognitionId && (
                          <div className="text-[10px] text-slate-700 mt-0.5">
                            元: {rec.originalRecognitionId}
                          </div>
                        )}
                    </td>
                    <td className="px-3 py-3 font-semibold font-mono text-slate-600 min-w-[8rem]">
                      {partners.find((p) => p.id === rec.partnerId)?.name ||
                        rec.partnerId}
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-700 whitespace-nowrap">
                      {handlerUser ? handlerUser.name : "未設定"}
                    </td>
                    <td className="px-3 py-3 font-mono font-medium text-slate-600 whitespace-nowrap">
                      {rec.recognitionDate
                        ? rec.recognitionDate.split("T")[0]
                        : ""}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="text-[10px] font-bold text-slate-500">
                        {rec.paymentStatus === "PAID" ? "支払済" : "未払"}
                      </span>
                    </td>
                    <td
                      className={`px-3 py-3 font-mono font-bold text-right whitespace-nowrap ${
                        rec.documentType === "PURCHASE"
                          ? "text-slate-900"
                          : "text-rose-800"
                      }`}
                    >
                      {rec.documentType === "PURCHASE" ? "" : "△"}¥
                      {(rec.totalAmount ?? 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-center whitespace-nowrap">
                      <StatusBadge
                        {...getDocumentLifecycleStatus(rec.status)}
                      />
                    </td>
                    <td
                      className="px-3 py-3 text-center whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenPreview(rec.id)}
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
                        rec.documentType === "PURCHASE" &&
                        rec.status === "APPROVED" && (
                          <button
                            type="button"
                            onClick={() => onIssueRedSlip(rec.id)}
                            disabled={!canCreate}
                            title="この仕入の内容で赤伝(訂正)を起票します"
                            className="font-bold text-rose-800 hover:text-rose-900 hover:underline disabled:opacity-30 disabled:no-underline cursor-pointer disabled:cursor-not-allowed"
                          >
                            赤伝を起票
                          </button>
                        )}
                      <button
                        type="button"
                        onClick={() => onOpenEditForm(rec.id)}
                        disabled={!canUpdate}
                        className="font-bold text-indigo-600 hover:text-indigo-900 hover:underline disabled:opacity-30 disabled:no-underline cursor-pointer disabled:cursor-not-allowed"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRecognition(rec.id)}
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
                  colSpan={10}
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
