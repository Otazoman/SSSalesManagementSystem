import * as v from "valibot";
import { JOURNAL_SOURCE_KINDS } from "../../../platform/journal/journal-sources";

// 未転記の伝票の一覧(V-4: 伝票を選んで仕訳を作る)
export const listJournalSourcesQuerySchema = v.object({
  kind: v.picklist(JOURNAL_SOURCE_KINDS, "伝票の種別が不正です"),
  startDate: v.optional(v.pipe(v.string(), v.isoDate("開始日の形式が不正です(YYYY-MM-DD)"))),
  endDate: v.optional(v.pipe(v.string(), v.isoDate("終了日の形式が不正です(YYYY-MM-DD)"))),
  partnerId: v.optional(v.string()),
  limit: v.optional(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(500))),
});

// 選んだ1件の伝票を仕訳にする
export const postJournalSourceSchema = v.object({
  kind: v.picklist(JOURNAL_SOURCE_KINDS, "伝票の種別が不正です"),
  sourceRefId: v.pipe(v.string(), v.minLength(1, "伝票IDは必須です")),
  // 売上(sales_invoice)のみ: 単体入金の前受金を充当する(借方=前受金/貸方=売掛金。V-5)。
  // 受注の前受済み(全額充当)とは別に、単体入金ごとの充当額を指定する
  advanceApplications: v.optional(
    v.array(
      v.object({
        cashReceiptId: v.pipe(v.string(), v.minLength(1)),
        amount: v.pipe(v.number(), v.integer("充当額は整数で指定してください"), v.minValue(1, "充当額は1円以上で指定してください")),
      }),
    ),
  ),
});

// 充当できる単体入金(前受金として仕訳済みで、未充当残がある)の一覧
export const listAdvanceCandidatesQuerySchema = v.object({
  partnerId: v.pipe(v.string(), v.minLength(1, "取引先IDは必須です")),
});

export type ListJournalSourcesQueryInput = v.InferOutput<typeof listJournalSourcesQuerySchema>;
export type PostJournalSourceInput = v.InferOutput<typeof postJournalSourceSchema>;
