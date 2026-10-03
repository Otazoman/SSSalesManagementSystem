import {
  object,
  string,
  number,
  union,
  optional,
  InferOutput,
} from "valibot";

// リクエストボディのバリデーションスキーマ
export const OtpLogSearchSchema = object({
  startDate: optional(string()),
  endDate: optional(string()),
  email: optional(string()),
  partnerId: optional(string()),
  subject: optional(string()), // 見積(quotes).title
  // Item6 Phase6-4フォローアップ: 種別(sales_quote/shipment_instruction/receipt_instruction)・倉庫
  documentType: optional(string()),
  warehouseId: optional(string()),
  // ページネーション(未指定時は従来通り全件配列を返す。指定時のみ{data,pagination}形式に切り替わる)
  page: optional(union([string(), number()])),
  limit: optional(union([string(), number()])),
  sortBy: optional(string()),
  sortOrder: optional(string()),
});

export type OtpLogSearchRequestBody = InferOutput<typeof OtpLogSearchSchema>;

// CSVダウンロード用(クエリパラメータ経由、検索条件は本体検索と同一項目)
export const OtpLogCsvDownloadQuerySchema = object({
  startDate: optional(string()),
  endDate: optional(string()),
  email: optional(string()),
  partnerId: optional(string()),
  subject: optional(string()),
  documentType: optional(string()),
  warehouseId: optional(string()),
});

export type OtpLogCsvDownloadQuery = InferOutput<
  typeof OtpLogCsvDownloadQuerySchema
>;
