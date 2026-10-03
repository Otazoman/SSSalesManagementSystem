import type { JournalPair } from "../../_components/JournalPairTable";

export type JournalBatchType = "ORIGINAL" | "REVERSAL" | "CORRECTION";

export interface JournalLineRecord {
  id: string;
  batchId: string;
  lineNo: number;
  side: "DEBIT" | "CREDIT";
  accountCode: string;
  accountName: string;
  externalMappingCode: string | null;
  amount: number;
  taxCategoryCode: string | null;
  taxRate: number | null;
  itemId: string | null;
  itemName: string | null;
  sourceRefItemId: string | null;
  memo: string | null;
}

export interface JournalBatchRecord {
  id: string;
  entryDate: string;
  description: string;
  sourceType: string;
  sourceRefId: string;
  eventType: string;
  totalDebitAmount: number;
  totalCreditAmount: number;
  reversalOfBatchId: string | null;
  correctionOfBatchId: string | null;
  memo: string | null;
  postedById: string;
  postedAt: string;
  type: JournalBatchType;
  // V-5: 「借方〇〇/貸方〇〇」の組(バックエンドが明細から組み立てる)
  pairs: JournalPair<JournalLineRecord>[];
}

export interface JournalBatchChainEntry extends JournalBatchRecord {
  lines: JournalLineRecord[];
}

export interface JournalBatchDetail extends JournalBatchRecord {
  lines: JournalLineRecord[];
  // 同一系列(元バッチ→反対仕訳→訂正仕訳…)の全バッチ。postedAt昇順
  chain: JournalBatchChainEntry[];
}

// 勘定科目選択用(訂正フォームのドロップダウン)
export interface AccountLookup {
  code: string;
  name: string;
}

export interface CorrectLineForm {
  lineId: string;
  side: "DEBIT" | "CREDIT";
  originalAccountCode: string;
  originalAccountName: string;
  amount: number;
  taxCategoryCode: string | null;
  accountCode: string;
}
