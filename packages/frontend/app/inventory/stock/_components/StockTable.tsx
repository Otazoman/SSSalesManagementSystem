"use client";

import { StockRecord } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";

interface StockTableProps {
  stocks: StockRecord[];
  loading?: boolean;
  // Item6 Phase6-3-2: 破損・不良品管理(品質区分変更)。未指定なら従来通りボタンを表示しない(後方互換)
  onReclassify?: (stock: StockRecord) => void;
  // Item6 Phase6-3-3: 廃棄決定・返品。未指定なら従来通りボタンを表示しない(後方互換)
  onDispose?: (stock: StockRecord) => void;
  onReturn?: (stock: StockRecord) => void;
  // Item7残課題2-5(#4): 品目を引き当てている受注のトレーサビリティ表示。未指定ならボタン非表示
  onViewReservations?: (stock: StockRecord) => void;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

const QUALITY_LABELS: Record<string, string> = {
  NORMAL: "🟢 良品",
  DAMAGED: "🔴 破損品",
  QUARANTINE: "🟡 検品待ち",
};

export function StockTable({
  stocks,
  loading = false,
  onReclassify,
  onDispose,
  onReturn,
  onViewReservations,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: StockTableProps) {
  const showActions = !!(onReclassify || onDispose || onReturn || onViewReservations);
  return (
    <DataTable
      columns={[
        { key: "warehouseId", label: "倉庫", sortable: true },
        { key: "locationId", label: "ロケーション", sortable: true },
        { key: "itemId", label: "品目", sortable: true },
        { key: "lotNumber", label: "ロット", sortable: true },
        { key: "qualityStatus", label: "品質区分", sortable: true },
        { key: "quantity", label: "数量", align: "right", sortable: true },
        { key: "updatedAt", label: "更新日時", sortable: true },
        ...(showActions ? [{ key: "actions", label: "" }] : []),
      ]}
      data={stocks}
      loading={loading}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(s) => (
        <tr key={s.id} className="hover:bg-slate-50 text-sm">
          <td className="px-4 py-2">{s.warehouseName || s.warehouseId}</td>
          <td className="px-4 py-2">
            <span className="font-semibold">{s.locationId}</span>
            {s.locationName && <span className="text-slate-500"> ({s.locationName})</span>}
          </td>
          <td className="px-4 py-2 font-semibold">
            <span>{s.itemId}</span>
            {s.itemName && <span className="text-slate-500 font-normal"> ({s.itemName})</span>}
          </td>
          <td className="px-4 py-2">{s.lotNumber}</td>
          <td className="px-4 py-2">{QUALITY_LABELS[s.qualityStatus] || s.qualityStatus}</td>
          <td className="px-4 py-2 text-right font-bold">{s.quantity}</td>
          <td className="px-4 py-2 text-slate-600">
            {new Date(s.updatedAt).toLocaleString("ja-JP")}
          </td>
          {showActions && (
            <td className="px-4 py-2 text-right space-x-1.5 whitespace-nowrap">
              {onReclassify && (
                <button
                  type="button"
                  onClick={() => onReclassify(s)}
                  className="text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-2.5 py-1 rounded font-bold cursor-pointer"
                >
                  🔴 品質区分変更
                </button>
              )}
              {onDispose && (
                <button
                  type="button"
                  onClick={() => onDispose(s)}
                  className="text-xs bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-300 px-2.5 py-1 rounded font-bold cursor-pointer"
                >
                  🗑️ 廃棄
                </button>
              )}
              {onReturn && (
                <button
                  type="button"
                  onClick={() => onReturn(s)}
                  className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 px-2.5 py-1 rounded font-bold cursor-pointer"
                >
                  ↩️ 返品
                </button>
              )}
              {onViewReservations && (
                <button
                  type="button"
                  onClick={() => onViewReservations(s)}
                  className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded font-bold cursor-pointer"
                >
                  🔒 引当確認
                </button>
              )}
            </td>
          )}
        </tr>
      )}
    />
  );
}
