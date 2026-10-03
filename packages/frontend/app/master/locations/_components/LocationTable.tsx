"use client";

import { useState } from "react";
import { LocationRecord, WarehouseSimple } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";
import { LabelPrintModal } from "../../../_shared/ui/LabelPrintModal";

interface LocationTableProps {
  locations: LocationRecord[];
  warehouses: WarehouseSimple[];
  onSelect: (l: LocationRecord) => void;
  onDelete: (l: LocationRecord) => void;
  onSuspend?: (l: LocationRecord) => void;
  canUpdate: boolean;
  canDelete: boolean;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function LocationTable({
  locations,
  warehouses,
  onSelect,
  onDelete,
  onSuspend,
  canUpdate,
  canDelete,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: LocationTableProps) {
  const [qrTarget, setQrTarget] = useState<LocationRecord | null>(null);

  return (
    <>
    <DataTable
      columns={[
        { key: "warehouseId", label: "所属倉庫", sortable: true },
        { key: "id", label: "ロケーションコード", sortable: true },
        { key: "name", label: "ロケーション名", sortable: true },
        { key: "memo", label: "備考", sortable: true },
        { key: "actions", label: "操作", align: "center" },
      ]}
      data={locations}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(l) => {
        const wh = warehouses.find((w) => w.id === l.warehouseId);
        return (
          <tr
            key={l.id}
            className="hover:bg-slate-50 transition-colors cursor-pointer"
            onClick={() => onSelect(l)}
          >
            <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
              <span className="bg-slate-200 text-slate-800 text-[10px] px-1.5 py-0.5 rounded font-bold mr-1">
                {l.warehouseId}
              </span>
              {wh ? wh.name : "不明な倉庫"}
            </td>
            <td className="px-4 py-3 font-mono font-bold text-slate-900 whitespace-nowrap">
              {l.id}
            </td>
            <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
              {l.name}
              {l.status === "temporary" && (
                <span className="ml-2 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold border border-amber-200">
                  仮登録/申請中
                </span>
              )}
              {l.status === "suspended" && (
                <span className="ml-2 text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold border border-red-200">
                  無効
                </span>
              )}
            </td>
            <td className="px-4 py-3 text-slate-500 truncate max-w-[200px]">
              {l.memo || "-"}
            </td>
            <td
              className="px-4 py-3 text-center space-x-3 whitespace-nowrap"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setQrTarget(l)}
                className="text-slate-600 font-bold hover:underline cursor-pointer"
              >
                🏷️ QR/バーコード
              </button>

              {canUpdate ? (
                <button
                  onClick={() => onSelect(l)}
                  className="text-indigo-600 font-bold hover:underline cursor-pointer"
                >
                  変更
                </button>
              ) : (
                <span className="text-slate-600 font-bold cursor-not-allowed select-none">
                  変更
                </span>
              )}

              {l.status !== "suspended"
                ? onSuspend &&
                  (canDelete ? (
                    <button
                      onClick={() => onSuspend(l)}
                      className="text-amber-600 font-bold hover:underline cursor-pointer"
                    >
                      無効化
                    </button>
                  ) : (
                    <span className="text-slate-600 font-bold cursor-not-allowed select-none">
                      無効化
                    </span>
                  ))
                : (canDelete ? (
                    <button
                      onClick={() => onDelete(l)}
                      className="text-red-600 font-bold hover:underline cursor-pointer"
                    >
                      完全に削除 🗑️
                    </button>
                  ) : (
                    <span className="text-slate-600 font-bold cursor-not-allowed select-none">
                      完全に削除 🗑️
                    </span>
                  ))}
            </td>
          </tr>
        );
      }}
    />
    {qrTarget && (
      <LabelPrintModal
        title={`ロケーション: ${qrTarget.id} (${qrTarget.name})`}
        value={qrTarget.id}
        onClose={() => setQrTarget(null)}
      />
    )}
    </>
  );
}
