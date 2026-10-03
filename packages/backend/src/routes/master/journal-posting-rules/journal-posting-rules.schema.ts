import * as v from "valibot";

// journal-schema.tsのjournal_batches.eventTypeと対応する会計事象(固定。行の増減はしない)。
// 前払・仕入計上・前受・売上計上に加え、V-4で入金(入金消込)・支払(支払消込)を追加した
export const JOURNAL_EVENT_TYPES = [
  "PREPAYMENT",
  "PURCHASE",
  "ADVANCE_RECEIPT",
  "SALES",
  "RECEIPT",
  "DISBURSEMENT",
] as const;
export type JournalEventType = (typeof JOURNAL_EVENT_TYPES)[number];

export const JournalEventTypeSchema = v.picklist(JOURNAL_EVENT_TYPES);

// 更新用ボディ。eventType自体はURLパラメータで指定するためここには含めない。
// 空文字/未指定はサービス層でnull(未設定)へ正規化する(purchase-order.schema.tsのoptionalStringと同じ方針)
const optionalAccountCode = v.optional(v.nullable(v.string()));

// V-5: 仕訳パターン(組ごとの借方・貸方の科目)。組の種類は platform/journal/posting-patterns.ts で固定
export const JournalPostingPatternInputSchema = v.object({
  documentType: v.pipe(v.string(), v.minLength(1)),
  lineKind: v.picklist(["BODY", "TAX", "ADVANCE"]),
  debitFromItem: v.optional(v.boolean(), false),
  debitAccountCode: optionalAccountCode,
  creditFromItem: v.optional(v.boolean(), false),
  creditAccountCode: optionalAccountCode,
});

export const UpdateJournalPostingRuleSchema = v.object({
  variableAccountPriority: v.optional(
    v.picklist(["ITEM_MASTER_FIRST", "HEADER_FIRST"]),
    "ITEM_MASTER_FIRST",
  ),
  // 以下の役割別の科目は、V-5より前の設定方法。patterns を省略した場合だけ、ここから組を組み立てる
  variableAccountFallbackCode: optionalAccountCode,
  prepaidAccountCode: optionalAccountCode,
  advanceReceivedAccountCode: optionalAccountCode,
  cashAccountCode: optionalAccountCode,
  payableAccountCode: optionalAccountCode,
  receivableAccountCode: optionalAccountCode,
  taxAccountCode: optionalAccountCode,
  enabled: v.optional(v.boolean(), false),
  memo: v.optional(v.nullable(v.string())),
  // V-5: 組ごとの借方・貸方の科目。指定した組だけ上書きし、指定しない組は役割別の科目から組み立てる
  patterns: v.optional(v.array(JournalPostingPatternInputSchema)),
});

export type JournalPostingPatternInput = v.InferOutput<typeof JournalPostingPatternInputSchema>;

export type UpdateJournalPostingRuleInput = v.InferOutput<typeof UpdateJournalPostingRuleSchema>;
