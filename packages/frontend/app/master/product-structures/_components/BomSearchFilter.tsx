import { SearchPanelShell } from "../../../_shared/ui/SearchPanelShell";
import { formFieldInputClass } from "../../../_shared/ui/FormField";

interface BomSearchFilterProps {
  searchParentId: string;
  setSearchParentId: (val: string) => void;
  searchChildId: string;
  setSearchChildId: (val: string) => void;
  onClearSearch: () => void;
}

export function BomSearchFilter({
  searchParentId,
  setSearchParentId,
  searchChildId,
  setSearchChildId,
  onClearSearch,
}: BomSearchFilterProps) {
  return (
    <SearchPanelShell
      title="🔍 条件指定検索(親品番・構成パーツ)"
      onClearSearch={onClearSearch}
      columns={2}
    >
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          親品目コード (上位アセンブリ)
        </label>
        <input
          type="text"
          className={formFieldInputClass}
          placeholder="親IDを入力"
          value={searchParentId}
          onChange={(e) => setSearchParentId(e.target.value)}
        />
      </div>

      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          子品目コード (構成パーツ)
        </label>
        <input
          type="text"
          className={formFieldInputClass}
          placeholder="子IDを入力"
          value={searchChildId}
          onChange={(e) => setSearchChildId(e.target.value)}
        />
      </div>
    </SearchPanelShell>
  );
}
