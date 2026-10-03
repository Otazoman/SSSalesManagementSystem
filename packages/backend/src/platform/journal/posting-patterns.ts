import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";

// 仕訳パターン(V-5)。仕訳は「借方〇〇/貸方〇〇」の組(同じ金額)を並べて作る。
// どの組があるか(会計事象×伝票区分×行の種類)はここで固定し、各組の借方・貸方の科目を
// journal_posting_patterns に持つ。行が無い組は journal_posting_rules の役割別の科目から組み立てる。

export type PatternEventType = (typeof schema.journalPostingPatterns.$inferSelect)["eventType"];
export type PatternLineKind = "BODY" | "TAX" | "ADVANCE";
type Side = "DEBIT" | "CREDIT";

export interface PostingPatternSlot {
  eventType: PatternEventType;
  documentType: string;
  lineKind: PatternLineKind;
  // 売上高・仕入高など、品目の科目と消費税区分を持たせる側(本体の組のみ)
  itemSide: Side | null;
}

export interface PostingPattern {
  documentType: string;
  lineKind: PatternLineKind;
  debitFromItem: boolean;
  debitAccountCode: string | null;
  creditFromItem: boolean;
  creditAccountCode: string | null;
}

const ITEM_LINKED_SLOTS = (
  eventType: "SALES" | "PURCHASE",
  normalDocumentType: string,
): PostingPatternSlot[] => {
  // 売上は貸方、仕入は借方が品目の科目。返品・値引・赤伝(訂正)は反対側
  const normalItemSide: Side = eventType === "SALES" ? "CREDIT" : "DEBIT";
  const reverseItemSide: Side = normalItemSide === "CREDIT" ? "DEBIT" : "CREDIT";
  return [
    { eventType, documentType: normalDocumentType, lineKind: "BODY", itemSide: normalItemSide },
    { eventType, documentType: normalDocumentType, lineKind: "TAX", itemSide: null },
    { eventType, documentType: normalDocumentType, lineKind: "ADVANCE", itemSide: null },
    ...["RETURN", "DISCOUNT", "CORRECTION"].flatMap((documentType): PostingPatternSlot[] => [
      { eventType, documentType, lineKind: "BODY", itemSide: reverseItemSide },
      { eventType, documentType, lineKind: "TAX", itemSide: null },
    ]),
  ];
};

export const POSTING_PATTERN_SLOTS: PostingPatternSlot[] = [
  { eventType: "PREPAYMENT", documentType: "DEFAULT", lineKind: "BODY", itemSide: null },
  { eventType: "ADVANCE_RECEIPT", documentType: "DEFAULT", lineKind: "BODY", itemSide: null },
  { eventType: "RECEIPT", documentType: "DEFAULT", lineKind: "BODY", itemSide: null },
  { eventType: "DISBURSEMENT", documentType: "DEFAULT", lineKind: "BODY", itemSide: null },
  ...ITEM_LINKED_SLOTS("SALES", "SALE"),
  ...ITEM_LINKED_SLOTS("PURCHASE", "PURCHASE"),
];

export function slotsOf(eventType: PatternEventType): PostingPatternSlot[] {
  return POSTING_PATTERN_SLOTS.filter((s) => s.eventType === eventType);
}

export function findSlot(eventType: PatternEventType, documentType: string, lineKind: PatternLineKind) {
  return POSTING_PATTERN_SLOTS.find(
    (s) => s.eventType === eventType && s.documentType === documentType && s.lineKind === lineKind,
  );
}

type PostingRule = typeof schema.journalPostingRules.$inferSelect;

const pattern = (
  slot: PostingPatternSlot,
  debit: string | null,
  credit: string | null,
): PostingPattern => ({
  documentType: slot.documentType,
  lineKind: slot.lineKind,
  debitFromItem: slot.itemSide === "DEBIT",
  debitAccountCode: debit,
  creditFromItem: slot.itemSide === "CREDIT",
  creditAccountCode: credit,
});

// journal_posting_rules の役割別の科目から、V-5より前と同じ仕訳になるパターンを組み立てる
export function derivePatternFromRule(slot: PostingPatternSlot, rule: PostingRule | null): PostingPattern {
  const r = rule;
  const code = (key: keyof PostingRule) => (r ? ((r[key] as string | null) ?? null) : null);
  switch (slot.eventType) {
    case "PREPAYMENT": // 前渡金 / 現金預金
      return pattern(slot, code("prepaidAccountCode"), code("cashAccountCode"));
    case "ADVANCE_RECEIPT": // 現金預金 / 前受金
      return pattern(slot, code("cashAccountCode"), code("advanceReceivedAccountCode"));
    case "RECEIPT": // 現金預金 / 売掛金
      return pattern(slot, code("cashAccountCode"), code("receivableAccountCode"));
    case "DISBURSEMENT": // 買掛金 / 現金預金
      return pattern(slot, code("payableAccountCode"), code("cashAccountCode"));
  }

  const isSales = slot.eventType === "SALES";
  const fixed = code(isSales ? "receivableAccountCode" : "payableAccountCode"); // 売掛金 / 買掛金
  const variable = code("variableAccountFallbackCode"); // 売上高 / 仕入高(品目に科目が無い場合)
  const tax = code("taxAccountCode"); // 仮受消費税 / 仮払消費税
  const advance = code(isSales ? "advanceReceivedAccountCode" : "prepaidAccountCode"); // 前受金 / 前渡金
  // 通常(売上・仕入)で借方になる科目を、返品・値引・赤伝(訂正)では貸方にする
  const normal = slot.documentType === (isSales ? "SALE" : "PURCHASE");
  const orient = (salesDebit: string | null, salesCredit: string | null) => {
    const [debit, credit] = isSales ? [salesDebit, salesCredit] : [salesCredit, salesDebit];
    return normal ? pattern(slot, debit, credit) : pattern(slot, credit, debit);
  };

  switch (slot.lineKind) {
    case "BODY": // 売上: 売掛金 / 売上高、仕入: 仕入高 / 買掛金
      return orient(fixed, variable);
    case "TAX": // 売上: 売掛金 / 仮受消費税、仕入: 仮払消費税 / 買掛金
      return orient(fixed, tax);
    case "ADVANCE": // 売上: 前受金 / 売掛金、仕入: 買掛金 / 前渡金
      return orient(advance, fixed);
  }
}

// 事象の全パターン。保存済みの行を優先し、無い組はルールの役割別の科目から組み立てる
export function mergePatterns(
  eventType: PatternEventType,
  rule: PostingRule | null,
  saved: (typeof schema.journalPostingPatterns.$inferSelect)[],
): PostingPattern[] {
  return slotsOf(eventType).map((slot) => {
    const row = saved.find((p) => p.documentType === slot.documentType && p.lineKind === slot.lineKind);
    if (!row) return derivePatternFromRule(slot, rule);
    return {
      documentType: row.documentType,
      lineKind: row.lineKind,
      debitFromItem: row.debitFromItem,
      debitAccountCode: row.debitAccountCode,
      creditFromItem: row.creditFromItem,
      creditAccountCode: row.creditAccountCode,
    };
  });
}

export async function loadPatterns(
  db: D1Database,
  eventType: PatternEventType,
  rule: PostingRule | null,
): Promise<PostingPattern[]> {
  const mainDb = drizzle(db, { schema });
  const saved = await mainDb
    .select()
    .from(schema.journalPostingPatterns)
    .where(eq(schema.journalPostingPatterns.eventType, eventType));
  return mergePatterns(eventType, rule, saved);
}

export const PATTERN_DOCUMENT_TYPE_LABEL: Record<string, string> = {
  DEFAULT: "",
  SALE: "売上",
  PURCHASE: "仕入",
  RETURN: "返品",
  DISCOUNT: "値引",
  CORRECTION: "赤伝(訂正)",
};

export const PATTERN_LINE_KIND_LABEL: Record<PatternLineKind, string> = {
  BODY: "本体",
  TAX: "消費税",
  ADVANCE: "前受・前渡の充当",
};

// 画面・エラーメッセージ用の組の名前(例: 「返品・消費税」)。品目に連動しない事象は「本体」だけ
export function slotLabel(slot: Pick<PostingPatternSlot, "documentType" | "lineKind">): string {
  const doc = PATTERN_DOCUMENT_TYPE_LABEL[slot.documentType] ?? slot.documentType;
  return doc ? `${doc}・${PATTERN_LINE_KIND_LABEL[slot.lineKind]}` : PATTERN_LINE_KIND_LABEL[slot.lineKind];
}
