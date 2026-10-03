"use client";

import { SearchPanelShell } from "../../../_shared/ui/SearchPanelShell";
import { formFieldInputClass } from "../../../_shared/ui/FormField";

interface SearchPanelProps {
  searchId: string;
  setSearchId: (val: string) => void;
  searchName: string;
  setSearchName: (val: string) => void;
  onClear: () => void;
}

export function SearchPanel({
  searchId,
  setSearchId,
  searchName,
  setSearchName,
  onClear,
}: SearchPanelProps) {
  return (
    <SearchPanelShell title="🔍 倉庫を絞り込み検索" onClearSearch={onClear} columns={2}>
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          倉庫コード
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
        <label className="text-[10px] font-bold text-slate-500">倉庫名</label>
        <input
          type="text"
          className={formFieldInputClass}
          placeholder="倉庫名を入力"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
        />
      </div>
    </SearchPanelShell>
  );
}
