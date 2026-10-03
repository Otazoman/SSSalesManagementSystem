import * as v from "valibot";

// K-6-2: 訂正可能項目は勘定科目(借方・貸方)・摘要・メモのみ(確定)。金額・消費税区分・税率は
// 対象外(元伝票との整合性が崩れるため)。対象バッチの全明細行についてaccountCodeを指定する
export const CorrectJournalBatchLineSchema = v.object({
  lineId: v.string(),
  accountCode: v.string(),
});

export const CorrectJournalBatchPayloadSchema = v.object({
  description: v.optional(v.string()),
  memo: v.optional(v.nullable(v.string())),
  lines: v.pipe(
    v.array(CorrectJournalBatchLineSchema),
    v.minLength(1, "明細を1件以上指定してください"),
  ),
});

export const SearchJournalBatchQuerySchema = v.object({
  sourceType: v.optional(v.string()),
  eventType: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  // "true"の場合、反対仕訳・訂正仕訳を除いた元バッチ(未訂正含む)のみに絞り込む
  onlyOriginal: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

export type CorrectJournalBatchPayload = v.InferOutput<typeof CorrectJournalBatchPayloadSchema>;
export type SearchJournalBatchQuery = v.InferOutput<typeof SearchJournalBatchQuerySchema>;
