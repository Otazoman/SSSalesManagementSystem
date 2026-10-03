import React from "react";

interface JournalBatchFilters {
  sourceType: string;
  eventType: string;
  startDate: string;
  endDate: string;
  onlyOriginal: string;
}

interface JournalBatchSearchFormProps {
  filters: JournalBatchFilters;
  setFilters: React.Dispatch<React.SetStateAction<JournalBatchFilters>>;
  onClear: () => void;
}

const SOURCE_TYPE_OPTIONS = [
  { value: "", label: "元伝票: すべて" },
  { value: "purchase_order", label: "発注" },
  { value: "purchase_recognition", label: "仕入計上" },
  { value: "sales_order", label: "受注" },
  { value: "sales_invoice", label: "売上計上" },
];

const EVENT_TYPE_OPTIONS = [
  { value: "", label: "会計事象: すべて" },
  { value: "PREPAYMENT", label: "前払" },
  { value: "PURCHASE", label: "仕入計上" },
  { value: "ADVANCE_RECEIPT", label: "前受" },
  { value: "SALES", label: "売上計上" },
  { value: "RECEIPT", label: "入金" },
  { value: "DISBURSEMENT", label: "支払" },
];

export function JournalBatchSearchForm({
  filters,
  setFilters,
  onClear,
}: JournalBatchSearchFormProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <select
          className="border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
          value={filters.sourceType}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, sourceType: e.target.value }))
          }
        >
          {SOURCE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
          value={filters.eventType}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, eventType: e.target.value }))
          }
        >
          {EVENT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
          value={filters.startDate}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, startDate: e.target.value }))
          }
          placeholder="計上日(開始)"
        />
        <input
          type="date"
          className="border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
          value={filters.endDate}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, endDate: e.target.value }))
          }
          placeholder="計上日(終了)"
        />
        <label className="flex items-center gap-2 text-xs text-slate-700 px-2">
          <input
            type="checkbox"
            checked={filters.onlyOriginal === "true"}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                onlyOriginal: e.target.checked ? "true" : "",
              }))
            }
          />
          反対仕訳・訂正仕訳を除く
        </label>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-slate-500 hover:text-slate-700 font-bold"
        >
          🔄 条件クリア
        </button>
      </div>
    </div>
  );
}
