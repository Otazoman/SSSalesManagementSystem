"use client";

import { PriceRecord, MasterItem, MasterPartner } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";

interface PriceTableProps {
  prices: PriceRecord[];
  items: MasterItem[];
  partners: MasterPartner[];
  editingId: string | null;
  canUpdate: boolean;
  canDelete: boolean;
  onEditSelect: (p: PriceRecord) => void;
  onDeletePrice: (id: string) => void;
  onSuspendPrice?: (p: PriceRecord) => void;
  isSubmitting?: boolean;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function PriceTable({
  prices,
  items,
  partners,
  editingId,
  canUpdate,
  canDelete,
  onEditSelect,
  onDeletePrice,
  onSuspendPrice,
  isSubmitting = false,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: PriceTableProps) {
  return (
    <DataTable
      columns={[
        { key: "itemId", label: "品目", sortable: true },
        { key: "priceType", label: "区分", sortable: true },
        { key: "partnerId", label: "適用取引先", sortable: true },
        { key: "minQuantity", label: "基準数量", sortable: true },
        { key: "unitPrice", label: "適用単価", sortable: true },
        { key: "status", label: "統制状態", align: "center", sortable: true },
        { key: "actions", label: "操作", align: "center" },
      ]}
      data={prices}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(p) => {
        const item = items.find((i) => i.id === p.itemId);
        const cust = partners.find((c) => c.id === p.partnerId);
        const isEditing = editingId === p.id;
        return (
          <tr
            key={p.id}
            className={`hover:bg-slate-50 transition-colors cursor-pointer ${
              isEditing ? "bg-indigo-50/40" : ""
            }`}
            onClick={() => onEditSelect(p)}
          >
            <td className="px-4 py-3 font-mono">
              <div className="font-bold whitespace-nowrap">{p.itemId}</div>
              <div className="text-[10px] text-slate-600 truncate max-w-[150px]">
                {item?.name || "(他ステータスの品目)"}
              </div>
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  p.priceType === "SALES"
                    ? "bg-blue-50 text-blue-700 border border-blue-100"
                    : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                }`}
              >
                {p.priceType === "SALES" ? "販売価格" : "仕入価格"}
              </span>
            </td>
            <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
              {p.partnerId ? cust?.name || p.partnerId : "🌐 標準単価設定"}
            </td>
            <td className="px-4 py-3 font-mono whitespace-nowrap">
              {p.minQuantity.toLocaleString()} {p.unitCode}〜
            </td>
            <td className="px-4 py-3 font-mono font-black text-indigo-600 whitespace-nowrap">
              ¥{p.unitPrice.toLocaleString()}
            </td>

            <td className="px-4 py-3 text-center whitespace-nowrap">
              {p.status === "temporary" && (
                <span className="px-2 py-0.5 inline-flex text-[10px] font-bold leading-5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                  仮登録/申請中
                </span>
              )}
              {p.status === "suspended" && (
                <span className="px-2 py-0.5 inline-flex text-[10px] font-bold leading-5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                  無効
                </span>
              )}
              {(p.status === "active" || !p.status) && (
                <span className="px-2 py-0.5 inline-flex text-[10px] font-bold leading-5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  有効
                </span>
              )}
            </td>

            <td
              className="px-4 py-3 text-center space-x-4 whitespace-nowrap"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => onEditSelect(p)}
                disabled={!canUpdate || isSubmitting}
                className={`font-bold ${
                  canUpdate && !isSubmitting
                    ? "text-indigo-600 hover:underline cursor-pointer"
                    : "text-slate-600 no-underline cursor-not-allowed"
                }`}
              >
                {isEditing ? "調整中" : "変更"}
              </button>
              {p.status !== "suspended" ? (
                onSuspendPrice && (
                  <button
                    type="button"
                    onClick={() => onSuspendPrice(p)}
                    disabled={!canDelete || isSubmitting}
                    className={`font-bold ${
                      canDelete && !isSubmitting
                        ? "text-amber-600 hover:underline cursor-pointer"
                        : "text-slate-600 no-underline cursor-not-allowed"
                    }`}
                  >
                    無効化
                  </button>
                )
              ) : (
                <button
                  onClick={() => onDeletePrice(p.id)}
                  disabled={!canDelete || isSubmitting}
                  className={`font-bold ${
                    canDelete && !isSubmitting
                      ? "text-red-500 hover:underline cursor-pointer"
                      : "text-slate-600 no-underline cursor-not-allowed"
                  }`}
                >
                  完全に削除 🗑️
                </button>
              )}
            </td>
          </tr>
        );
      }}
    />
  );
}
