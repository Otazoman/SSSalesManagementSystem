"use client";

import { SearchPanelShell } from "../../../_shared/ui/SearchPanelShell";
import { formFieldInputClass } from "../../../_shared/ui/FormField";

interface SearchPanelProps {
  searchId: string;
  setSearchId: (val: string) => void;
  searchName: string;
  setSearchName: (val: string) => void;
  searchNameMode: "partial" | "exact";
  setSearchNameMode: (val: "partial" | "exact") => void;
  searchType: string;
  setSearchType: (val: string) => void;
  onClear: () => void;
}

export default function SearchPanel({
  searchId,
  setSearchId,
  searchName,
  setSearchName,
  searchNameMode,
  setSearchNameMode,
  searchType,
  setSearchType,
  onClear,
}: SearchPanelProps) {
  return (
    <SearchPanelShell title="🔍 取引先を絞り込み検索" onClearSearch={onClear}>
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          取引先コード
        </label>
        <input
          type="text"
          className={formFieldInputClass}
          placeholder="コードを入力"
          value={searchId}
          onChange={(e) => setSearchId(e.target.value)}
        />
      </div>
      <div className="flex flex-col space-y-1">
        <div className="flex justify-between items-center">
          <label className="text-[10px] font-bold text-slate-500">
            取引先名
          </label>
          <div className="flex space-x-2 text-[9px] font-bold">
            <label className="flex items-center space-x-0.5 cursor-pointer">
              <input
                type="radio"
                checked={searchNameMode === "partial"}
                onChange={() => setSearchNameMode("partial")}
                className="w-2.5 h-2.5"
              />
              <span>部分</span>
            </label>
            <label className="flex items-center space-x-0.5 cursor-pointer">
              <input
                type="radio"
                checked={searchNameMode === "exact"}
                onChange={() => setSearchNameMode("exact")}
                className="w-2.5 h-2.5"
              />
              <span>完全</span>
            </label>
          </div>
        </div>
        <input
          type="text"
          className={formFieldInputClass}
          placeholder="名前を入力"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
        />
      </div>
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          取引区分
        </label>
        <select
          className={`${formFieldInputClass} cursor-pointer`}
          value={searchType}
          onChange={(e) => setSearchType(e.target.value)}
        >
          <option value="">すべての区分</option>
          <option value="CUSTOMER">CUSTOMER (得意先)</option>
          <option value="SUPPLIER">SUPPLIER (仕入先)</option>
          <option value="BOTH">BOTH (双方取引)</option>
          <option value="PROSPECT">PROSPECT (見込み客)</option>
        </select>
      </div>
    </SearchPanelShell>
  );
}
