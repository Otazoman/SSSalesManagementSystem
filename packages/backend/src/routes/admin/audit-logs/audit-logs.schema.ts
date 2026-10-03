import * as v from "valibot";

// 検索リクエストボディのバリデーション定義
export const searchAuditLogsSchema = v.object({
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  userId: v.optional(
    v.pipe(
      v.string(),
      v.transform((s) => s.trim()),
    ),
  ),
  resourceKey: v.optional(
    v.pipe(
      v.string(),
      v.transform((s) => s.trim()),
    ),
  ),
  action: v.optional(
    v.pipe(
      v.string(),
      v.transform((s) => s.trim()),
    ),
  ),
  // ページネーション(未指定時は従来通り全件配列を返す。指定時のみ{data,pagination}形式に切り替わる)
  page: v.optional(v.union([v.string(), v.number()])),
  limit: v.optional(v.union([v.string(), v.number()])),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// スキーマから抽出した検索用型
export type SearchRequestBody = v.InferOutput<typeof searchAuditLogsSchema>;

// CSVダウンロード用(クエリパラメータ経由、検索条件は本体検索と同一項目)
export const csvDownloadQuerySchema = v.object({
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  userId: v.optional(v.string()),
  resourceKey: v.optional(v.string()),
  action: v.optional(v.string()),
});

export type CsvDownloadQuery = v.InferOutput<typeof csvDownloadQuerySchema>;
