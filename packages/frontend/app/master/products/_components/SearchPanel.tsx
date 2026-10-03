// app/products/_components/SearchPanel.tsx
import { SearchPanelShell } from "../../../_shared/ui/SearchPanelShell";
import { formFieldInputClass } from "../../../_shared/ui/FormField";

interface SearchPanelProps {
  searchId: string;
  setSearchId: (v: string) => void;
  searchName: string;
  setSearchName: (v: string) => void;
  searchNameMode: "partial" | "exact";
  setSearchNameMode: (v: "partial" | "exact") => void;
  searchBarcode: string;
  setSearchBarcode: (v: string) => void;
  searchFilter: string;
  setSearchFilter: (v: string) => void;
  onClear: () => void;
}

export function SearchPanel({
  searchId,
  setSearchId,
  searchName,
  setSearchName,
  searchNameMode,
  setSearchNameMode,
  searchBarcode,
  setSearchBarcode,
  searchFilter,
  setSearchFilter,
  onClear,
}: SearchPanelProps) {
  return (
    <SearchPanelShell title="🔍 品目を絞り込み検索" onClearSearch={onClear} columns={4}>
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">品目ID</label>
        <input
          type="text"
          className={formFieldInputClass}
          placeholder="品目IDで検索"
          value={searchId}
          onChange={(e) => setSearchId(e.target.value)}
        />
      </div>
      <div className="flex flex-col space-y-1">
        <div className="flex justify-between items-center">
          <label className="text-[10px] font-bold text-slate-700">
            品目名称
          </label>
          <div className="flex space-x-2 text-[9px] font-bold text-slate-600">
            <label className="flex items-center space-x-0.5 cursor-pointer">
              <input
                type="radio"
                checked={searchNameMode === "partial"}
                onChange={() => setSearchNameMode("partial")}
                className="w-2.5 h-2.5 cursor-pointer"
              />
              <span>あいまい</span>
            </label>
            <label className="flex items-center space-x-0.5 cursor-pointer">
              <input
                type="radio"
                checked={searchNameMode === "exact"}
                onChange={() => setSearchNameMode("exact")}
                className="w-2.5 h-2.5"
              />
              <span>完全一致</span>
            </label>
          </div>
        </div>
        <input
          type="text"
          className={formFieldInputClass}
          placeholder="品目名を入力"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
        />
      </div>
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          バーコード
        </label>
        <input
          type="text"
          className={formFieldInputClass}
          placeholder="JANバーコード"
          value={searchBarcode}
          onChange={(e) => setSearchBarcode(e.target.value)}
        />
      </div>
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          取扱特性区分
        </label>
        <select
          className={`${formFieldInputClass} cursor-pointer`}
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
        >
          <option value="">すべての取扱特性</option>
          <option value="sales">📈 販売対象のみ</option>
          <option value="purchased">🛒 購買対象のみ</option>
          <option value="service">🛠️ サービス/加工費のみ</option>
        </select>
      </div>
    </SearchPanelShell>
  );
}
