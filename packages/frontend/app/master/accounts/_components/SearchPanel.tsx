"use client";

import { SearchPanelShell } from "../../../_shared/ui/SearchPanelShell";
import { formFieldInputClass } from "../../../_shared/ui/FormField";

interface SearchPanelProps {
  searchCode: string;
  setSearchCode: (val: string) => void;
  searchName: string;
  setSearchName: (val: string) => void;
  onClear: () => void;
}

export function SearchPanel({
  searchCode,
  setSearchCode,
  searchName,
  setSearchName,
  onClear,
}: SearchPanelProps) {
  return (
    <SearchPanelShell
      title="🔍 勘定科目を絞り込み検索"
      onClearSearch={onClear}
      columns={2}
    >
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          科目コード
        </label>
        <input
          type="text"
          className={formFieldInputClass}
          placeholder="コードを入力"
          value={searchCode}
          onChange={(e) => setSearchCode(e.target.value)}
        />
      </div>
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          勘定科目名
        </label>
        <input
          type="text"
          className={formFieldInputClass}
          placeholder="名前を入力"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
        />
      </div>
    </SearchPanelShell>
  );
}
