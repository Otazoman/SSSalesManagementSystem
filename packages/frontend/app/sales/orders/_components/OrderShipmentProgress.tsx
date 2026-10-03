"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { ShipmentProgressItem } from "../_types";

interface OrderShipmentProgressProps {
  orderId: string;
}

// Item7残課題6: 承認済み受注の出荷状況(明細ごとの出荷済/残数量・倉庫別引当内訳)を表示し、
// 残数量がある明細から出荷指示(外部倉庫向け)・出庫(自社倉庫)の作成画面へ遷移する導線を提供する。
// 実際の作成フォームは/inventory/shipping側の既存フォームをクエリパラメータ経由でprefillする
// (このコンポーネント自体は作成処理を持たない。画面構成再編フェーズ7により旧
// /inventory/instructions・/inventory/stockは廃止され、出荷指示・出庫とも/inventory/shippingに統合)
export function OrderShipmentProgress({ orderId }: OrderShipmentProgressProps) {
  const router = useRouter();
  const [items, setItems] = useState<ShipmentProgressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch<ShipmentProgressItem[]>(`/api/sales-orders/${encodeURIComponent(orderId)}/shipment-progress`, {
      defaultErrorMessage: "出荷状況の取得に失敗しました",
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

  // Item7残課題8: 出荷指示/出庫の業務フロー統一により、倉庫種別を問わず出荷指示を起点とする
  // (自社倉庫向けの出荷指示も作成できるようになったため、個別の出庫画面への導線は廃止した)
  const hasRemaining = items.some((item) => item.remainingQuantity > 0);

  if (loading) {
    return <p className="text-xs text-slate-600">出荷状況を読み込み中...</p>;
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
      <h4 className="text-xs font-black text-slate-700">🚚 出荷状況(受注→出荷指示/出庫の消込)</h4>

      <table className="w-full text-xs text-left">
        <thead className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
          <tr>
            <th className="p-2">品目</th>
            <th className="p-2 text-right">受注数量</th>
            <th className="p-2 text-right">出荷済</th>
            <th className="p-2 text-right">残数量</th>
            <th className="p-2">倉庫別引当内訳</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-700">
          {items.map((item) => (
            <tr key={item.salesOrderItemId}>
              <td className="p-2 font-semibold text-slate-800">{item.itemName || item.itemId || "-"}</td>
              <td className="p-2 text-right font-mono">{item.quantity}</td>
              <td className="p-2 text-right font-mono">{item.shippedQuantity}</td>
              <td
                className={`p-2 text-right font-mono font-bold ${
                  item.remainingQuantity > 0 ? "text-amber-700" : "text-slate-900"
                }`}
              >
                {item.remainingQuantity}
              </td>
              <td className="p-2 text-slate-600">
                {item.reservations.length === 0
                  ? "-"
                  : item.reservations
                      .map((r) => `${r.warehouseName}(${r.warehouseType === "EXTERNAL" ? "外部" : "自社"}) ${r.reservedQuantity}`)
                      .join(" / ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {hasRemaining && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => router.push(`/inventory/shipping?fromSalesOrderId=${encodeURIComponent(orderId)}`)}
            className="flex-1 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
          >
            🚚 出荷指示を作成する
          </button>
        </div>
      )}
    </div>
  );
}
