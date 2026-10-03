export const JOURNAL_EXPORT_COLUMN_KEYS = [
  "batchId",
  "entryDate",
  "description",
  "classification",
  "sourceType",
  "sourceRefId",
  "eventType",
  "side",
  "accountCode",
  "accountName",
  "externalMappingCode",
  "amount",
  "taxCategoryCode",
  "taxRate",
  "itemId",
  "itemName",
  "sourceRefItemId",
  "projectId",
  "projectName",
  "department",
  "lineMemo",
  "batchMemo",
  "postedById",
  "postedAt",
  "originalBatchId",
  "baseSourceRefId",
  "debitAccountCode",
  "debitAccountName",
  "debitExternalMappingCode",
  "debitAmount",
  "debitTaxCategoryCode",
  "debitTaxRate",
  "creditAccountCode",
  "creditAccountName",
  "creditExternalMappingCode",
  "creditAmount",
  "creditTaxCategoryCode",
  "creditTaxRate",
] as const;

export type JournalExportColumnKey = (typeof JOURNAL_EXPORT_COLUMN_KEYS)[number];

export interface JournalExportColumn {
  key: JournalExportColumnKey;
  label: string;
  enabled: boolean;
}

export interface JournalExportFormat {
  columns: JournalExportColumn[];
  delimiter: "," | "\t" | ";";
  dateFormat: "YYYY-MM-DD" | "YYYY/MM/DD" | "MM/DD/YYYY";
  includeHeaderRow: boolean;
  // CSVの1行の単位。LINE=仕訳の明細1行(借方か貸方の片側)、PAIR=「借方〇〇/貸方〇〇」の組
  layout: JournalExportLayout;
}

export type JournalExportLayout = "LINE" | "PAIR";

// 1行=片側の形式でだけ意味のある列と、1行=組の形式でだけ意味のある列。
// 1行の単位を切り替えたときに、出力する列をまとめて切り替えるのに使う
export const LINE_LAYOUT_COLUMN_KEYS: JournalExportColumnKey[] = [
  "side",
  "accountCode",
  "accountName",
  "externalMappingCode",
  "amount",
  "taxCategoryCode",
  "taxRate",
];
export const PAIR_LAYOUT_COLUMN_KEYS: JournalExportColumnKey[] = [
  "debitAccountCode",
  "debitAccountName",
  "debitAmount",
  "debitTaxCategoryCode",
  "creditAccountCode",
  "creditAccountName",
  "creditAmount",
  "creditTaxCategoryCode",
];
