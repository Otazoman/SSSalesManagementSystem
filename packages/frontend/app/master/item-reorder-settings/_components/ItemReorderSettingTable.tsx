"use client";

import { ItemReorderSettingRecord } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";

interface ItemReorderSettingTableProps {
  settings: ItemReorderSettingRecord[];
  editingData: ItemReorderSettingRecord | null;
  canUpdate: boolean;
  canDelete: boolean;
  onStartEdit: (s: ItemReorderSettingRecord) => void;
  onDelete: (s: ItemReorderSettingRecord) => void;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function ItemReorderSettingTable({
  settings,
  editingData,
  canUpdate,
  canDelete,
  onStartEdit,
  onDelete,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: ItemReorderSettingTableProps) {
  return (
    <DataTable
      columns={[
        { key: "itemName", label: "品目", sortable: true },
        { key: "warehouseName", label: "倉庫", sortable: true },
        { key: "reorderPoint", label: "発注点", align: "right", sortable: true },
        { key: "safetyStock", label: "安全在庫", align: "right", sortable: true },
        { key: "memo", label: "メモ", sortable: true },
        { key: "actions", label: "操作", align: "center" },
      ]}
      data={settings}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(s) => {
        const isCurrentEditing = editingData?.id === s.id;
        return (
          <tr
            key={s.id}
            className={`hover:bg-slate-50 transition-colors cursor-pointer ${
              isCurrentEditing ? "bg-indigo-50/40" : ""
            }`}
            onClick={() => canUpdate && onStartEdit(s)}
          >
            <td className="px-4 py-3 font-semibold text-slate-800">
              [{s.itemId}] {s.itemName}
            </td>
            <td className="px-4 py-3 text-slate-700">
              [{s.warehouseId}] {s.warehouseName}
            </td>
            <td className="px-4 py-3 text-right font-mono text-slate-700">{s.reorderPoint}</td>
            <td className="px-4 py-3 text-right font-mono text-slate-700">{s.safetyStock}</td>
            <td className="px-4 py-3 text-xs text-slate-500">{s.memo || "-"}</td>
            <td
              className="px-4 py-3 text-center space-x-3 whitespace-nowrap"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => onStartEdit(s)}
                disabled={!canUpdate}
                className={`font-bold ${
                  canUpdate ? "text-indigo-600 hover:underline cursor-pointer" : "text-slate-600 no-underline cursor-not-allowed"
                }`}
              >
                編集
              </button>
              <button
                type="button"
                onClick={() => void onDelete(s)}
                disabled={!canDelete}
                className={`font-bold ${
                  canDelete ? "text-red-600 hover:underline cursor-pointer" : "text-slate-600 no-underline cursor-not-allowed"
                }`}
              >
                削除
              </button>
            </td>
          </tr>
        );
      }}
    />
  );
}
