"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "../../../_shared/ui/Modal";
import { Button } from "../../../_shared/ui/Button";
import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { todayJst } from "../../../_shared/jst-date";
import { MoveToStockSection } from "./MoveToStockSection";
import {
  HOLDING_CATEGORY_LABELS,
  HOLDING_MOVEMENT_LABELS,
  HOLDING_STATUS_LABELS,
  TemporaryHoldingDetail,
} from "../_types/temporary-holdings";

// REQ-011(2): 一時保管の詳細(動きの履歴)と、払出・数量の調整。受注の直接入力の明細から開いた時は、その明細に紐づけて払い出す
export interface SalesOrderLineTarget {
  salesOrderId: string;
  salesOrderItemId: string;
}

interface Props {
  holdingId: string;
  canCreate: boolean;
  canDelete: boolean;
  releaseTarget: SalesOrderLineTarget | null;
  warehouseName: (id: string | null) => string;
  partnerName: (id: string | null) => string;
  onClose: () => void;
  onChanged: (message: string) => void;
}

const APPROVAL_BADGE: Record<string, { label: string; tone: "amber" | "emerald" | "red" }> = {
  PENDING: { label: "🟡 承認待ち", tone: "amber" },
  CONFIRMED: { label: "確定", tone: "emerald" },
  REMANDED: { label: "差戻し", tone: "red" },
};

export function TemporaryHoldingDetailModal({
  holdingId,
  canCreate,
  canDelete,
  releaseTarget,
  warehouseName,
  partnerName,
  onClose,
  onChanged,
}: Props) {
  const [detail, setDetail] = useState<TemporaryHoldingDetail | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"release" | "adjust">("release");
  const [quantity, setQuantity] = useState("");
  const [movementDate, setMovementDate] = useState(todayJst());
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<TemporaryHoldingDetail>(`/api/temporary-holdings/${encodeURIComponent(holdingId)}`, {
      defaultErrorMessage: "一時保管の取得に失敗しました",
    })
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "一時保管の取得に失敗しました");
      });
    return () => {
      cancelled = true;
    };
  }, [holdingId, reloadKey]);

  const submit = useCallback(async () => {
    setError("");
    setSaving(true);
    try {
      const path = mode === "release" ? "release" : "adjust";
      const data = await apiFetch<{ message?: string }>(`/api/temporary-holdings/${encodeURIComponent(holdingId)}/${path}`, {
        method: "POST",
        json:
          mode === "release"
            ? {
                quantity: Number(quantity),
                movementDate,
                memo: memo || null,
                salesOrderId: releaseTarget?.salesOrderId ?? null,
                salesOrderItemId: releaseTarget?.salesOrderItemId ?? null,
              }
            : { quantity: Number(quantity), movementDate, memo },
        defaultErrorMessage: mode === "release" ? "払出に失敗しました" : "数量の調整に失敗しました",
      });
      setQuantity("");
      setMemo("");
      setReloadKey((k) => k + 1);
      onChanged(data.message || "記録しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "記録に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [holdingId, mode, quantity, movementDate, memo, releaseTarget, onChanged]);

  const remove = async () => {
    setError("");
    try {
      const data = await apiFetch<{ message?: string }>(`/api/temporary-holdings/${encodeURIComponent(holdingId)}`, {
        method: "DELETE",
        defaultErrorMessage: "削除に失敗しました",
      });
      onChanged(data.message || "削除しました");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    }
  };

  const quantityNumber = Number(quantity);
  const canSubmit =
    !!movementDate && quantity !== "" && quantityNumber !== 0 && (mode === "adjust" ? !!memo.trim() : quantityNumber > 0);
  // REQ-011(3): 在庫へ移す入庫の承認待ちの間は、払出・調整をしない
  const movingToStock = !!detail?.movements.some((m) => m.movementType === "MOVE_TO_STOCK" && m.approvalStatus === "PENDING");
  const editable = canCreate && detail?.status !== "MOVED_TO_STOCK" && !movingToStock;
  const canMoveToStock =
    canCreate &&
    detail?.category === "OWN" &&
    detail.status === "HOLDING" &&
    detail.quantity > 0 &&
    !detail.movements.some((m) => m.approvalStatus === "PENDING");
  const deletable = canDelete && !!detail && !detail.movements.some((m) => m.approvalStatus !== "REMANDED");

  return (
    // 払出・調整・在庫へ移すに成功したら(読み直したら)、未保存の編集の印を消す(保存した後の✕で確認を出さない)
    <Modal title={`📦 一時保管 [${holdingId}]`} size="2xl" onClose={onClose} warnOnDiscard discardResetKey={reloadKey}>
      <div className="space-y-3 text-xs">
        <MessageBanner error={error} />
        {detail && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 rounded-lg p-3 border border-slate-200">
              <Info label="区分" value={HOLDING_CATEGORY_LABELS[detail.category]} />
              <Info label="品名" value={`${detail.itemName}${detail.spec ? `(${detail.spec})` : ""}`} />
              <Info label="数量(確定分)" value={`${detail.quantity} ${detail.unitName ?? ""}`} />
              <Info label="保管場所" value={`${warehouseName(detail.warehouseId)}${detail.locationId ? ` / ${detail.locationId}` : ""}`} />
              <Info label="取引先" value={partnerName(detail.partnerId) || "-"} />
              <Info label="元の伝票" value={detail.sourceId ? `発注 ${detail.sourceId}` : "-"} />
              <Info label="状態" value={HOLDING_STATUS_LABELS[detail.status]} />
            </div>

            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 font-bold text-slate-700 border-b border-slate-200">履歴</div>
              <ul className="divide-y divide-slate-100">
                {detail.movements.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="text-slate-700">
                      {m.movementDate.slice(0, 10)} {HOLDING_MOVEMENT_LABELS[m.movementType]}
                      {m.sourceType === "SALES_ORDER" && m.sourceId ? `(受注 ${m.sourceId})` : ""}
                      {m.sourceType === "STOCK_RECEIPT" && m.sourceId ? `(入庫 ${m.sourceId})` : ""}
                      {m.memo ? ` ${m.memo}` : ""}
                    </span>
                    <span className="flex items-center gap-1.5 font-mono font-bold text-slate-800">
                      <StatusBadge {...(APPROVAL_BADGE[m.approvalStatus] ?? { label: m.approvalStatus, tone: "slate" })} />
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {editable && (
              <div className="border border-slate-200 rounded-lg p-3 space-y-3">
                <div className="flex gap-2">
                  {(["release", "adjust"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`px-3 py-1 rounded-lg border font-bold ${
                        mode === m ? "border-indigo-600 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      {m === "release" ? "払い出す" : "数量を調整する"}
                    </button>
                  ))}
                </div>
                {mode === "release" && releaseTarget && (
                  <p className="text-slate-700">
                    受注[{releaseTarget.salesOrderId}]の直接入力の明細に紐づけて払い出します。
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <FormField
                    label={mode === "release" ? "払い出す数量" : "調整する数量"}
                    required
                    hint={mode === "adjust" ? "増やす時は+、減らす時は−(例: -2)" : undefined}
                  >
                    <input type="number" step="any" className={formFieldInputClass} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                  </FormField>
                  <FormField label={mode === "release" ? "払出日" : "調整日"} required>
                    <input type="date" className={formFieldInputClass} value={movementDate} onChange={(e) => setMovementDate(e.target.value)} />
                  </FormField>
                  <FormField label={mode === "release" ? "メモ" : "調整の理由"} required={mode === "adjust"}>
                    <input className={formFieldInputClass} value={memo} onChange={(e) => setMemo(e.target.value)} />
                  </FormField>
                </div>
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit || saving}>
                    {mode === "release" ? "払い出す" : "調整する"}
                  </Button>
                </div>
              </div>
            )}

            {movingToStock && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 font-bold text-amber-900">
                在庫へ移す入庫の承認待ちです。入庫が承認されると「在庫へ移行済」になります。
              </p>
            )}
            {canMoveToStock && detail && (
              <MoveToStockSection
                holding={detail}
                onMoved={(msg) => {
                  setReloadKey((k) => k + 1);
                  onChanged(msg);
                }}
              />
            )}

            {deletable && (
              <div className="flex justify-end">
                <Button variant="danger" onClick={() => void remove()}>
                  この一時保管を削除する
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block font-bold text-slate-600">{label}</span>
      <span className="font-bold text-slate-800 break-all">{value}</span>
    </div>
  );
}
