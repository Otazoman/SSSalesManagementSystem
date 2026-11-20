"use client";

import { useEffect, useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { useConfirm } from "../../../_shared/hooks/use-confirm";
import { todayJst } from "../../../_shared/jst-date";
import { TemporaryHolding } from "../_types/temporary-holdings";

// REQ-011(3): 自社品を、品目マスタの品目として在庫へ移す。残りの数量で入庫を作り(入庫の承認の流れを通る)、
// 入庫が確定したら台帳は「在庫へ移行済」になる。品目マスタに無ければ、先に品目マスタに登録する
interface Option {
  id: string;
  name: string;
  warehouseId?: string;
}

export function MoveToStockSection({ holding, onMoved }: { holding: TemporaryHolding; onMoved: (message: string) => void }) {
  const [items, setItems] = useState<Option[]>([]);
  const [locations, setLocations] = useState<Option[]>([]);
  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayJst());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiFetch<Option[]>("/api/products?status=active").catch(() => []),
      apiFetch<Option[]>("/api/locations?status=active").catch(() => []),
    ]).then(([itemRows, locationRows]) => {
      if (cancelled) return;
      setItems(Array.isArray(itemRows) ? itemRows : []);
      setLocations((Array.isArray(locationRows) ? locationRows : []).filter((l) => l.warehouseId === holding.warehouseId));
    });
    return () => {
      cancelled = true;
    };
  }, [holding.warehouseId]);

  const submit = async () => {
    if (!(await confirm(`一時保管[${holding.id}]の残り ${holding.quantity} を、品目[${itemId}]として入庫しますか？`))) return;
    setError("");
    setSaving(true);
    try {
      const data = await apiFetch<{ message?: string }>(
        `/api/temporary-holdings/${encodeURIComponent(holding.id)}/move-to-stock`,
        { method: "POST", json: { itemId, locationId, receivedDate }, defaultErrorMessage: "在庫への移行に失敗しました" },
      );
      onMoved(data.message || "在庫へ移しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "在庫への移行に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-3">
      <p className="font-bold text-slate-800">品目マスタに登録して在庫へ移す</p>
      <p className="text-slate-700">
        残りの数量({holding.quantity})で、同じ倉庫への入庫を作ります。入庫が確定すると「在庫へ移行済」になります。
        品目マスタに無い場合は、先に{" "}
        <a href="/master/products" target="_blank" rel="noreferrer" className="font-bold text-indigo-700 underline hover:text-indigo-900">
          品目マスタ
        </a>{" "}
        に登録してください。
      </p>
      <MessageBanner error={error} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FormField label="品目" required>
          <select aria-label="品目" className={formFieldInputClass} value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">-- 選択 --</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}({i.id})
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="ロケーション" required>
          <select aria-label="ロケーション" className={formFieldInputClass} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">-- 選択 --</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}({l.id})
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="入庫日" required>
          <input type="date" className={formFieldInputClass} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
        </FormField>
      </div>
      <div className="flex justify-end">
        <Button variant="success" onClick={() => void submit()} disabled={!itemId || !locationId || !receivedDate || saving}>
          在庫へ移す
        </Button>
      </div>
    </div>
  );
}
