"use client";

import { LocationRecord, ProductRecord, WarehouseRecord } from "../_types";

const selectClass =
  "w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900";

interface StockSearchPanelProps {
  warehouses: WarehouseRecord[];
  locations: LocationRecord[];
  products: ProductRecord[];
  warehouseId: string;
  setWarehouseId: (v: string) => void;
  locationId: string;
  setLocationId: (v: string) => void;
  itemId: string;
  setItemId: (v: string) => void;
  onClear: () => void;
}

export function StockSearchPanel({
  warehouses,
  locations,
  products,
  warehouseId,
  setWarehouseId,
  locationId,
  setLocationId,
  itemId,
  setItemId,
  onClear,
}: StockSearchPanelProps) {
  return (
    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-sm text-slate-600 block mb-1">倉庫</label>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className={selectClass}
          >
            <option value="">すべて</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.id} ({w.name})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-600 block mb-1">ロケーション</label>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className={selectClass}
          >
            <option value="">すべて</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.id} ({l.name})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-600 block mb-1">品目</label>
          <select
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            className={selectClass}
          >
            <option value="">すべて</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} ({p.name})
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClear}
          className="text-sm text-slate-600 hover:text-slate-800 font-bold cursor-pointer"
        >
          条件をクリア
        </button>
      </div>
    </div>
  );
}
