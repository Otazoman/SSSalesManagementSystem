export type JournalEventType =
  | "PREPAYMENT"
  | "PURCHASE"
  | "ADVANCE_RECEIPT"
  | "SALES"
  | "RECEIPT"
  | "DISBURSEMENT";

export type VariableAccountPriority = "ITEM_MASTER_FIRST" | "HEADER_FIRST";

// V-5: 仕訳の組(借方〇〇/貸方〇〇)ごとの科目。組の種類はバックエンドが事象ごとに固定で返す
export type JournalPatternLineKind = "BODY" | "TAX" | "ADVANCE";

export interface JournalPostingPattern {
  documentType: string;
  lineKind: JournalPatternLineKind;
  // true の場合は品目マスタ(明細)の科目を使い、無い場合に accountCode を使う
  debitFromItem: boolean;
  debitAccountCode: string | null;
  creditFromItem: boolean;
  creditAccountCode: string | null;
}

export interface JournalPostingRuleRecord {
  eventType: JournalEventType;
  variableAccountPriority: VariableAccountPriority;
  variableAccountFallbackCode: string | null;
  prepaidAccountCode: string | null;
  advanceReceivedAccountCode: string | null;
  cashAccountCode: string | null;
  payableAccountCode: string | null;
  receivableAccountCode: string | null;
  taxAccountCode: string | null;
  enabled: boolean;
  memo: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  patterns: JournalPostingPattern[];
}

export interface AccountLookup {
  code: string;
  name: string;
}
