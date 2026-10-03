import React, { useEffect, useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { ApiListResponse } from "../../../_shared/api/response-types";
import { PurchaseOrderPrefillData } from "../_types";
// 購買申請側のSalesOrderPickerModal.tsxと同じ受注欠品データ構造を再利用する(型の重複定義を避ける)
import {
  SourceSalesOrderSummary,
  SourceSalesOrderItem,
} from "../../requisitions/_types";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";
import { todayJst } from "../../../_shared/jst-date";

interface SalesOrderShortagePickerModalProps {
  onClose: () => void;
  // purchase/requisitions/_components/SalesOrderPickerModal.tsxと同じ方針。
  // この時点ではDBには一切書き込まない。フォームへ初期値を渡して確認・調整してもらい、
  // 実際の登録は通常の保存操作で行う
  onPrefill: (data: PurchaseOrderPrefillData) => void;
}

interface BackorderItemSelectionState {
  checked: boolean;
  quantity: number;
}

// Item9設計確定: 承認機能が無効な場合、購買申請を経由せず受注の欠品(backorderedQuantity>0)明細から
// 直接発注を起票できるようにする2ステップモーダル。requisitions/_components/SalesOrderPickerModal.tsx
// (受注欠品→購買申請)と全く同じ設計・同じAPIを、発注(PurchaseOrderPrefillData)向けに移植したもの。
// 受注のpartnerId(得意先)は発注のpartnerId(仕入先)とは無関係の別人格のため、絶対に引き継がない
// (ユーザーがこの後、実際に発注する仕入先を選ぶ)
export function SalesOrderShortagePickerModal({
  onClose,
  onPrefill,
}: SalesOrderShortagePickerModalProps) {
  const [step, setStep] = useState<"PICK_ORDER" | "PICK_ITEMS">("PICK_ORDER");
  const [orders, setOrders] = useState<SourceSalesOrderSummary[]>([]);
  const [search, setSearch] = useState("");
  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedSearch = useDebouncedValue(search);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] =
    useState<SourceSalesOrderSummary | null>(null);
  const [backorderedItems, setBackorderedItems] = useState<
    SourceSalesOrderItem[]
  >([]);
  const [selections, setSelections] = useState<
    Record<string, BackorderItemSelectionState>
  >({});
  const [error, setError] = useState("");
  const [isAggregateMode, setIsAggregateMode] = useState(false);
  const [aggregateLoading, setAggregateLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<
      SourceSalesOrderSummary[] | ApiListResponse<SourceSalesOrderSummary>
    >(
      `/api/sales-orders?status=APPROVED&hasBackorder=true${debouncedSearch ? `&title=${encodeURIComponent(debouncedSearch)}` : ""}`,
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

  const handleSelectOrder = async (order: SourceSalesOrderSummary) => {
    setError("");
    setSelectedOrder(order);
    setIsAggregateMode(false);
    try {
      const detail = await apiFetch<{ items: SourceSalesOrderItem[] }>(
        `/api/sales-orders/${order.id}`,
      );
      const items = (detail.items || []).filter(
        (item) => (item.backorderedQuantity || 0) > 0,
      );
      setBackorderedItems(items);
      if (items.length === 0) {
        setError("この受注には欠品(引当不足)の明細がありません");
      }
      const initialSelections: Record<string, BackorderItemSelectionState> = {};
      items.forEach((item) => {
        initialSelections[item.id] = {
          checked: true,
          quantity: item.backorderedQuantity,
        };
      });
      setSelections(initialSelections);
      setStep("PICK_ITEMS");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "受注明細の取得に失敗しました",
      );
    }
  };

  const handleLoadAggregate = async () => {
    setError("");
    setAggregateLoading(true);
    try {
      const items = await apiFetch<SourceSalesOrderItem[]>(
        "/api/sales-orders/backordered-items",
      );
      setBackorderedItems(items);
      setSelectedOrder(null);
      setIsAggregateMode(true);
      if (items.length === 0) {
        setError("現在、欠品(引当不足)の明細はありません");
      }
      const initialSelections: Record<string, BackorderItemSelectionState> = {};
      items.forEach((item) => {
        initialSelections[item.id] = {
          checked: true,
          quantity: item.backorderedQuantity,
        };
      });
      setSelections(initialSelections);
      setStep("PICK_ITEMS");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "欠品明細一覧の取得に失敗しました",
      );
    } finally {
      setAggregateLoading(false);
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
    if (!isAggregateMode && !selectedOrder) return;
    setError("");

    const selectedItems = backorderedItems.filter(
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
      quantity: selections[item.id]?.quantity ?? item.backorderedQuantity,
      unitPrice: item.unitPrice,
      memo: item.memo ?? null,
      unitCode: item.unitCode ?? null,
      taxCategoryCode: item.taxCategoryCode ?? null,
      // Item9: purchaseRequestItemId経由では辿れないケース(承認OFF時、購買申請を経由せず
      // 発注が直接受注に紐付けて起票される場合)のためのトレーサビリティ
      salesOrderItemId: item.id,
    }));

    if (isAggregateMode) {
      const sourceOrderIds = Array.from(
        new Set(
          selectedItems
            .map((item) => item.salesOrderId)
            .filter((id): id is string => !!id),
        ),
      );
      onPrefill({
        title: `欠品調達(受注${sourceOrderIds.length}件)`,
        // 受注のpartnerId(得意先)は発注のpartnerId(仕入先)とは無関係のため引き継がない
        partnerId: null,
        requestId: null,
        orderDate: todayJst(),
        items,
      });
      onClose();
      return;
    }

    onPrefill({
      title: `${selectedOrder!.title || selectedOrder!.id}の欠品調達`,
      partnerId: null,
      requestId: null,
      orderDate: todayJst(),
      items,
    });
    onClose();
  };

  return (
    <Modal
      title={
        <>
          {step === "PICK_ITEMS" && isAggregateMode
            ? "🚨 全受注の欠品から発注を作成"
            : "🔗 受注の欠品から発注を作成"}{" "}
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
          <button
            type="button"
            onClick={() => void handleLoadAggregate()}
            disabled={aggregateLoading}
            className="w-full text-left px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors text-xs font-bold text-amber-800 disabled:opacity-50"
          >
            🚨{" "}
            {aggregateLoading
              ? "読み込み中..."
              : "受注を指定せず、欠品明細をすべてまとめて表示"}
          </button>
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
              欠品(引当不足)のある承認済み受注が見つかりません。
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
              欠品数量分の明細(数量は変更可能)を発注フォームへコピーします。まだ保存はされません。仕入先を選び、内容を確認・調整してから画面下部の保存操作で確定してください。
            </p>
            <button
              type="button"
              onClick={() => setStep("PICK_ORDER")}
              className="text-[11px] font-bold text-slate-500 hover:text-slate-700 shrink-0 ml-2"
            >
              {isAggregateMode ? "← 選び直す" : "← 受注を選び直す"}
            </button>
          </div>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b font-bold text-slate-500">
                <tr>
                  <th className="p-2 w-10 text-center">選択</th>
                  {isAggregateMode && <th className="p-2 w-32">受注</th>}
                  <th className="p-2">品目</th>
                  <th className="p-2 w-28">調達数量</th>
                  <th className="p-2 w-28 text-right">受注単価</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {backorderedItems.map((item) => (
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
                    {isAggregateMode && (
                      <td className="p-2 font-mono text-[11px] text-indigo-600">
                        {item.salesOrderId}
                        {item.salesOrderTitle ? (
                          <span className="block text-slate-700 font-sans">
                            {item.salesOrderTitle}
                          </span>
                        ) : null}
                      </td>
                    )}
                    <td className="p-2 font-semibold text-slate-700">
                      {item.itemName || item.itemId}
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        disabled={!selections[item.id]?.checked}
                        value={
                          selections[item.id]?.quantity ??
                          item.backorderedQuantity
                        }
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
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={backorderedItems.length === 0}
          >
            発注フォームへ内容をコピー
          </Button>
        </div>
      )}
    </Modal>
  );
}
