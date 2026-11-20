"use client";

import { useEffect, useState } from "react";
import { Modal } from "../../../_shared/ui/Modal";
import { Button } from "../../../_shared/ui/Button";
import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { todayJst } from "../../../_shared/jst-date";
import { NamedOption } from "../_hooks/useTemporaryHoldings";
import { HoldingCategory } from "../_types/temporary-holdings";
import { HoldingLinePickerModal } from "./holding-line-pickers";

// REQ-011(2): 一時保管への受入。発注の直接入力の明細から開いた時は、品名・数量・取引先を引き継ぐ
export interface PurchaseOrderLineSource {
  purchaseOrderId: string;
  purchaseOrderItemId: string;
}

interface Props {
  warehouses: NamedOption[];
  partners: NamedOption[];
  source: PurchaseOrderLineSource | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface OrderDetail {
  partnerId: string;
  items: Array<{ id: string; itemName: string | null; quantity: number; inputType?: string | null }>;
}

export function TemporaryHoldingReceiveModal({ warehouses, partners, source, onClose, onSaved }: Props) {
  const [category, setCategory] = useState<HoldingCategory>("OWN");
  const [itemName, setItemName] = useState("");
  const [spec, setSpec] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitName, setUnitName] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayJst());
  const [plannedReleaseDate, setPlannedReleaseDate] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // REQ-029: 一時保管のタブから開いた時に、発注番号で探して選んだ発注の明細
  const [pickedSource, setPickedSource] = useState<PurchaseOrderLineSource | null>(null);
  const lineSource = source ?? pickedSource;
  const [showPicker, setShowPicker] = useState(false);

  // 発注の明細から開いた時は、品名・数量・取引先を引き継ぐ(画面で直せる)
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    apiFetch<OrderDetail>(`/api/purchase-orders/${encodeURIComponent(source.purchaseOrderId)}`)
      .then((order) => {
        if (cancelled) return;
        const line = order.items.find((i) => i.id === source.purchaseOrderItemId);
        if (line) {
          setItemName(line.itemName ?? "");
          setQuantity(String(line.quantity));
        }
        setPartnerId(order.partnerId ?? "");
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "発注の取得に失敗しました");
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  const handleSubmit = async () => {
    setError("");
    setSaving(true);
    try {
      const data = await apiFetch<{ message?: string }>("/api/temporary-holdings/receive", {
        method: "POST",
        json: {
          category,
          itemName,
          spec: spec || null,
          quantity: Number(quantity),
          unitName: unitName || null,
          warehouseId,
          locationId: locationId || null,
          partnerId: partnerId || null,
          receivedDate,
          plannedReleaseDate: plannedReleaseDate || null,
          purchaseOrderId: lineSource?.purchaseOrderId ?? null,
          purchaseOrderItemId: lineSource?.purchaseOrderItemId ?? null,
          memo: memo || null,
        },
        defaultErrorMessage: "一時保管への受入に失敗しました",
      });
      onSaved(data.message || "一時保管に受け入れました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "一時保管への受入に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = !!itemName.trim() && Number(quantity) > 0 && !!warehouseId && (category === "OWN" || !!partnerId);

  return (
    <Modal
      title="📦 一時保管に受け入れる"
      size="lg"
      onClose={onClose}
      warnOnDiscard
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="primary" onClick={() => void handleSubmit()} disabled={!canSubmit || saving}>
            受け入れる
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <MessageBanner error={error} />
        {lineSource && (
          <p className="text-xs text-slate-700">
            発注[{lineSource.purchaseOrderId}]の直接入力の明細から受け入れます(発注の入荷済数量には数えません)。
            {pickedSource && (
              <button
                type="button"
                onClick={() => setPickedSource(null)}
                className="ml-2 font-bold text-slate-800 underline hover:text-slate-900"
              >
                発注とのつながりを外す
              </button>
            )}
          </p>
        )}
        {!source && !pickedSource && (
          <div>
            <Button size="sm" onClick={() => setShowPicker(true)}>
              📦 発注から選択
            </Button>
            <span className="ml-2 text-[11px] text-slate-600">発注の直接入力(品目マスタに無い)の明細から受け入れる時に使います(任意)</span>
          </div>
        )}
        {showPicker && (
          <HoldingLinePickerModal
            kind="purchase"
            onClose={() => setShowPicker(false)}
            onPick={(line) => {
              setPickedSource({ purchaseOrderId: line.orderId, purchaseOrderItemId: line.itemId });
              setItemName(line.itemName);
              setQuantity(String(line.quantity));
              if (line.partnerId) setPartnerId(line.partnerId);
              setShowPicker(false);
            }}
          />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="区分" required>
            <select className={formFieldInputClass} value={category} onChange={(e) => setCategory(e.target.value as HoldingCategory)}>
              <option value="OWN">自社品</option>
              <option value="CUSTODY">預り品(取引先から預かった物)</option>
            </select>
          </FormField>
          <FormField label="取引先" required={category === "CUSTODY"} hint={category === "CUSTODY" ? "預り品は預け主の取引先が必須です" : undefined}>
            <select className={formFieldInputClass} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">(なし)</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}({p.id})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="品名" required>
            <input className={formFieldInputClass} value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </FormField>
          <FormField label="規格・メモ">
            <input className={formFieldInputClass} value={spec} onChange={(e) => setSpec(e.target.value)} />
          </FormField>
          <FormField label="数量" required>
            <input type="number" min={0} step="any" className={formFieldInputClass} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </FormField>
          <FormField label="単位">
            <input className={formFieldInputClass} value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="例: 個" />
          </FormField>
          <FormField label="倉庫" required>
            <select className={formFieldInputClass} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">-- 選択 --</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}({w.id})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="保管場所(ロケーション)">
            <input className={formFieldInputClass} value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="任意" />
          </FormField>
          <FormField label="受入日" required>
            <input type="date" className={formFieldInputClass} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
          </FormField>
          <FormField label="払出予定日">
            <input type="date" className={formFieldInputClass} value={plannedReleaseDate} onChange={(e) => setPlannedReleaseDate(e.target.value)} />
          </FormField>
        </div>
        <FormField label="メモ">
          <input className={formFieldInputClass} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  );
}
