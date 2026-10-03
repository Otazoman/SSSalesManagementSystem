"use client";

import { MasterPartner } from "../_types";
import { SearchPanelShell } from "../../../_shared/ui/SearchPanelShell";
import { formFieldInputClass } from "../../../_shared/ui/FormField";

interface SearchPanelProps {
  searchItemId: string;
  setSearchItemId: (val: string) => void;
  searchPriceType: string;
  setSearchPriceType: (val: string) => void;
  searchPartnerId: string;
  setSearchPartnerId: (val: string) => void;
  searchStatus: string;
  setSearchStatus: (val: string) => void;
  partners: MasterPartner[];
  onClear: () => void;
}

export function SearchPanel({
  searchItemId,
  setSearchItemId,
  searchPriceType,
  setSearchPriceType,
  searchPartnerId,
  setSearchPartnerId,
  searchStatus,
  setSearchStatus,
  partners,
  onClear,
}: SearchPanelProps) {
  return (
    <SearchPanelShell
      title="🔍 単価設定を絞り込み検索"
      onClearSearch={onClear}
      columns={4}
    >
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          品目コード
        </label>
        <input
          type="text"
          className={formFieldInputClass}
          placeholder="品目コードで検索..."
          value={searchItemId}
          onChange={(e) => setSearchItemId(e.target.value)}
        />
      </div>
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          単価区分
        </label>
        <select
          className={`${formFieldInputClass} cursor-pointer`}
          value={searchPriceType}
          onChange={(e) => setSearchPriceType(e.target.value)}
        >
          <option value="">すべての単価区分</option>
          <option value="SALES">SALES (販売特値)</option>
          <option value="PURCHASE">PURCHASE (仕入特値)</option>
        </select>
      </div>
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          適用取引先
        </label>
        <select
          className={`${formFieldInputClass} cursor-pointer`}
          value={searchPartnerId}
          onChange={(e) => setSearchPartnerId(e.target.value)}
        >
          <option value="">すべての適用取引先</option>
          <option value="standard">🌐 標準単価設定(空欄)のみ</option>
          {partners.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-500">
          ステータス
        </label>
        <select
          className={`${formFieldInputClass} cursor-pointer`}
          value={searchStatus}
          onChange={(e) => setSearchStatus(e.target.value)}
        >
          <option value="">すべてのステータス</option>
          <option value="temporary">仮登録</option>
          <option value="active">有効</option>
          <option value="suspended">無効</option>
        </select>
      </div>
    </SearchPanelShell>
  );
}
