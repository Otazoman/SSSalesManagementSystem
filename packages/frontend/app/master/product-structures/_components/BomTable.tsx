import { StructureRecord } from "../_types";
import { getPeriodStatus } from "../_hooks/useBomOperations";
import { DataTable } from "../../../_shared/ui/DataTable";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getMasterLifecycleStatus } from "../../../_shared/status/master-lifecycle-status";

interface BomTableProps {
  displayedStructures: StructureRecord[];
  canUpdate: boolean;
  canDelete: boolean;
  isSubmitting?: boolean;
  onSelectEdit: (s: StructureRecord) => void;
  onDeleteLink: (id: string) => void;
  onSuspend?: (s: StructureRecord) => void;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function BomTable({
  displayedStructures,
  canUpdate,
  canDelete,
  isSubmitting = false,
  onSelectEdit,
  onDeleteLink,
  onSuspend,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: BomTableProps) {
  return (
    <DataTable
      columns={[
        { key: "parentItemId", label: "親品目(品番アセンブリ)", sortable: true },
        { key: "childItemId", label: "構成子部品(パーツ)", sortable: true },
        { key: "revision", label: "リビジョン", align: "center", sortable: true },
        { key: "quantityRequired", label: "必要数量", align: "right", sortable: true },
        { key: "unitCost", label: "部品標準原価", align: "right" },
        { key: "subTotal", label: "構成積算原価", align: "right" },
        { key: "period", label: "適用期間 / 状態" },
        { key: "status", label: "統制状態", align: "center", sortable: true },
        { key: "actions", label: "操作", align: "center", className: "w-[140px]" },
      ]}
      data={displayedStructures}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(s) => {
        const fFrom = s.validFrom
          ? typeof s.validFrom === "number"
            ? new Date(s.validFrom).toLocaleDateString()
            : String(s.validFrom).split("T")[0]
          : "-";
        const fTo = s.validTo
          ? typeof s.validTo === "number"
            ? new Date(s.validTo).toLocaleDateString()
            : String(s.validTo).split("T")[0]
          : "無期限";
        const periodStatus = getPeriodStatus(s.validFrom, s.validTo);

        return (
          <tr
            key={s.id}
            className={`hover:bg-slate-50 transition-colors ${
              periodStatus.code === "expired"
                ? "bg-slate-50/60 text-slate-600"
                : ""
            } cursor-pointer`}
            onClick={() => onSelectEdit(s)}
          >
            <td className="px-4 py-3 font-mono">
              <div className="font-bold text-slate-900">
                {s.parentItemId}
              </div>
              <div className="text-[10px] text-slate-600 truncate max-w-[150px]">
                {s.parentItemName}
              </div>
            </td>
            <td className="px-4 py-3 font-mono">
              <div className="font-bold flex items-center space-x-1">
                <span
                  className={
                    periodStatus.code === "expired"
                      ? "line-through text-slate-600"
                      : "text-slate-800"
                  }
                >
                  {s.childItemId}
                </span>
                {s.childItemStatus === "temporary" && (
                  <span className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded border border-amber-200 font-sans font-bold">
                    仮登録
                  </span>
                )}
              </div>
              <div className="text-[10px] text-slate-500 truncate max-w-[150px]">
                {s.childItemName}
              </div>
            </td>
            <td className="px-4 py-3 text-center font-mono font-bold text-slate-600 whitespace-nowrap">
              <span className="bg-slate-100 border text-slate-700 px-1.5 py-0.5 rounded text-[10px]">
                REV {s.revision}
              </span>
            </td>
            <td className="px-4 py-3 text-right font-mono font-bold text-slate-700">
              {s.quantityRequired}
            </td>
            <td className="px-4 py-3 text-right font-mono text-slate-500">
              ¥{(s.childUnitPrice || 0).toLocaleString()}
            </td>
            <td className="px-4 py-3 text-right font-mono font-black text-indigo-600">
              ¥{(s.subTotalCost || 0).toLocaleString()}
            </td>
            <td className="px-4 py-3">
              <div className="flex items-center space-x-2">
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded border font-sans font-bold whitespace-nowrap ${periodStatus.className}`}
                >
                  {periodStatus.label}
                </span>
                <span className="font-medium text-[11px] whitespace-nowrap">
                  {fFrom} 〜 {fTo}
                </span>
              </div>
              {s.memo && (
                <div className="text-[10px] text-slate-600 mt-0.5 italic max-w-[160px] truncate">
                  💬 {s.memo}
                </div>
              )}
            </td>
            <td className="px-4 py-3 text-center whitespace-nowrap">
              <StatusBadge {...getMasterLifecycleStatus(s.status)} />
            </td>
            <td
              className="px-4 py-3 text-center space-x-3 whitespace-nowrap w-[140px]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => onSelectEdit(s)}
                disabled={!canUpdate || isSubmitting}
                className={`font-bold ${
                  canUpdate && !isSubmitting
                    ? "text-indigo-600 hover:underline cursor-pointer"
                    : "text-slate-600 no-underline cursor-not-allowed"
                }`}
              >
                変更
              </button>

              {s.status !== "suspended" ? (
                onSuspend && (
                  <button
                    onClick={() => onSuspend(s)}
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
                  onClick={() => onDeleteLink(s.id)}
                  disabled={!canDelete || isSubmitting}
                  className={`font-bold ${
                    canDelete && !isSubmitting
                      ? "text-red-600 hover:underline cursor-pointer"
                      : "text-slate-600 no-underline cursor-not-allowed"
                  }`}
                >
                  解除
                </button>
              )}
            </td>
          </tr>
        );
      }}
    />
  );
}
