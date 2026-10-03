import React from "react";
import { PartnerMaster, ProductMaster, UserOption } from "../_types";

interface PurchaseRecognitionSearchFormProps {
  partners: PartnerMaster[];
  products: ProductMaster[];
  userMaster: UserOption[];
  filters: any;
  setFilters: React.Dispatch<React.SetStateAction<any>>;
  onClear: () => void;
}

export function PurchaseRecognitionSearchForm({
  partners,
  products,
  userMaster,
  filters,
  setFilters,
  onClear,
}: PurchaseRecognitionSearchFormProps) {
  const inputClass =
    "w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none transition-colors placeholder:text-slate-500 font-medium";

  const handleChange = (field: string, value: string) => {
    setFilters((prev: any) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
      <h2 className="text-xs font-bold text-slate-700 border-b pb-2 border-slate-100">
        🔍 仕入データを絞り込み検索
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-500">
            仕入管理コード
          </label>
          <input
            type="text"
            className={inputClass}
            placeholder="SR-から始まる番号"
            value={filters.id || ""}
            onChange={(e) => handleChange("id", e.target.value)}
          />
        </div>
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-500">
            仕入件名
          </label>
          <input
            type="text"
            className={inputClass}
            placeholder="件名キーワード"
            value={filters.title || ""}
            onChange={(e) => handleChange("title", e.target.value)}
          />
        </div>
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-500">仕入先</label>
          <select
            className={inputClass}
            value={filters.partnerId || ""}
            onChange={(e) => handleChange("partnerId", e.target.value)}
          >
            <option value="">全仕入先(すべて)</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.id}] {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-500">
            伝票種別
          </label>
          <select
            className={inputClass}
            value={filters.documentType || ""}
            onChange={(e) => handleChange("documentType", e.target.value)}
          >
            <option value="">全種別(すべて)</option>
            <option value="PURCHASE">通常仕入</option>
            <option value="RETURN">返品</option>
            <option value="DISCOUNT">値引</option>
            <option value="CORRECTION">赤伝(訂正)</option>
          </select>
        </div>
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-500">
            含まれる品目
          </label>
          <input
            type="text"
            list="search-product-options"
            placeholder="品目名を入力または選択"
            className={inputClass}
            value={filters.itemName || ""}
            onChange={(e) => handleChange("itemName", e.target.value)}
          />
          <datalist id="search-product-options">
            {products.map((prod) => (
              <option key={prod.id} value={prod.name}>
                [{prod.id}] {prod.name}
              </option>
            ))}
          </datalist>
        </div>
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-500">
            作成日 (FROM)
          </label>
          <input
            type="date"
            className={inputClass}
            value={filters.startDate || ""}
            onChange={(e) => handleChange("startDate", e.target.value)}
          />
        </div>
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-500">
            作成日 (TO)
          </label>
          <input
            type="date"
            className={inputClass}
            value={filters.endDate || ""}
            onChange={(e) => handleChange("endDate", e.target.value)}
          />
        </div>
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-500">
            自社担当者
          </label>
          <select
            className={inputClass}
            value={filters.purchasePerson || ""}
            onChange={(e) => handleChange("purchasePerson", e.target.value)}
          >
            <option value="">全自社担当者(すべて)</option>
            {userMaster.map((user) => (
              <option key={user.id} value={user.employeeNumber}>
                {user.name} ({user.employeeNumber || "ユーザー"})
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={onClear}
          className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors border border-slate-300 shadow-sm"
        >
          🧹 条件をクリア
        </button>
      </div>
    </div>
  );
}
