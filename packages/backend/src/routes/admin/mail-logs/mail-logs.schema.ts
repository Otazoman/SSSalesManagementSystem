import {
  object,
  string,
  number,
  union,
  optional,
  pipe,
  transform,
  InferOutput,
} from "valibot";

// リクエストボディのバリデーションスキーマ
export const MailSearchSchema = object({
  startDate: optional(string()),
  endDate: optional(string()),
  documentId: optional(string()),
  keyword: optional(string()),
  status: optional(string()), // 'PENDING'|'PROCESSING'|'SUCCESS'|'FAILED'|'all'(未指定含む)
  // ページネーション(未指定時は従来通り全件配列を返す。指定時のみ{data,pagination}形式に切り替わる)
  page: optional(union([string(), number()])),
  limit: optional(union([string(), number()])),
  sortBy: optional(string()),
  sortOrder: optional(string()),
});

// Valibot のスキーマから TypeScript 型を自動抽出
export type MailSearchRequestBody = InferOutput<typeof MailSearchSchema>;

// CSVダウンロード用(クエリパラメータ経由、検索条件は本体検索と同一項目)
export const csvDownloadQuerySchema = object({
  startDate: optional(string()),
  endDate: optional(string()),
  documentId: optional(string()),
  keyword: optional(string()),
  status: optional(string()),
});

export type CsvDownloadQuery = InferOutput<typeof csvDownloadQuerySchema>;
