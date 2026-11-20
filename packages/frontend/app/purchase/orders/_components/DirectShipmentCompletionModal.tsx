"use client";

import { useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { todayJst } from "../../../_shared/jst-date";

export interface DirectShipmentCompletionLine {
  orderItemId: string;
  itemName: string;
  remainingQuantity: number;
}

interface DirectShipmentCompletionModalProps {
  orderId: string;
  salesOrderId: string;
  lines: DirectShipmentCompletionLine[];
  onClose: () => void;
  onCompleted: (message: string) => void;
}

// REQ-005 第2段階: 直送の発注の「直送完了」。仕入先から得意先へ納品された数量を入れると、直送用の倉庫への入庫と
// 得意先への出庫を同時に確定する(承認機能が有効なら、入出庫の承認を1回申請する)。数量の初期値は発注の残数量
export function DirectShipmentCompletionModal({
  orderId,
  salesOrderId,
  lines,
  onClose,
  onCompleted,
}: DirectShipmentCompletionModalProps) {
  const [completedDate, setCompletedDate] = useState(() => todayJst());
  const [memo, setMemo] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((line) => [line.orderItemId, line.remainingQuantity])),
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError("");
    const items = lines
      .map((line) => ({ orderItemId: line.orderItemId, quantity: quantities[line.orderItemId] || 0 }))
      .filter((item) => item.quantity > 0);
    if (items.length === 0) {
      setError("直送完了にする数量を1件以上入れてください");
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await apiFetch<{ message: string }>(
        `/api/purchase-orders/${encodeURIComponent(orderId)}/direct-shipment-completion`,
        {
          method: "POST",
          json: { completedDate, items, memo: memo.trim() || null },
          defaultErrorMessage: "直送完了に失敗しました",
        },
      );
      onCompleted(result.message);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "直送完了に失敗しました");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal title={`🚚 直送完了(発注 ${orderId} → 受注 ${salesOrderId})`} size="2xl" onClose={onClose}>
      {error && (
        <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg shrink-0">
          ⚠️ {error}
        </div>
      )}
      <div className="flex-1 overflow-y-auto space-y-3">
        <p className="text-[11px] text-slate-700">
          仕入先から得意先へ納品された数量を入れます。直送用の倉庫への入庫(発注の入荷済)と、得意先への出庫(受注の出荷済・納品書)を
          同時に記録します。在庫は増えません。承認機能を使う場合は、入出庫の承認を申請します。
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-xs font-bold text-slate-800">
            完了日(納品日)
            <input
              type="date"
              value={completedDate}
              onChange={(e) => setCompletedDate(e.target.value)}
              className="mt-1 w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-white text-slate-900"
            />
          </label>
          <label className="block text-xs font-bold text-slate-800">
            メモ
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="未入力なら「直送完了(発注→受注)」"
              className="mt-1 w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-white text-slate-900 placeholder-slate-500"
            />
          </label>
        </div>
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b font-bold text-slate-700">
              <tr>
                <th className="p-2">品目</th>
                <th className="p-2 w-24 text-right">残数量</th>
                <th className="p-2 w-28">納品数量</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {lines.map((line) => (
                <tr key={line.orderItemId}>
                  <td className="p-2 font-semibold">{line.itemName}</td>
                  <td className="p-2 text-right font-mono">{line.remainingQuantity}</td>
                  <td className="p-2">
                    <input
                      type="number"
                      min={0}
                      max={line.remainingQuantity}
                      aria-label={`${line.itemName}の納品数量`}
                      value={quantities[line.orderItemId] ?? 0}
                      onChange={(e) =>
                        setQuantities((prev) => ({ ...prev, [line.orderItemId]: Number(e.target.value) }))
                      }
                      className="w-full border border-slate-300 p-1 text-base sm:text-xs rounded bg-white text-slate-900"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 border border-slate-300 bg-white text-slate-800 font-bold text-xs rounded hover:bg-slate-50"
        >
          キャンセル
        </button>
        <Button size="sm" onClick={() => void handleSubmit()} disabled={isSubmitting}>
          {isSubmitting ? "処理を実行中..." : "直送完了にする"}
        </Button>
      </div>
    </Modal>
  );
}
