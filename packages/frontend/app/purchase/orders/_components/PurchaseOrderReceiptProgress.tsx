"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";

interface ReceiptProgressItem {
  orderItemId: string;
  itemId: string | null;
  itemName: string | null;
  inputType: string | null;
  quantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
}

interface PurchaseOrderReceiptProgressProps {
  orderId: string;
}

// Item9: 承認済み発注の入荷状況(明細ごとの入荷済/残数量)を表示し、残数量がある明細から
// 入荷指示の作成画面へ遷移する導線を提供する(sales/orders/_components/OrderShipmentProgress.tsx
// と対称)。発注には受注のような倉庫引当(reservation)が無いため、その内訳列は持たない。
// 実際の作成フォームは/inventory/receiving側の既存フォームをクエリパラメータ経由でprefillする
export function PurchaseOrderReceiptProgress({ orderId }: PurchaseOrderReceiptProgressProps) {
  const router = useRouter();
  const [items, setItems] = useState<ReceiptProgressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch<ReceiptProgressItem[]>(`/api/purchase-orders/${encodeURIComponent(orderId)}/receipt-progress`, {
      defaultErrorMessage: "入荷状況の取得に失敗しました",
    })
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "取得に失敗しました");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const hasRemaining = items.some((item) => item.remainingQuantity > 0);

  if (loading) {
    return <p className="text-xs text-slate-600">入荷状況を読み込み中...</p>;
  }

  if (error) {
    return (
      <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg">
        ⚠️ {error}
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-2 border-t border-slate-100">
      <h4 className="text-xs font-black text-slate-700">📦 入荷状況(発注→入荷指示/入庫の消込)</h4>

      <table className="w-full text-xs text-left">
        <thead className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
          <tr>
            <th className="p-2">品目</th>
            <th className="p-2 text-right">発注数量</th>
            <th className="p-2 text-right">入荷済</th>
            <th className="p-2 text-right">残数量</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-700">
          {items.map((item) => (
            <tr key={item.orderItemId}>
              <td className="p-2 font-semibold text-slate-800">{item.itemName || item.itemId || "-"}</td>
              <td className="p-2 text-right font-mono">{item.quantity}</td>
              <td className="p-2 text-right font-mono">{item.receivedQuantity}</td>
              <td
                className={`p-2 text-right font-mono font-bold ${
                  item.remainingQuantity > 0 ? "text-amber-700" : "text-slate-900"
                }`}
              >
                {item.remainingQuantity}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {hasRemaining && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => router.push(`/inventory/receiving?fromPurchaseOrderId=${encodeURIComponent(orderId)}`)}
            className="flex-1 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
          >
            📦 入荷指示を作成する
          </button>
        </div>
      )}
    </div>
  );
}
