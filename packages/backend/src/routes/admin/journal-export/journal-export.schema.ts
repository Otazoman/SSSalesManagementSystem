import * as v from "valibot";

// Item11-1: 仕訳データCSV出力の検索条件。既存のK-6一覧(journal-batches.schema.ts)の
// SearchJournalBatchQuerySchemaと同じ条件セット(ソート指定は出力には不要なため除く)
export const JournalExportQuerySchema = v.object({
  sourceType: v.optional(v.string()),
  eventType: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  // "true"の場合、反対仕訳・訂正仕訳を除いた元バッチ(未訂正含む)のみに絞り込む
  onlyOriginal: v.optional(v.string()),
});

export type JournalExportQuery = v.InferOutput<typeof JournalExportQuerySchema>;
