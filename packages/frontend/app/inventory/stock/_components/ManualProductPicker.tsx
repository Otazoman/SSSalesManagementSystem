"use client";

import { useState } from "react";
import { ProductRecord } from "../_types";

interface ManualProductPickerProps {
  products: ProductRecord[];
  onSelect: (product: ProductRecord) => void;
}

/**
 * 商品のPC検索/選択(バーコードスキャン不可時の代替経路)。
 */
export function ManualProductPicker({ products, onSelect }: ManualProductPickerProps) {
  const [keyword, setKeyword] = useState("");

  const filtered = keyword
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(keyword.toLowerCase()) ||
          p.id.toLowerCase().includes(keyword.toLowerCase()),
      )
    : products;

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white space-y-2">
      <span className="text-sm font-bold text-slate-800">⌨️ 品目をPC検索で選択</span>
      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="品目名・品目コードで検索"
        className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900"
      />
      <div className="max-h-40 overflow-y-auto border border-slate-100 rounded divide-y divide-slate-100">
        {filtered.length === 0 && (
          <p className="text-sm text-slate-500 p-2">該当する品目がありません</p>
        )}
        {filtered.slice(0, 50).map((p) => (
          <button
            type="button"
            key={p.id}
            onClick={() => onSelect(p)}
            className="w-full text-left text-sm px-2 py-2 hover:bg-indigo-50 cursor-pointer"
          >
            <span className="font-bold text-slate-800">{p.id}</span>{" "}
            <span className="text-slate-600">{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
