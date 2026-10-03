"use client";

import { useEffect, useState } from "react";
import { Modal } from "../../../_shared/ui/Modal";
import { DiscardCancelButton } from "../../../_shared/ui/DiscardGuard";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { BulkPlanOrderResult } from "../_types";

interface BulkShipmentPlanModalProps {
  orderIds: string[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const MANUAL_REASON_LABELS: Record<string, string> = {
  NO_LOCATION_CANDIDATE: "在庫候補なし",
  AMBIGUOUS_LOCATION: "候補ロケーションが複数(自動判定不可)",
  INSUFFICIENT_STOCK: "十分な数量の在庫がある候補なし",
};

// 受注一覧の複数選択から出荷指示(外部倉庫向け)・出庫(自社倉庫)をまとめて作成するための
// 確認モーダル。開いた時点でプレビュー計算(POST /bulk-shipment-plan、DB書き込みなし)を取得し、
// 内容を確認したうえで「この内容で作成する」を押すと確定実行(POST /bulk-shipment-execute)する。
// DisposalModal.tsxと同じ中央オーバーレイ構造を踏襲した自己完結コンポーネント
export function BulkShipmentPlanModal({
  orderIds,
  onClose,
  onSuccess,
}: BulkShipmentPlanModalProps) {
  const router = useRouter();
  const [plan, setPlan] = useState<BulkPlanOrderResult[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ results: BulkPlanOrderResult[] }>(
      "/api/sales-orders/bulk-shipment-plan",
      {
        method: "POST",
        json: { orderIds },
        defaultErrorMessage: "出荷プランの計算に失敗しました",
      },
    )
      .then((data) => {
        if (!cancelled) setPlan(data.results);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalInstructions = plan?.filter((p) => p.instruction).length || 0;
  const totalShipments = plan?.filter((p) => p.shipment).length || 0;
  const totalManual =
    plan?.reduce((sum, p) => sum + p.manualItems.length, 0) || 0;
  const hasAnyCreatable = totalInstructions > 0 || totalShipments > 0;

  const submit = async () => {
    setExecuting(true);
    setError("");
    try {
      const data = await apiFetch<{ message: string }>(
        "/api/sales-orders/bulk-shipment-execute",
        {
          method: "POST",
          json: { orderIds },
          defaultErrorMessage: "出荷指示/出庫の一括作成に失敗しました",
        },
      );
      onSuccess(data.message);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "一括作成に失敗しました");
    } finally {
      setExecuting(false);
    }
  };

  return (
    <Modal
      warnOnDiscard
      title={
        <>🚚📦 出荷指示/出庫の一括作成プレビュー({orderIds.length}件の受注)</>
      }
      size="3xl"
      onClose={onClose}
    >
      {loading && <p className="text-xs text-slate-600">プランを計算中...</p>}
      {error && (
        <p className="text-sm text-red-600 font-bold bg-red-50 border border-red-200 rounded-lg p-2">
          {error}
        </p>
      )}

      {plan && !loading && (
        <>
          <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3">
            作成予定: 出荷指示 {totalInstructions}件 / 出庫 {totalShipments}件
            {totalManual > 0 && (
              <span className="text-amber-700 font-bold">
                {" "}
                ／ 要手動対応 {totalManual}明細
              </span>
            )}
          </div>

          <div className="space-y-3">
            {plan.map((orderPlan) => (
              <div
                key={orderPlan.orderId}
                className="border border-slate-200 rounded-lg p-3 space-y-2"
              >
                <p className="text-xs font-bold text-slate-800">
                  受注: {orderPlan.orderId}
                </p>
                {orderPlan.error && (
                  <p className="text-xs text-red-600">⚠️ {orderPlan.error}</p>
                )}
                {orderPlan.skipped && !orderPlan.error && (
                  <p className="text-xs text-slate-600">
                    対象明細なし(スキップ)
                  </p>
                )}

                {orderPlan.instruction && (
                  <div className="text-xs bg-sky-50 border border-sky-200 rounded p-2">
                    <p className="font-bold text-sky-800">
                      出荷指示を作成 → {orderPlan.instruction.warehouseName}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-slate-700">
                      {orderPlan.instruction.items.map((it) => (
                        <li key={it.salesOrderItemId}>
                          {it.itemName || it.itemId}: {it.quantity}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {orderPlan.shipment && (
                  <div className="text-xs bg-emerald-50 border border-emerald-200 rounded p-2">
                    <p className="font-bold text-emerald-800">
                      出庫を作成(自社倉庫)
                    </p>
                    <ul className="mt-1 space-y-0.5 text-slate-700">
                      {orderPlan.shipment.items.map((it) => (
                        <li key={it.salesOrderItemId}>
                          {it.itemName || it.itemId}: {it.quantity}
                          (ロケーション: {it.locationId})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {orderPlan.manualItems.length > 0 && (
                  <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
                    <p className="font-bold text-amber-800">要手動対応</p>
                    {orderPlan.manualItems.map((mi) => (
                      <div
                        key={mi.salesOrderItemId}
                        className="flex justify-between items-center gap-2"
                      >
                        <span className="text-slate-700">
                          {mi.itemName || mi.itemId}: 残{mi.remainingQuantity} —{" "}
                          {MANUAL_REASON_LABELS[mi.reason]}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            router.push("/inventory/shipping?tab=shipment")
                          }
                          className="text-amber-700 underline whitespace-nowrap cursor-pointer"
                        >
                          手動で作成する →
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={loading || executing || !hasAnyCreatable}
          className="flex-1 text-sm text-white px-3 py-2 rounded font-bold cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed bg-gradient-to-r from-indigo-600 to-indigo-800 hover:from-indigo-700 hover:to-indigo-900"
        >
          {executing ? "作成中..." : "この内容で作成する"}
        </button>
        <DiscardCancelButton
          onCancel={onClose}
          className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded font-bold cursor-pointer"
        />
      </div>
    </Modal>
  );
}
