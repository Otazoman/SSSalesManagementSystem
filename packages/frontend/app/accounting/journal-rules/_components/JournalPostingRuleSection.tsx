"use client";

import {
  AccountLookup,
  JournalEventType,
  JournalPostingPattern,
  JournalPostingRuleRecord,
} from "../_types";
import { Button } from "../../../_shared/ui/Button";

const EVENT_TYPE_LABEL: Record<JournalEventType, string> = {
  PREPAYMENT: "前払(発注の支払完了時)",
  ADVANCE_RECEIPT: "前受(受注の入金完了時)",
  PURCHASE: "仕入計上(入荷確定時)",
  SALES: "売上計上(出荷確定時)",
  RECEIPT: "入金(入金消込)",
  DISBURSEMENT: "支払(支払消込)",
};

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  DEFAULT: "",
  SALE: "売上",
  PURCHASE: "仕入",
  RETURN: "返品",
  DISCOUNT: "値引",
  CORRECTION: "赤伝(訂正)",
};

// 組の説明(何の金額をこの借方・貸方で仕訳するか)
function lineKindLabel(eventType: JournalEventType, lineKind: JournalPostingPattern["lineKind"]) {
  if (lineKind === "BODY") {
    return eventType === "SALES" || eventType === "PURCHASE" ? "本体(明細の税抜金額)" : "金額";
  }
  if (lineKind === "TAX") return "消費税(明細ごと)";
  return eventType === "SALES" ? "前受金の充当(任意)" : "前渡金の充当(任意)";
}

const selectClass =
  "w-full text-sm border border-slate-300 rounded px-2 py-1.5 bg-white text-slate-900 disabled:opacity-60";

interface JournalPostingRuleSectionProps {
  eventType: JournalEventType;
  rule: JournalPostingRuleRecord;
  accounts: AccountLookup[];
  saving: boolean;
  error?: string;
  // 更新権限が無い場合、全入力・保存ボタンを実際に操作不能にする(見た目だけの制限にしない)
  disabled?: boolean;
  onChange: (patch: Partial<JournalPostingRuleRecord>) => void;
  onPatternChange: (index: number, patch: Partial<JournalPostingPattern>) => void;
  onSave: () => void;
}

/**
 * 会計事象1つ分の仕訳ルール(V-5)。仕訳は「借方〇〇/貸方〇〇」の組で作るため、
 * 組(区分×本体・消費税・充当)ごとに借方・貸方の勘定科目を設定する。
 */
export function JournalPostingRuleSection({
  eventType,
  rule,
  accounts,
  saving,
  error,
  disabled = false,
  onChange,
  onPatternChange,
  onSave,
}: JournalPostingRuleSectionProps) {
  const isItemLinked = eventType === "PURCHASE" || eventType === "SALES";
  const itemAccountLabel = eventType === "SALES" ? "売上高" : "仕入高";

  const sideCell = (pattern: JournalPostingPattern, index: number, side: "debit" | "credit") => {
    const fromItemKey = side === "debit" ? "debitFromItem" : "creditFromItem";
    const codeKey = side === "debit" ? "debitAccountCode" : "creditAccountCode";
    const sideLabel = side === "debit" ? "借方" : "貸方";
    const rowLabel = `${DOCUMENT_TYPE_LABEL[pattern.documentType] ?? ""}${lineKindLabel(eventType, pattern.lineKind)}`;
    const fromItem = pattern[fromItemKey];
    return (
      <td className="px-3 py-2 align-top">
        {isItemLinked && pattern.lineKind === "BODY" && (
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-800 mb-1 cursor-pointer">
            <input
              type="checkbox"
              checked={fromItem}
              disabled={disabled}
              onChange={(e) => onPatternChange(index, { [fromItemKey]: e.target.checked })}
              className="cursor-pointer disabled:cursor-not-allowed"
            />
            品目の科目を使う
          </label>
        )}
        <select
          aria-label={`${rowLabel}の${sideLabel}`}
          value={pattern[codeKey] || ""}
          disabled={disabled}
          onChange={(e) => onPatternChange(index, { [codeKey]: e.target.value || null })}
          className={selectClass}
        >
          <option value="">未設定</option>
          {accounts.map((a) => (
            <option key={a.code} value={a.code}>
              [{a.code}] {a.name}
            </option>
          ))}
        </select>
        {fromItem && (
          <p className="text-[10px] text-slate-700 mt-1">
            品目に科目が無い明細は、この科目を使います
          </p>
        )}
      </td>
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div>
          <h3 className="text-sm font-black text-slate-900">
            {EVENT_TYPE_LABEL[eventType]}
          </h3>
          <p className="text-[11px] text-slate-600 mt-0.5 font-mono">
            {eventType}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
          <input
            type="checkbox"
            checked={rule.enabled}
            disabled={disabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            className="cursor-pointer disabled:cursor-not-allowed"
          />
          この事象の仕訳作成を有効にする
        </label>
      </div>

      {error && (
        <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg">
          ⚠️ {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left px-3 py-2 font-bold text-slate-800 w-44">組</th>
              <th className="text-left px-3 py-2 font-black bg-indigo-50 text-indigo-800">借方</th>
              <th className="text-left px-3 py-2 font-black bg-orange-50 text-orange-800">貸方</th>
            </tr>
          </thead>
          <tbody>
            {(rule.patterns ?? []).map((pattern, index) => {
              const doc = DOCUMENT_TYPE_LABEL[pattern.documentType] ?? pattern.documentType;
              const firstOfDocument =
                index === 0 || rule.patterns[index - 1].documentType !== pattern.documentType;
              return (
                <tr
                  key={`${pattern.documentType}:${pattern.lineKind}`}
                  className={firstOfDocument && index > 0 ? "border-t-2 border-slate-200" : "border-t border-slate-100"}
                >
                  <td className="px-3 py-2 align-top">
                    {doc && firstOfDocument && (
                      <span className="block font-black text-slate-900">{doc}</span>
                    )}
                    <span className="text-slate-800">{lineKindLabel(eventType, pattern.lineKind)}</span>
                  </td>
                  {sideCell(pattern, index, "debit")}
                  {sideCell(pattern, index, "credit")}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isItemLinked && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
          <p className="text-xs text-slate-800">
            仕訳は明細ごとに「本体」「消費税」の組を作ります。「品目の科目を使う」にした側は、
            {itemAccountLabel}などの品目ごとの科目になります。
            {eventType === "SALES"
              ? "前受金を充当した売上は、明細を売掛金で計上したうえで「前受金の充当」の組で振り替えます。"
              : "前渡金を充当した仕入は、明細を買掛金で計上したうえで「前渡金の充当」の組で振り替えます。"}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <label className="text-[11px] font-bold text-slate-800" htmlFor={`priority-${eventType}`}>
              品目の科目の優先順位
            </label>
            <select
              id={`priority-${eventType}`}
              value={rule.variableAccountPriority}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  variableAccountPriority: e.target
                    .value as JournalPostingRuleRecord["variableAccountPriority"],
                })
              }
              className="text-sm border border-slate-300 rounded px-2 py-1.5 bg-white text-slate-900 disabled:opacity-60"
            >
              <option value="ITEM_MASTER_FIRST">品目マスタの科目を優先</option>
              <option value="HEADER_FIRST">
                伝票ヘッダーの科目を優先
                {eventType === "SALES" ? "(受注には該当が無いため実質未使用)" : ""}
              </option>
            </select>
          </div>
        </div>
      )}

      <div>
        <label className="block text-[11px] font-bold text-slate-800 mb-1">メモ</label>
        <input
          type="text"
          value={rule.memo || ""}
          disabled={disabled}
          onChange={(e) => onChange({ memo: e.target.value || null })}
          className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-white text-slate-900 placeholder-slate-500 disabled:opacity-60"
          placeholder="運用メモ(任意)"
        />
      </div>

      {rule.updatedBy && (
        <p className="text-[10px] text-slate-600">
          最終更新: {rule.updatedBy}{" "}
          {rule.updatedAt
            ? new Date(rule.updatedAt).toLocaleString("ja-JP")
            : ""}
        </p>
      )}

      <div className="pt-2 border-t border-slate-100">
        <Button onClick={onSave} disabled={saving || disabled}>
          {saving ? "保存中..." : `この事象(${eventType})の設定を保存`}
        </Button>
      </div>
    </div>
  );
}
