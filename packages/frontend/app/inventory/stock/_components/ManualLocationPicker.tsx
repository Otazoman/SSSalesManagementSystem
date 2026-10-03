"use client";

import { useState } from "react";
import { LocationRecord, WarehouseRecord } from "../_types";

interface ManualLocationPickerProps {
  locations: LocationRecord[];
  warehouses: WarehouseRecord[];
  onSelect: (location: LocationRecord) => void;
}

/**
 * ロケーションコードのPC入力/検索選択(スキャン不可時の代替経路として仕様上必須)。
 */
export function ManualLocationPicker({
  locations,
  warehouses,
  onSelect,
}: ManualLocationPickerProps) {
  const [keyword, setKeyword] = useState("");
  // ロケーション数が多い現場では倉庫を先に絞ってからキーワード検索したいという要望のための
  // 追加絞り込み。空文字("")は「すべて」を意味する
  const [warehouseId, setWarehouseId] = useState("");

  const byWarehouse = warehouseId
    ? locations.filter((l) => l.warehouseId === warehouseId)
    : locations;

  const filtered = keyword
    ? byWarehouse.filter(
        (l) =>
          l.id.toLowerCase().includes(keyword.toLowerCase()) ||
          l.name.toLowerCase().includes(keyword.toLowerCase()),
      )
    : byWarehouse;

  const warehouseName = (whId: string) =>
    warehouses.find((w) => w.id === whId)?.name || whId;

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white space-y-2">
      <span className="text-sm font-bold text-slate-800">⌨️ ロケーションをPC入力で選択</span>
      <select
        value={warehouseId}
        onChange={(e) => setWarehouseId(e.target.value)}
        className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900"
      >
        <option value="">倉庫で絞り込み(すべて)</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.id} ({w.name})
          </option>
        ))}
      </select>
      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="ロケーションコード・名称で検索"
        className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900"
      />
      <div className="max-h-40 overflow-y-auto border border-slate-100 rounded divide-y divide-slate-100">
        {filtered.length === 0 && (
          <p className="text-sm text-slate-500 p-2">該当するロケーションがありません</p>
        )}
        {filtered.slice(0, 50).map((l) => (
          <button
            type="button"
            key={l.id}
            onClick={() => onSelect(l)}
            className="w-full text-left text-sm px-2 py-2 hover:bg-indigo-50 cursor-pointer"
          >
            <span className="font-bold text-slate-800">{l.id}</span>{" "}
            <span className="text-slate-600">{l.name}</span>{" "}
            <span className="text-slate-500">({warehouseName(l.warehouseId)})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
