import { WarehouseSimple } from "../_types";
import { SearchPanelShell } from "../../../_shared/ui/SearchPanelShell";
import { formFieldInputClass } from "../../../_shared/ui/FormField";

interface SearchPanelProps {
  searchId: string;
  setSearchId: (val: string) => void;
  searchWarehouseId: string;
  setSearchWarehouseId: (val: string) => void;
  searchName: string;
  setSearchName: (val: string) => void;
  warehouses: WarehouseSimple[];
  onClear: () => void;
}

export function SearchPanel({
  searchId,
  setSearchId,
  searchWarehouseId,
  setSearchWarehouseId,
  searchName,
  setSearchName,
  warehouses,
  onClear,
}: SearchPanelProps) {
  return (
    <SearchPanelShell title="🔍 ロケーションを絞り込み検索" onClearSearch={onClear}>
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          所属倉庫
        </label>
        <select
          className={`${formFieldInputClass} cursor-pointer`}
          value={searchWarehouseId}
          onChange={(e) => setSearchWarehouseId(e.target.value)}
        >
          <option value="">すべての倉庫</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.id})
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          ロケーションコード
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
        <label className="text-[10px] font-bold text-slate-500">
          ロケーション名
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
