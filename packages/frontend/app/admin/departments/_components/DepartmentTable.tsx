"use client";

import { DepartmentRecord, DepartmentTreeNode } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";

interface FlatDeptRow {
  node: DepartmentTreeNode;
  depth: number;
}

interface DepartmentTableProps {
  departments: DepartmentRecord[];
  targetDate: string;
  canUpdate: boolean;
  canDelete: boolean;
  isSubmitting?: boolean;
  onSelectRow: (node: DepartmentTreeNode) => void;
  onDeleteClick: (node: DepartmentTreeNode) => void;
  onRestoreClick: (node: DepartmentTreeNode) => void;
}

export default function DepartmentTable({
  departments,
  targetDate,
  canUpdate,
  canDelete,
  isSubmitting = false,
  onSelectRow,
  onDeleteClick,
  onRestoreClick,
}: DepartmentTableProps) {
  const buildDepartmentTree = (
    list: DepartmentRecord[],
  ): DepartmentTreeNode[] => {
    const map: Record<string, DepartmentTreeNode> = {};
    const roots: DepartmentTreeNode[] = [];

    list.forEach((item) => {
      const key = item.surrogateId || item.id;
      map[key] = { ...item, children: [] };
    });

    list.forEach((item) => {
      const currentKey = item.surrogateId || item.id;
      const node = map[currentKey];
      const parentKey = item.parentDepartmentSurrogateId;

      if (parentKey && parentKey !== currentKey && map[parentKey]) {
        map[parentKey].children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  };

  // ツリー構造を、depthを付与したフラット配列へ変換する（DataTableの`data: T[]`と噛み合わせるため）
  const flattenTree = (
    nodes: DepartmentTreeNode[],
    depth = 0,
    visited = new Set<string>(),
  ): FlatDeptRow[] => {
    let rows: FlatDeptRow[] = [];
    nodes.forEach((node) => {
      const nodeKey = node.surrogateId || node.id;
      if (visited.has(nodeKey)) return;
      visited.add(nodeKey);

      rows.push({ node, depth });
      if (node.children.length > 0) {
        rows = rows.concat(flattenTree(node.children, depth + 1, visited));
      }
    });
    return rows;
  };

  const flatRows = flattenTree(buildDepartmentTree(departments));
  const checkPivot = new Date(`${targetDate}T23:59:59.999Z`);
  const formatDate = (isoStr?: string | null) => {
    if (!isoStr) return "無期限";
    return new Date(isoStr).toLocaleDateString("ja-JP");
  };

  return (
    <DataTable
      columns={[
        { key: "id", label: "部署コードID" },
        { key: "name", label: "部署・組織名 (ツリー階層構造)" },
        { key: "parent", label: "親組織コード" },
        { key: "memo", label: "備考説明" },
        { key: "validRange", label: "マスタ有効期間" },
        { key: "actions", label: "操作", align: "center", className: "w-[140px]" },
      ]}
      data={flatRows}
      emptyMessage="該当するデータはありません"
      renderRow={({ node, depth }) => {
        const isExpired = node.validTo
          ? new Date(node.validTo) <= checkPivot
          : false;

        return (
          <tr
            key={node.surrogateId || `${node.id}-${node.validFrom}`}
            className={`hover:bg-slate-50 transition-colors ${
              isExpired ? "bg-slate-50/60 text-slate-600" : ""
            } cursor-pointer`}
            onClick={() => onSelectRow(node)}
          >
            <td className="px-4 py-3 font-mono font-bold text-slate-900">
              {node.id}
            </td>
            <td className="px-4 py-3 font-semibold text-slate-900">
              <span
                style={{ paddingLeft: `${depth * 20}px` }}
                className="font-mono text-slate-600"
              >
                {depth > 0 ? "└── " : ""}
              </span>
              <span className={isExpired ? "text-slate-600 line-through" : ""}>
                {node.name}
              </span>
              {isExpired && (
                <span className="ml-2 text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded font-bold">
                  無効(期限切)
                </span>
              )}
            </td>
            <td className="px-4 py-3 font-mono text-slate-500">
              {node.parentDepartmentId || "ROOT (最上位)"}
            </td>
            <td className="px-4 py-3 text-slate-500 max-w-xs truncate">
              {node.memo || "—"}
            </td>
            <td className="px-4 py-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
              {formatDate(node.validFrom)} ～ {formatDate(node.validTo)}
            </td>
            <td
              className="px-4 py-3 text-center space-x-3 whitespace-nowrap w-[140px]"
              onClick={(e) => e.stopPropagation()}
            >
              {!isExpired ? (
                <>
                  <button
                    onClick={() => onSelectRow(node)}
                    disabled={!canUpdate || isSubmitting}
                    className={`font-bold ${
                      canUpdate && !isSubmitting
                        ? "text-indigo-600 hover:underline cursor-pointer"
                        : "text-slate-600 no-underline cursor-not-allowed"
                    }`}
                  >
                    変更
                  </button>

                  <button
                    onClick={() => onDeleteClick(node)}
                    disabled={!canDelete || isSubmitting}
                    className={`font-bold ${
                      canDelete && !isSubmitting
                        ? "text-amber-600 hover:underline cursor-pointer"
                        : "text-slate-600 no-underline cursor-not-allowed"
                    }`}
                  >
                    無効化
                  </button>
                </>
              ) : (
                <button
                  onClick={() => onRestoreClick(node)}
                  disabled={!canUpdate || isSubmitting}
                  className={`font-bold ${
                    canUpdate && !isSubmitting
                      ? "text-emerald-600 hover:underline cursor-pointer text-xs"
                      : "text-slate-600 no-underline cursor-not-allowed text-xs"
                  }`}
                >
                  復元
                </button>
              )}
            </td>
          </tr>
        );
      }}
    />
  );
}
