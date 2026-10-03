"use client";

import { useEffect, useState } from "react";
import { Modal } from "../../../_shared/ui/Modal";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";

interface OrderReservationRow {
  salesOrderId: string;
  salesOrderTitle: string | null;
  partnerName: string | null;
  warehouseId: string;
  reservedQuantity: number;
}

interface StockReservationsModalProps {
  itemId: string;
  itemName?: string | null;
  onClose: () => void;
}

// Item7残課題2-5(#4): 在庫一覧から、品目を引き当てている受注をトレースする読み取り専用モーダル
export function StockReservationsModal({
  itemId,
  itemName,
  onClose,
}: StockReservationsModalProps) {
  const [rows, setRows] = useState<OrderReservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch<OrderReservationRow[]>(
      `/api/sales-orders/reservations/${encodeURIComponent(itemId)}`,
      {
        defaultErrorMessage: "引当中の受注の取得に失敗しました",
      },
    )
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "取得に失敗しました");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  return (
    <Modal
      title={<>🔒 引当中の受注 {itemName ? `(${itemName})` : `(${itemId})`}</>}
      size="xl"
      onClose={onClose}
    >
      {error && (
        <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg shrink-0">
          ⚠️ {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-xs text-slate-600 text-center py-6">
            読み込み中...
          </p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-slate-600 text-center py-6">
            この品目を引き当てている受注はありません。
          </p>
        ) : (
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600 sticky top-0">
              <tr>
                <th className="p-2">受注コード</th>
                <th className="p-2">得意先</th>
                <th className="p-2">倉庫</th>
                <th className="p-2 text-right">引当数量</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {rows.map((r, idx) => (
                <tr key={`${r.salesOrderId}-${r.warehouseId}-${idx}`}>
                  <td className="p-2 font-mono font-bold text-indigo-600">
                    {r.salesOrderId}
                  </td>
                  <td className="p-2 font-medium">{r.partnerName || "-"}</td>
                  <td className="p-2 font-mono">{r.warehouseId}</td>
                  <td className="p-2 text-right font-mono font-bold text-slate-900">
                    {r.reservedQuantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
