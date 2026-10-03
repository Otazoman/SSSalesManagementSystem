import React, { useMemo } from "react";
import { BomParentLookup, BomTreeNode, StructureRecord } from "../_types";
import { getPeriodStatus } from "../_hooks/useBomOperations";

interface BomTreeViewerProps {
  treeTargetParentId: string;
  setTreeTargetParentId: (val: string) => void;
  treeTargetRevision: string;
  setTreeTargetRevision: (val: string) => void;
  bomParents: BomParentLookup[];
  structures: StructureRecord[]; // 対象商品に紐づくリビジョン抽出用
  bomTree: BomTreeNode[]; // 孫部品以下も含めた多階層ツリー
  totalTreeBomCost: number;
}

// ツリーの1ノード(子部品)を描画し、children(孫部品以下)を再帰的に自分自身で描画する
function BomTreeNodeRow({ node }: { node: BomTreeNode }) {
  const tStatus = getPeriodStatus(node.validFrom, node.validTo);
  const hasChildren = node.children.length > 0;

  return (
    <div style={{ marginLeft: node.depth * 20 }}>
      <div
        className={`p-2 bg-white rounded border border-slate-200 flex justify-between items-center transition-colors hover:bg-slate-50 ${
          tStatus.code === "expired" ? "opacity-50 bg-slate-100" : ""
        }`}
      >
        <div className="flex items-center space-x-2">
          <span className="text-slate-600">└──</span>
          <span>{hasChildren ? "📦" : "📄"}</span>
          <strong className="text-slate-900 font-mono">
            {node.childItemId}
          </strong>
          <span className="text-slate-600 font-sans font-medium">
            {node.childItemName}
          </span>
          {tStatus.code === "expired" && (
            <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded border border-red-200 font-sans font-bold">
              旧構成
            </span>
          )}
        </div>

        <div className="flex items-center space-x-4 text-[11px]">
          <span>
            員数:{" "}
            <strong className="text-slate-900">{node.quantityRequired}</strong>
          </span>
          {node.depth > 0 && (
            <span
              className="text-slate-600"
              title="最上位品番1個あたりの累計必要数"
            >
              (累計 {node.effectiveQuantity})
            </span>
          )}
          <span>
            単価:{" "}
            <span className="text-slate-600">
              ¥{(node.childUnitPrice || 0).toLocaleString()}
            </span>
          </span>
          <span className="bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 font-bold text-indigo-700">
            積算: ¥{(node.effectiveSubTotal || 0).toLocaleString()}
          </span>
        </div>
      </div>

      {hasChildren && (
        <div className="space-y-1.5 mt-1.5">
          {node.children.map((child) => (
            <BomTreeNodeRow key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

export function BomTreeViewer({
  treeTargetParentId,
  setTreeTargetParentId,
  treeTargetRevision,
  setTreeTargetRevision,
  bomParents,
  structures,
  bomTree,
  totalTreeBomCost,
}: BomTreeViewerProps) {
  // 💡 対象商品（親品番）に存在する全リビジョン（REV）リストを動的抽出
  const availableRevisions = useMemo(() => {
    if (!treeTargetParentId) return [];
    const revs = structures
      .filter((s) => s.parentItemId === treeTargetParentId)
      .map((s) => s.revision);
    return Array.from(new Set(revs)).sort();
  }, [structures, treeTargetParentId]);

  const selectedParent = bomParents.find((p) => p.id === treeTargetParentId);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b pb-2 border-slate-100 gap-2">
        <div className="flex items-center space-x-2">
          <span className="text-sm">🌴</span>
          <h3 className="text-xs font-bold text-slate-700">
            品目構成ツリー＆積算原価ロールアップ
          </h3>
        </div>

        <div className="flex items-center space-x-2">
          <select
            className="border border-slate-300 p-1.5 text-base sm:text-xs bg-slate-50 text-slate-900 rounded focus:bg-white focus:border-indigo-600 focus:outline-none font-bold cursor-pointer"
            value={treeTargetParentId}
            onChange={(e) => {
              const selectedId = e.target.value;
              setTreeTargetParentId(selectedId);

              // 💡 選択された親品番の最新（数値最大）リビジョンを自動セット
              const parentRevs = structures
                .filter((s) => s.parentItemId === selectedId)
                .map((s) => s.revision);

              if (parentRevs.length > 0) {
                const latestRev = parentRevs.sort((a, b) =>
                  b.localeCompare(a, undefined, {
                    numeric: true,
                    sensitivity: "base",
                  }),
                )[0];
                setTreeTargetRevision(latestRev);
              }
            }}
          >
            <option value="">-- 対象品目(親品番)を選択 --</option>
            {bomParents.map((it) => (
              <option key={it.id} value={it.id}>
                {it.id}: {it.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {treeTargetParentId ? (
        <div className="space-y-3">
          {/* 💡 対象品目内のリビジョン選択タブ/バッジエリア */}
          <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              <span className="text-xs font-bold text-slate-700">
                📦 {selectedParent ? selectedParent.name : treeTargetParentId}{" "}
                のリビジョン履歴:
              </span>
              {availableRevisions.length > 0 ? (
                availableRevisions.map((rev) => (
                  <button
                    key={rev}
                    type="button"
                    onClick={() => setTreeTargetRevision(rev)}
                    className={`px-2 py-0.5 text-xs font-mono font-bold rounded cursor-pointer transition-colors border ${
                      treeTargetRevision === rev
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    REV {rev}
                  </button>
                ))
              ) : (
                <span className="text-xs text-slate-600 italic">
                  登録済みリビジョンなし
                </span>
              )}
            </div>

            <div className="text-right">
              <span className="text-[10px] text-slate-500 font-bold block">
                【REV {treeTargetRevision}】 積算合計原価
              </span>
              <span className="text-base font-black text-indigo-600 font-mono">
                ¥{totalTreeBomCost.toLocaleString()}
              </span>
            </div>
          </div>

          {/* ツリー構成要素リスト(孫部品以下も再帰的に表示) */}
          <div className="bg-slate-50/50 p-3 rounded-lg border border-slate-200 space-y-1.5 font-mono text-xs max-h-[300px] overflow-y-auto">
            {bomTree.length > 0 ? (
              bomTree.map((node) => (
                <BomTreeNodeRow key={node.id} node={node} />
              ))
            ) : (
              <div className="text-center py-4 text-slate-600 italic text-xs">
                REV {treeTargetRevision}{" "}
                に該当するパーツ構成データが存在しません。
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center py-6 text-slate-600 italic text-xs bg-slate-50 rounded-lg border border-dashed border-slate-200">
          対象品目を選択すると、登録されているリビジョン一覧と構成ツリー、および積算原価がリアルタイムに自動計算されます。
        </div>
      )}
    </div>
  );
}
