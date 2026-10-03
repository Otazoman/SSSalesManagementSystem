import React, { useEffect, useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { ApiListResponse } from "../../../_shared/api/response-types";
import { SalesOrderItemProgress, SalesOrderSummary } from "../_types";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";

interface SalesOrderPickerModalProps {
  initialSalesOrderId?: string;
  onClose: () => void;
  onApply: (
    salesOrderId: string,
    selections: Array<{ progress: SalesOrderItemProgress; quantity: number }>,
    // 追加要望: 選択した受注のプロジェクトを売上計上へそのまま引き継ぐ
    projectId?: string | null,
  ) => void;
}

// Item8: 「受注から選択」ピッカー。purchase/requisitions/_components/SalesOrderPickerModal.tsxと
// 同じ2ステップ構成(受注を選ぶ→明細を選ぶ)。売上側は欠品ではなく、会社設定に応じた基準数量
// (受注数量/出荷済数量)からの残数量を明細ごとに表示する
export function SalesOrderPickerModal({
  initialSalesOrderId,
  onClose,
  onApply,
}: SalesOrderPickerModalProps) {
  const [step, setStep] = useState<"PICK_ORDER" | "PICK_ITEMS">("PICK_ORDER");
  const [orders, setOrders] = useState<SalesOrderSummary[]>([]);
  const [search, setSearch] = useState(initialSalesOrderId || "");
  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedSearch = useDebouncedValue(search);
  const [loading, setLoading] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderProgress, setOrderProgress] = useState<SalesOrderItemProgress[]>(
    [],
  );
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<SalesOrderSummary[] | ApiListResponse<SalesOrderSummary>>(
      `/api/sales-orders?status=APPROVED${debouncedSearch ? `&id=${encodeURIComponent(debouncedSearch)}&title=${encodeURIComponent(debouncedSearch)}` : ""}`,
    )
      .then((data) => {
        if (cancelled) return;
        setOrders(Array.isArray(data) ? data : data.data);
      })
      .catch((err) => {
        console.error("受注一覧の取得に失敗しました", err);
        if (!cancelled) setOrders([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  const handleSelectOrder = async (orderId: string) => {
    setError("");
    try {
      const progress = await apiFetch<SalesOrderItemProgress[]>(
        `/api/sales-invoices/order-progress/${orderId}`,
      );
      setOrderProgress(progress);
      setQuantities(
        Object.fromEntries(
          progress.map((p) => [p.salesOrderItemId, p.remainingQuantity]),
        ),
      );
      setSelectedOrderId(orderId);
      setStep("PICK_ITEMS");
      if (progress.length === 0) {
        setError("この受注には明細がありません");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "受注明細の残数量取得に失敗しました",
      );
    }
  };

  const handleConfirm = () => {
    if (!selectedOrderId) return;
    setError("");

    const selections = orderProgress
      .map((progress) => ({
        progress,
        quantity: quantities[progress.salesOrderItemId] || 0,
      }))
      .filter((s) => s.quantity > 0);

    if (selections.length === 0) {
      setError("数量が1以上の明細を少なくとも1件選択してください");
      return;
    }

    const overshoot = selections.find(
      (s) => s.quantity > s.progress.remainingQuantity,
    );
    if (overshoot) {
      setError(
        `[${overshoot.progress.itemName || overshoot.progress.itemId}] の数量が残数量(${overshoot.progress.remainingQuantity})を超えています`,
      );
      return;
    }

    const selectedOrderProject =
      orders.find((o) => o.id === selectedOrderId)?.projectId ?? null;
    onApply(selectedOrderId, selections, selectedOrderProject);
  };

  return (
    <Modal
      title={
        <>
          📦 受注から明細を選択
          {step === "PICK_ITEMS" && selectedOrderId
            ? ` (${selectedOrderId})`
            : ""}
        </>
      }
      size="3xl"
      onClose={onClose}
    >
      {error && (
        <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg shrink-0">
          ⚠️ {error}
        </div>
      )}

      {step === "PICK_ORDER" && (
        <div className="flex-1 overflow-y-auto space-y-3">
          <input
            type="text"
            placeholder="受注コードまたは件名で絞り込み検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none"
          />
          {loading ? (
            <p className="text-xs text-slate-600 text-center py-6">
              読み込み中...
            </p>
          ) : orders.length === 0 ? (
            <p className="text-xs text-slate-600 text-center py-6">
              承認済みの受注が見つかりません。
            </p>
          ) : (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
              {orders.map((order) => (
                <button
                  type="button"
                  key={order.id}
                  onClick={() => void handleSelectOrder(order.id)}
                  className="w-full text-left px-3 py-2.5 hover:bg-indigo-50/50 transition-colors flex justify-between items-center text-xs"
                >
                  <div>
                    <span className="font-mono font-bold text-indigo-600">
                      {order.id}
                    </span>
                    <span className="ml-2 font-semibold text-slate-700">
                      {order.title || "(件名なし)"}
                    </span>
                  </div>
                  <span className="font-mono font-bold text-slate-900">
                    ¥{order.totalAmount.toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === "PICK_ITEMS" && (
        <>
          <div className="flex-1 overflow-y-auto">
            <div className="flex justify-between items-center mb-2">
              <p className="text-[11px] text-slate-500">
                数量(初期値は残数量)を確認・調整してから反映してください。
              </p>
              <button
                type="button"
                onClick={() => setStep("PICK_ORDER")}
                className="text-[11px] font-bold text-slate-500 hover:text-slate-700 shrink-0 ml-2"
              >
                ← 受注を選び直す
              </button>
            </div>
            {orderProgress.length > 0 && (
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b font-bold text-slate-500 sticky top-0">
                  <tr>
                    <th className="p-2">品目</th>
                    <th className="p-2 text-right">
                      {orderProgress[0]?.basis === "SHIPPED"
                        ? "出荷済数量"
                        : "受注数量"}
                    </th>
                    <th className="p-2 text-right">既売上済数量</th>
                    <th className="p-2 text-right">残数量</th>
                    <th className="p-2 text-right w-28">計上数量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orderProgress.map((p) => (
                    <tr
                      key={p.salesOrderItemId}
                      className={p.remainingQuantity <= 0 ? "opacity-40" : ""}
                    >
                      <td className="p-2 font-semibold text-slate-800">
                        {p.itemName || p.itemId}
                      </td>
                      <td className="p-2 text-right font-mono text-slate-900">
                        {p.basisQuantity}
                      </td>
                      <td className="p-2 text-right font-mono text-slate-900">
                        {p.invoicedQuantity}
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-indigo-600">
                        {p.remainingQuantity}
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          min={0}
                          max={p.remainingQuantity}
                          disabled={p.remainingQuantity <= 0}
                          className="w-24 border border-slate-300 p-1.5 text-base sm:text-xs rounded bg-slate-50 text-slate-900 text-right font-mono disabled:bg-slate-100 disabled:text-slate-500"
                          value={quantities[p.salesOrderItemId] ?? 0}
                          onChange={(e) =>
                            setQuantities((prev) => ({
                              ...prev,
                              [p.salesOrderItemId]: Number(e.target.value),
                            }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
            >
              キャンセル
            </button>
            <Button
              onClick={handleConfirm}
              disabled={orderProgress.length === 0}
            >
              選択した明細を反映する
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
