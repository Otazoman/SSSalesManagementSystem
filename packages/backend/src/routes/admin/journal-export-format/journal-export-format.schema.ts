import * as v from "valibot";

// Item11-2: 仕訳データCSV出力(Item11-1)の列構成をカスタマイズするための設定。
// 出力可能な列は固定(内部で計算するデータの種類自体は変わらない)だが、
// どの列を・どの順で・どんな見出し名で出力するかは自由に設定できる
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
  // Item11-3: 訂正チェーンの追跡用(既存の保存済みフォーマットには既定OFFで補完される)
  "originalBatchId",
  "baseSourceRefId",
  // V-5: 借方・貸方を1行に並べる形式(layout=PAIR)用の列。1行=片側の形式では、その行の側の列だけ値が入る
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

// Item11-3で追加した列。既存の出力結果を変えないため、未設定・補完時は既定でOFFにする
export const JOURNAL_EXPORT_OPTIONAL_COLUMN_KEYS: ReadonlySet<string> = new Set([
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
]);

// V-5: CSVの1行の単位。LINE=仕訳の明細1行(借方か貸方の片側。従来の形)、PAIR=「借方〇〇/貸方〇〇」の組
export const JOURNAL_EXPORT_LAYOUTS = ["LINE", "PAIR"] as const;
export type JournalExportLayout = (typeof JOURNAL_EXPORT_LAYOUTS)[number];

export type JournalExportColumnKey = (typeof JOURNAL_EXPORT_COLUMN_KEYS)[number];

export const JournalExportColumnSchema = v.object({
  key: v.picklist(JOURNAL_EXPORT_COLUMN_KEYS),
  label: v.pipe(v.string(), v.minLength(1, "見出し名は必須です")),
  enabled: v.boolean(),
});

export const JournalExportFormatSchema = v.object({
  // 出力順=配列の順。JOURNAL_EXPORT_COLUMN_KEYSの全キーをちょうど1回ずつ含む必要がある
  // (存在チェック・重複チェックはservice側で行う。値自体の形はvalibotで担保する)
  columns: v.pipe(v.array(JournalExportColumnSchema), v.minLength(1, "列を1件以上指定してください")),
  delimiter: v.picklist([",", "\t", ";"]),
  dateFormat: v.picklist(["YYYY-MM-DD", "YYYY/MM/DD", "MM/DD/YYYY"]),
  includeHeaderRow: v.boolean(),
  // 省略時は従来どおり LINE(保存済みのフォーマットにも無いため、読み込み時に補う)
  layout: v.optional(v.picklist(JOURNAL_EXPORT_LAYOUTS), "LINE"),
});

export type JournalExportFormat = v.InferOutput<typeof JournalExportFormatSchema>;
