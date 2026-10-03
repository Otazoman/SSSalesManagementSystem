import { PartnerLookup } from "../_types";
import { SearchPanelShell } from "../../../_shared/ui/SearchPanelShell";
import { formFieldInputClass } from "../../../_shared/ui/FormField";

interface SearchPanelProps {
  searchPartnerId: string;
  setSearchPartnerId: (id: string) => void;
  searchName: string;
  setSearchName: (name: string) => void;
  partners: PartnerLookup[];
}

export function SearchPanel({
  searchPartnerId,
  setSearchPartnerId,
  searchName,
  setSearchName,
  partners,
}: SearchPanelProps) {
  return (
    <SearchPanelShell title="🔍 取引先担当者を絞り込み検索" columns={2}>
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          取引先で絞り込み
        </label>
        <select
          className={`${formFieldInputClass} cursor-pointer`}
          value={searchPartnerId}
          onChange={(e) => setSearchPartnerId(e.target.value)}
        >
          <option value="">すべての取引先</option>
          {partners.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}{" "}
              {c.status === "suspended"
                ? "(🛑無効)"
                : c.status === "temporary"
                  ? "(🟡仮登録)"
                  : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">担当者名</label>
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
