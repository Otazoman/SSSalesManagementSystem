// app/products/_components/ProductTable.tsx
"use client";

import { useState } from "react";
import {
  ItemRecord,
  AccountLookup,
  SupplierLookup,
  TaxCategoryLookup,
} from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";
import { LabelPrintModal } from "../../../_shared/ui/LabelPrintModal";
import { resolveProductScanCode } from "../../../_shared/product-scan-code";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getMasterLifecycleStatus } from "../../../_shared/status";

interface ProductTableProps {
  items: ItemRecord[];
  accounts: AccountLookup[];
  suppliers: SupplierLookup[];
  taxCategories: TaxCategoryLookup[];
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (item: ItemRecord) => void;
  onSuspend: (item: ItemRecord) => void;
  onPurge: (id: string, name: string) => void;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function ProductTable({
  items,
  accounts,
  suppliers,
  taxCategories,
  canUpdate,
  canDelete,
  onEdit,
  onSuspend,
  onPurge,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: ProductTableProps) {
  const [labelTarget, setLabelTarget] = useState<ItemRecord | null>(null);

  return (
    <>
    <DataTable
      tableLayout="fixed"
      columns={[
        { key: "id", label: "品目コード", className: "w-28", sortable: true },
        { key: "name", label: "品目名 / 自動仕訳科目 / 仕入先", sortable: true },
        // 固定幅の列を詰めて、品目名の列に幅を残す(BUG-005: 1280px の画面で品目名が1文字ずつ折り返していた)
        { key: "tax", label: "特性", className: "w-44" },
        { key: "salesPrice", label: "標準販売単価", className: "w-28" },
        { key: "purchasePrice", label: "標準仕入単価", className: "w-28" },
        { key: "actions", label: "操作", align: "center", className: "w-56" },
      ]}
      data={items}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(i) => {
        const acc = accounts.find((a) => a.code === i.accountCode);
        const sup = suppliers.find((s) => s.id === i.supplierId);
        const tax = taxCategories.find((t) => t.code === i.taxCategoryCode);
        return (
          <tr
            key={i.id}
            className={`transition-colors cursor-pointer ${
              i.status === "suspended"
                ? "bg-slate-50/60 text-slate-500"
                : "hover:bg-slate-50"
            }`}
            onClick={() => onEdit(i)}
          >
            <td className="px-4 py-3 font-mono font-bold text-slate-900 whitespace-nowrap">
              {i.id}
            </td>
            <td className="px-4 py-3">
              <div className="font-semibold text-slate-900 flex items-center">
                <span>{i.name}</span>
                {i.status !== "active" && (
                  <StatusBadge {...getMasterLifecycleStatus(i.status)} className="ml-2 whitespace-nowrap" />
                )}
              </div>
              <div className="text-[10px] text-indigo-600 font-bold mt-0.5 flex flex-wrap gap-x-3">
                <span>
                  🗂️ {i.accountCode} {acc ? acc.name : "未設定"}
                </span>
                {(i.supplierId || i.supplierPartNumber) && (
                  <span className="text-emerald-600 font-medium">
                    🤝 仕入先: {sup ? sup.name : "不明"}{" "}
                    {i.supplierPartNumber
                      ? `[型番: ${i.supplierPartNumber}]`
                      : ""}
                  </span>
                )}
              </div>
            </td>
            <td className="px-4 py-3 whitespace-nowrap space-x-1">
              <span className="bg-slate-100 border border-slate-300 text-slate-800 text-[10px] font-bold px-2 py-0.5 rounded">
                {tax ? tax.name : i.taxCategoryCode}
              </span>
              {i.isSales && (
                <span className="bg-blue-50 text-blue-700 border px-1 rounded text-[9px] font-bold">
                  販
                </span>
              )}
              {i.isPurchased && (
                <span className="bg-emerald-50 text-emerald-700 border px-1 rounded text-[9px] font-bold">
                  購
                </span>
              )}
              {i.isService && (
                <span className="bg-purple-50 text-purple-700 border px-1 rounded text-[9px] font-bold">
                  役
                </span>
              )}
            </td>
            <td className="px-4 py-3 font-mono font-bold text-blue-700 whitespace-nowrap">
              ¥{(i.standardSalesPrice || 0).toLocaleString()} /{" "}
              {i.baseUnitCode}
            </td>
            <td className="px-4 py-3 font-mono font-bold text-emerald-700 whitespace-nowrap">
              ¥{(i.standardPurchasePrice || 0).toLocaleString()} /{" "}
              {i.baseUnitCode}
            </td>
            <td
              className="px-4 py-3 text-center space-x-4 whitespace-nowrap"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setLabelTarget(i)}
                className="text-slate-600 font-bold hover:underline cursor-pointer"
              >
                🏷️ QR/バーコード
              </button>
              <button
                onClick={() => onEdit(i)}
                disabled={!canUpdate}
                className="text-indigo-600 font-bold hover:underline cursor-pointer disabled:text-slate-500 disabled:opacity-60 disabled:no-underline disabled:cursor-not-allowed"
              >
                変更
              </button>
              {i.status !== "suspended" ? (
                <button
                  onClick={() => onSuspend(i)}
                  disabled={!canDelete}
                  className="text-amber-600 font-bold hover:underline cursor-pointer disabled:text-slate-500 disabled:opacity-60 disabled:no-underline disabled:cursor-not-allowed"
                >
                  無効化
                </button>
              ) : (
                <button
                  onClick={() => onPurge(i.id, i.name)}
                  disabled={!canDelete}
                  className="text-red-600 font-bold hover:underline cursor-pointer disabled:text-slate-500 disabled:opacity-60 disabled:no-underline disabled:cursor-not-allowed"
                >
                  完全に削除 🗑️
                </button>
              )}
            </td>
          </tr>
        );
      }}
    />
    {labelTarget && (
      <LabelPrintModal
        title={`品目: ${labelTarget.id} (${labelTarget.name})`}
        value={resolveProductScanCode(labelTarget)}
        onClose={() => setLabelTarget(null)}
      />
    )}
    </>
  );
}
