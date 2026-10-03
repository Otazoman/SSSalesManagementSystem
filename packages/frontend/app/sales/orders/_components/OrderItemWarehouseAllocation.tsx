import React, { useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { WarehouseAllocationLine, WarehouseAvailability } from "../_types";

interface OrderItemWarehouseAllocationProps {
  itemId: string;
  inputType: "MASTER" | "DIRECT";
  quantity: number;
  value?: string | null;
  onChange: (value: string | null) => void;
  backorderedQuantity?: number;
}

const inputClass =
  "border border-slate-300 p-1 text-[11px] rounded bg-white text-slate-800 focus:outline-none focus:border-indigo-600";

// Item7残課題2-5: 受注明細1行あたりの「倉庫を指定して引き当てる(任意)」UI。
// 未指定(倉庫を指定しない)の場合はサーバー側が引当実行時に自動でFIFO割当する。
// 指定する場合は、在庫が多い倉庫順の自動提案をベースにユーザーが手動で調整できる
export function OrderItemWarehouseAllocation({
  itemId,
  inputType,
  quantity,
  value,
  onChange,
  backorderedQuantity,
}: OrderItemWarehouseAllocationProps) {
  const [enabled, setEnabled] = useState(!!value);
  const [lines, setLines] = useState<WarehouseAllocationLine[]>(() => {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [availability, setAvailability] = useState<WarehouseAvailability[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAvailability = async () => {
    if (!itemId || inputType !== "MASTER") return [];
    setLoading(true);
    try {
      const data = await apiFetch<WarehouseAvailability[]>(
        `/api/sales-orders/warehouse-stock/${encodeURIComponent(itemId)}`,
        { defaultErrorMessage: "倉庫別在庫の取得に失敗しました" },
      );
      setAvailability(data);
      return data;
    } catch {
      return [];
    } finally {
      setLoading(false);
    }
  };

  const commit = (next: WarehouseAllocationLine[]) => {
    setLines(next);
    onChange(next.length > 0 ? JSON.stringify(next) : null);
  };

  const handleToggle = async (checked: boolean) => {
    setEnabled(checked);
    if (!checked) {
      commit([]);
      return;
    }
    const data = availability.length > 0 ? availability : await fetchAvailability();
    // 在庫が多い倉庫から順にFIFOで自動提案する
    let remaining = quantity;
    const suggestion: WarehouseAllocationLine[] = [];
    for (const w of data) {
      if (remaining <= 0) break;
      if (w.available <= 0) continue;
      const take = Math.min(w.available, remaining);
      suggestion.push({ warehouseId: w.warehouseId, quantity: take });
      remaining -= take;
    }
    commit(suggestion);
  };

  const handleLineWarehouseChange = (idx: number, warehouseId: string) => {
    const next = lines.map((l, i) => (i === idx ? { ...l, warehouseId } : l));
    commit(next);
  };

  const handleLineQuantityChange = (idx: number, qty: number) => {
    const next = lines.map((l, i) => (i === idx ? { ...l, quantity: qty } : l));
    commit(next);
  };

  const handleAddLine = () => {
    const used = new Set(lines.map((l) => l.warehouseId));
    const nextCandidate = availability.find((w) => !used.has(w.warehouseId));
    commit([...lines, { warehouseId: nextCandidate?.warehouseId || "", quantity: 0 }]);
  };

  const handleRemoveLine = (idx: number) => {
    commit(lines.filter((_, i) => i !== idx));
  };

  if (inputType !== "MASTER") return null;

  const lineTotal = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);

  return (
    <div className="flex flex-col gap-1.5 bg-slate-50/70 border border-slate-200 rounded p-2">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => void handleToggle(e.target.checked)}
          />
          倉庫を指定して引き当てる(任意、未指定は自動割当)
        </label>
        {typeof backorderedQuantity === "number" && backorderedQuantity > 0 && (
          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
            ⚠ 不足 {backorderedQuantity}(バックオーダー)
          </span>
        )}
      </div>

      {enabled && (
        <div className="flex flex-col gap-1">
          {loading && <p className="text-[10px] text-slate-600">在庫を確認中...</p>}
          {lines.map((line, idx) => (
            <div key={idx} className="flex items-center gap-1">
              <select
                className={`${inputClass} flex-1`}
                value={line.warehouseId}
                onChange={(e) => handleLineWarehouseChange(idx, e.target.value)}
              >
                <option value="" disabled>
                  -- 倉庫を選択 --
                </option>
                {availability.map((w) => (
                  <option key={w.warehouseId} value={w.warehouseId}>
                    {w.warehouseName}(在庫 {w.available})
                  </option>
                ))}
              </select>
              <input
                type="number"
                className={`${inputClass} w-20`}
                value={line.quantity}
                onChange={(e) => handleLineQuantityChange(idx, Number(e.target.value))}
              />
              <button
                type="button"
                onClick={() => handleRemoveLine(idx)}
                className="text-red-500 font-bold text-xs px-1"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleAddLine}
              className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
            >
              ＋ 倉庫を追加
            </button>
            <span
              className={`text-[10px] font-mono ${
                lineTotal !== quantity ? "text-amber-600 font-bold" : "text-slate-600"
              }`}
            >
              内訳合計 {lineTotal} / 数量 {quantity}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
