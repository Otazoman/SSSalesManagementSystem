import React from "react";
import { Button } from "../../../_shared/ui/Button";
import { DeliveryDateReflection } from "../_types";

interface PurchaseOrderDeliveryDateReflectionProps {
  value: DeliveryDateReflection;
  onChange: (value: DeliveryDateReflection) => void;
  // 受注(または購買申請経由で受注)に紐づく明細があるか。無ければ反映方法の選択は出さない
  hasLinkedItems: boolean;
  // 保存済みの発注(承認済みを含む)で「納期のみ保存」を出すか
  canSaveDeliveryDatesOnly: boolean;
  isLocked: boolean;
  isSubmitting: boolean;
  onSaveDeliveryDatesOnly: () => void;
}

// 新規要望(2026-10-18): 回答納期を受注明細の納期へ反映する方法の選択と、「納期のみ保存」(承認済みでも
// 変更申請不要)の操作欄。反映は保存(通常保存・変更申請の承認確定・納期のみ保存)の時点で行われる
export function PurchaseOrderDeliveryDateReflection({
  value,
  onChange,
  hasLinkedItems,
  canSaveDeliveryDatesOnly,
  isLocked,
  isSubmitting,
  onSaveDeliveryDatesOnly,
}: PurchaseOrderDeliveryDateReflectionProps) {
  if (!hasLinkedItems && !canSaveDeliveryDatesOnly) return null;

  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-3 bg-slate-50">
      <p className="text-xs font-bold text-slate-800">📅 納期回答</p>

      {hasLinkedItems && (
        <fieldset className="min-w-0 space-y-1.5" disabled={isLocked}>
          <legend className="text-[11px] font-bold text-slate-800">
            保存時に、回答納期を紐づく受注明細の納期へ反映しますか?
          </legend>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-800">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="deliveryDateReflection"
                checked={value.mode === "NONE"}
                onChange={() => onChange({ ...value, mode: "NONE" })}
              />
              反映しない
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="deliveryDateReflection"
                checked={value.mode === "SAME"}
                onChange={() => onChange({ ...value, mode: "SAME" })}
              />
              回答納期をそのまま反映
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="deliveryDateReflection"
                checked={value.mode === "ADD_DAYS"}
                onChange={() => onChange({ ...value, mode: "ADD_DAYS" })}
              />
              回答納期に
              <input
                type="number"
                min={0}
                max={365}
                step={1}
                aria-label="回答納期に加算する日数"
                className="w-16 border border-slate-300 p-1 text-base sm:text-xs rounded bg-white text-slate-900 focus:border-indigo-600 focus:outline-none disabled:opacity-60"
                value={value.addDays}
                disabled={value.mode !== "ADD_DAYS"}
                onChange={(e) =>
                  onChange({
                    ...value,
                    addDays: Math.min(365, Math.max(0, Math.trunc(Number(e.target.value) || 0))),
                  })
                }
              />
              日足して反映
            </label>
          </div>
          <p className="text-[11px] text-slate-700">
            1つの受注明細に複数の発注明細が紐づく場合は、最も遅い回答納期を基準にします。日数は暦日(土日祝も数える)です。受注が承認済みでも、受注明細の納期だけが更新されます。
          </p>
        </fieldset>
      )}

      {canSaveDeliveryDatesOnly && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={isLocked || isSubmitting}
            onClick={onSaveDeliveryDatesOnly}
          >
            {isSubmitting ? "処理を実行中..." : "📅 納期のみ保存(変更申請不要)"}
          </Button>
          <p className="text-[11px] text-slate-700">
            明細の希望納期・回答納期だけを保存します。数量・金額など他の変更は保存されません。
          </p>
        </div>
      )}
    </div>
  );
}
