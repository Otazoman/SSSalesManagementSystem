import React from "react";
import {
  formFieldInputClass,
  formFieldLabelClass,
} from "../../../_shared/ui/FormField";
import { Button } from "../../../_shared/ui/Button";
import { PartnerMaster, UserOption, ProductMaster } from "../_types";

interface QuoteSearchFormProps {
  partners: PartnerMaster[];
  products: ProductMaster[];
  userMaster: UserOption[];
  filters: any;
  setFilters: React.Dispatch<React.SetStateAction<any>>;
  onClear: () => void;
}

export function QuoteSearchForm({
  partners,
  products,
  userMaster,
  filters,
  setFilters,
  onClear,
}: QuoteSearchFormProps) {
  const inputClass = formFieldInputClass;

  const handleChange = (field: string, value: string) => {
    setFilters((prev: any) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
      <h2 className="text-xs font-bold text-slate-700 border-b pb-2 border-slate-100">
        🔍 見積データを絞り込み検索
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <div className="flex flex-col space-y-1">
          <label className={formFieldLabelClass}>見積管理コード</label>
          <input
            type="text"
            className={inputClass}
            placeholder="QT-から始まる番号"
            value={filters.id || ""}
            onChange={(e) => handleChange("id", e.target.value)}
          />
        </div>
        <div className="flex flex-col space-y-1">
          <label className={formFieldLabelClass}>見積件名</label>
          <input
            type="text"
            className={inputClass}
            placeholder="件名キーワード"
            value={filters.title || ""}
            onChange={(e) => handleChange("title", e.target.value)}
          />
        </div>
        <div className="flex flex-col space-y-1">
          <label className={formFieldLabelClass}>取引先</label>
          <select
            className={inputClass}
            value={filters.partnerId || ""}
            onChange={(e) => handleChange("partnerId", e.target.value)}
          >
            <option value="">全取引先(すべて)</option>
            {partners.map((cust) => (
              <option key={cust.id} value={cust.id}>
                [{cust.id}] {cust.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col space-y-1">
          <label className={formFieldLabelClass}>含まれる品目</label>
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
          <label className={formFieldLabelClass}>作成日 (FROM)</label>
          <input
            type="date"
            className={inputClass}
            value={filters.startDate || ""}
            onChange={(e) => handleChange("startDate", e.target.value)}
          />
        </div>
        <div className="flex flex-col space-y-1">
          <label className={formFieldLabelClass}>作成日 (TO)</label>
          <input
            type="date"
            className={inputClass}
            value={filters.endDate || ""}
            onChange={(e) => handleChange("endDate", e.target.value)}
          />
        </div>
        <div className="flex flex-col space-y-1">
          <label className={formFieldLabelClass}>自社担当者</label>
          <select
            className={inputClass}
            value={filters.salesPerson || ""}
            onChange={(e) => handleChange("salesPerson", e.target.value)}
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
        <Button variant="secondary" onClick={onClear}>
          🧹 条件をクリア
        </Button>
      </div>
    </div>
  );
}
