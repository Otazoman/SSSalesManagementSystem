import React, { useEffect, useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { ApiListResponse } from "../../../_shared/api/response-types";
import { PurchaseOrderPrefillData } from "../_types";
// 購買申請側のPurchaseOrderPickerModal.tsxと同じ過去発注データ構造を再利用する(型の重複定義を避ける)
import {
  SourcePurchaseOrderSummary,
  SourcePurchaseOrderItem,
} from "../../requisitions/_types";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";
import { todayJst } from "../../../_shared/jst-date";

interface PurchaseOrderReorderPickerModalProps {
  onClose: () => void;
  // requisitions/_components/PurchaseOrderPickerModal.tsxと同じ方針。この時点ではDBには
  // 一切書き込まない。フォームへ初期値を渡して確認・調整してもらい、実際の登録は通常の保存操作で行う
  onPrefill: (data: PurchaseOrderPrefillData) => void;
}

interface OrderItemSelectionState {
  checked: boolean;
  quantity: number;
}

// J-2-g: 承認機能が無効な場合、購買申請を経由せず過去の発注(納期遅延等)を選び直し、
// その明細を基に新規の発注下書きを直接作成できるようにする2ステップモーダル。
// requisitions/_components/PurchaseOrderPickerModal.tsx(発注→購買申請の再発注)と全く同じ設計を、
// 発注(PurchaseOrderPrefillData)向けに移植したもの
export function PurchaseOrderReorderPickerModal({
  onClose,
  onPrefill,
}: PurchaseOrderReorderPickerModalProps) {
  const [step, setStep] = useState<"PICK_ORDER" | "PICK_ITEMS">("PICK_ORDER");
  const [orders, setOrders] = useState<SourcePurchaseOrderSummary[]>([]);
  const [search, setSearch] = useState("");
  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedSearch = useDebouncedValue(search);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] =
    useState<SourcePurchaseOrderSummary | null>(null);
  const [orderItems, setOrderItems] = useState<SourcePurchaseOrderItem[]>([]);
  const [selections, setSelections] = useState<
    Record<string, OrderItemSelectionState>
  >({});
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<
      SourcePurchaseOrderSummary[] | ApiListResponse<SourcePurchaseOrderSummary>
    >(
      `/api/purchase-orders?status=APPROVED${debouncedSearch ? `&title=${encodeURIComponent(debouncedSearch)}` : ""}`,
    )
      .then((data) => {
        if (cancelled) return;
        setOrders(Array.isArray(data) ? data : data.data);
      })
      .catch((err) => {
        console.error("発注一覧の取得に失敗しました", err);
        if (!cancelled) setOrders([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  const handleSelectOrder = async (order: SourcePurchaseOrderSummary) => {
    setError("");
    setSelectedOrder(order);
    try {
      const detail = await apiFetch<{ items: SourcePurchaseOrderItem[] }>(
        `/api/purchase-orders/${order.id}`,
      );
      const items = detail.items || [];
      setOrderItems(items);
      const initialSelections: Record<string, OrderItemSelectionState> = {};
      items.forEach((item) => {
        initialSelections[item.id] = { checked: true, quantity: item.quantity };
      });
      setSelections(initialSelections);
      setStep("PICK_ITEMS");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "発注明細の取得に失敗しました",
      );
    }
  };

  const toggleSelection = (itemId: string) => {
    setSelections((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], checked: !prev[itemId].checked },
    }));
  };

  const updateSelectionQuantity = (itemId: string, quantity: number) => {
    setSelections((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], quantity },
    }));
  };

  const handleConfirm = () => {
    if (!selectedOrder) return;
    setError("");

    const selectedItems = orderItems.filter(
      (item) => selections[item.id]?.checked,
    );
    if (selectedItems.length === 0) {
      setError("明細を1件以上選択してください");
      return;
    }

    const items = selectedItems.map((item) => ({
      itemId: item.itemId || "",
      itemName: item.itemName || "",
      inputType: (item.inputType === "DIRECT" ? "DIRECT" : "MASTER") as
        "MASTER" | "DIRECT",
      quantity: selections[item.id]?.quantity ?? item.quantity,
      unitPrice: item.unitPrice,
      memo: item.memo ?? null,
      unitCode: item.unitCode ?? null,
      taxCategoryCode: item.taxCategoryCode ?? null,
    }));

    onPrefill({
      title: `${selectedOrder.title || selectedOrder.id}の再発注`,
      partnerId: selectedOrder.partnerId,
      requestId: null,
      orderDate: todayJst(),
      items,
      projectId: selectedOrder.projectId,
    });
    onClose();
  };

  return (
    <Modal
      title={
        <>
          🔁 過去の発注から再発注を作成{" "}
          {step === "PICK_ITEMS" && selectedOrder
            ? `(${selectedOrder.id})`
            : ""}
        </>
      }
      size="2xl"
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
            placeholder="件名で絞り込み検索..."
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
              承認済みの発注が見つかりません。
            </p>
          ) : (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
              {orders.map((order) => (
                <button
                  type="button"
                  key={order.id}
                  onClick={() => void handleSelectOrder(order)}
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
        <div className="flex-1 overflow-y-auto space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-[11px] text-slate-500">
              選択した明細(数量は変更可能)を発注フォームへコピーします。まだ保存はされません。内容を確認・調整してから画面下部の保存操作で確定してください。
            </p>
            <button
              type="button"
              onClick={() => setStep("PICK_ORDER")}
              className="text-[11px] font-bold text-slate-500 hover:text-slate-700 shrink-0 ml-2"
            >
              ← 発注を選び直す
            </button>
          </div>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b font-bold text-slate-500">
                <tr>
                  <th className="p-2 w-10 text-center">選択</th>
                  <th className="p-2">品目</th>
                  <th className="p-2 w-28">数量</th>
                  <th className="p-2 w-28 text-right">発注単価</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orderItems.map((item) => (
                  <tr
                    key={item.id}
                    className={selections[item.id]?.checked ? "" : "opacity-40"}
                  >
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={selections[item.id]?.checked ?? false}
                        onChange={() => toggleSelection(item.id)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="p-2 font-semibold text-slate-700">
                      {item.itemName || item.itemId}
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        disabled={!selections[item.id]?.checked}
                        value={selections[item.id]?.quantity ?? item.quantity}
                        onChange={(e) =>
                          updateSelectionQuantity(
                            item.id,
                            Number(e.target.value),
                          )
                        }
                        className="w-full border border-slate-300 p-1 text-base sm:text-xs rounded bg-white text-slate-900 disabled:bg-slate-100"
                      />
                    </td>
                    <td className="p-2 text-right font-mono text-slate-600">
                      ¥{item.unitPrice.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === "PICK_ITEMS" && (
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 border border-slate-300 text-slate-600 font-bold text-xs rounded hover:bg-slate-50"
          >
            キャンセル
          </button>
          <Button size="sm" onClick={handleConfirm}>
            発注フォームへ内容をコピー
          </Button>
        </div>
      )}
    </Modal>
  );
}
