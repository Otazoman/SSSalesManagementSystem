import React, { useEffect, useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import {
  ReorderSuggestionCandidate,
  PurchaseRequisitionPrefillData,
} from "../_types";

interface ReorderSuggestionPickerModalProps {
  onClose: () => void;
  // SalesOrderPickerModal.tsx/PurchaseOrderPickerModal.tsxと同じ方針。この時点ではDBには
  // 一切書き込まない。フォームへ初期値を渡して確認・調整してもらい、実際の登録は通常の保存操作で行う
  onPrefill: (data: PurchaseRequisitionPrefillData) => void;
}

interface CandidateSelectionState {
  checked: boolean;
  quantity: number;
}

// Item9 Phase7: 起票トリガー①(欠品自動提案②、発注点/安全在庫方式)。
// 受注に紐付かない一般補充用の候補を`GET /api/item-reorder-settings/low-stock-candidates`から
// 取得し、選択した明細(数量編集可能)を購買申請フォームへプレフィルする単一ステップモーダル。
// 受注紐付け方式(SalesOrderPickerModal)と異なり候補が最初からフラットなため、対象選択ステップは無い
export function ReorderSuggestionPickerModal({
  onClose,
  onPrefill,
}: ReorderSuggestionPickerModalProps) {
  const [candidates, setCandidates] = useState<ReorderSuggestionCandidate[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [selections, setSelections] = useState<
    Record<string, CandidateSelectionState>
  >({});
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch<ReorderSuggestionCandidate[]>(
      "/api/item-reorder-settings/low-stock-candidates",
    )
      .then((data) => {
        if (cancelled) return;
        setCandidates(data);
        if (data.length === 0) {
          setError("現在、発注点を下回っている品目はありません");
        }
        const initialSelections: Record<string, CandidateSelectionState> = {};
        data.forEach((c) => {
          initialSelections[c.id] = {
            checked: true,
            quantity: c.suggestedQuantity,
          };
        });
        setSelections(initialSelections);
      })
      .catch((err) => {
        console.error("発注点/安全在庫の候補取得に失敗しました", err);
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "候補一覧の取得に失敗しました",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSelection = (id: string) => {
    setSelections((prev) => ({
      ...prev,
      [id]: { ...prev[id], checked: !prev[id].checked },
    }));
  };

  const updateSelectionQuantity = (id: string, quantity: number) => {
    setSelections((prev) => ({ ...prev, [id]: { ...prev[id], quantity } }));
  };

  const handleConfirm = () => {
    setError("");
    const selected = candidates.filter((c) => selections[c.id]?.checked);
    if (selected.length === 0) {
      setError("明細を1件以上選択してください");
      return;
    }

    const items = selected.map((c) => ({
      itemId: c.itemId,
      itemName: c.itemName,
      inputType: "MASTER" as const,
      quantity: selections[c.id]?.quantity ?? c.suggestedQuantity,
      estimatedUnitPrice: 0,
      unitCode: c.baseUnitCode,
      taxCategoryCode: c.taxCategoryCode,
      memo: null,
    }));

    onPrefill({
      title: `発注点補充(品目${selected.length}件)`,
      memo: "(発注点/安全在庫による自動提案)",
      items,
    });
    onClose();
  };

  return (
    <Modal
      title="📉 発注点/安全在庫から購買申請を作成"
      size="2xl"
      onClose={onClose}
    >
      {error && (
        <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg shrink-0">
          ⚠️ {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-3">
        <p className="text-[11px] text-slate-500">
          発注点を下回っている品目×倉庫の一覧です。選択した明細(数量は変更可能)を購買申請フォームへコピーします。まだ保存はされません。
        </p>
        {loading ? (
          <p className="text-xs text-slate-600 text-center py-6">
            読み込み中...
          </p>
        ) : candidates.length === 0 ? (
          <p className="text-xs text-slate-600 text-center py-6">
            発注点を下回っている品目はありません。
          </p>
        ) : (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b font-bold text-slate-500">
                <tr>
                  <th className="p-2 w-10 text-center">選択</th>
                  <th className="p-2">品目</th>
                  <th className="p-2 w-24">倉庫</th>
                  <th className="p-2 w-16 text-right">現在庫</th>
                  <th className="p-2 w-16 text-right">発注点</th>
                  <th className="p-2 w-28">提案数量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {candidates.map((c) => (
                  <tr
                    key={c.id}
                    className={selections[c.id]?.checked ? "" : "opacity-40"}
                  >
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={selections[c.id]?.checked ?? false}
                        onChange={() => toggleSelection(c.id)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="p-2 font-semibold text-slate-700">
                      {c.itemName || c.itemId}
                    </td>
                    <td className="p-2 text-slate-900">{c.warehouseName}</td>
                    <td className="p-2 text-right font-mono text-slate-900">
                      {c.currentStock}
                    </td>
                    <td className="p-2 text-right font-mono text-slate-900">
                      {c.reorderPoint}
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        disabled={!selections[c.id]?.checked}
                        value={
                          selections[c.id]?.quantity ?? c.suggestedQuantity
                        }
                        onChange={(e) =>
                          updateSelectionQuantity(c.id, Number(e.target.value))
                        }
                        className="w-full border border-slate-300 p-1 text-base sm:text-xs rounded bg-white text-slate-900 disabled:bg-slate-100"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 border border-slate-300 text-slate-600 font-bold text-xs rounded hover:bg-slate-50"
        >
          キャンセル
        </button>
        <Button
          size="sm"
          onClick={handleConfirm}
          disabled={candidates.length === 0}
        >
          購買申請フォームへ内容をコピー
        </Button>
      </div>
    </Modal>
  );
}
