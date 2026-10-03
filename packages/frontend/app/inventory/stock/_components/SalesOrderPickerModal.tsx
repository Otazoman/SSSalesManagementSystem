"use client";

import { useEffect, useState } from "react";
import { Modal } from "../../../_shared/ui/Modal";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { ApiListResponse } from "../../../_shared/api/response-types";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";

interface SalesOrderSummary {
  id: string;
  title: string | null;
  partnerId: string;
  totalAmount: number;
}

interface SalesOrderPickerModalProps {
  onClose: () => void;
  onSelect: (orderId: string) => void;
}

// Item7残課題6 Phase B: 出荷指示/出庫画面側から直接、受注を検索して選ぶための入口。
// QuotePickerModal.tsxと同系統だが、ここでは受注IDを選ぶだけの1ステップ構成
// (選択後の出荷対象の自動投入は、既存の?fromSalesOrderId=prefillロジックをそのまま使う)
export function SalesOrderPickerModal({
  onClose,
  onSelect,
}: SalesOrderPickerModalProps) {
  const [orders, setOrders] = useState<SalesOrderSummary[]>([]);
  const [search, setSearch] = useState("");
  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedSearch = useDebouncedValue(search);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const data = await apiFetch<
          SalesOrderSummary[] | ApiListResponse<SalesOrderSummary>
        >(
          `/api/sales-orders?status=APPROVED${debouncedSearch ? `&title=${encodeURIComponent(debouncedSearch)}` : ""}`,
        );
        if (!cancelled) setOrders(Array.isArray(data) ? data : data.data);
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "受注一覧の取得に失敗しました",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  return (
    <Modal title="📋 受注から選ぶ" size="2xl" onClose={onClose}>
      {error && (
        <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg shrink-0">
          ⚠️ {error}
        </div>
      )}

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
            承認済みの受注が見つかりません。
          </p>
        ) : (
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
            {orders.map((order) => (
              <button
                type="button"
                key={order.id}
                onClick={() => onSelect(order.id)}
                className="w-full text-left px-3 py-2.5 hover:bg-indigo-50/50 transition-colors flex justify-between items-center text-xs cursor-pointer"
              >
                <div>
                  <span className="font-mono font-bold text-indigo-600">
                    {order.id}
                  </span>
                  <span className="ml-2 font-semibold text-slate-700">
                    {order.title || "(件名なし)"}
                  </span>
                  <span className="ml-2 text-slate-500">{order.partnerId}</span>
                </div>
                <span className="font-mono font-bold text-slate-900">
                  ¥{order.totalAmount.toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
