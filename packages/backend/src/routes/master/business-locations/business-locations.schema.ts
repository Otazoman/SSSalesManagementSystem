import * as v from "valibot";

// 一覧・CSVダウンロード共通の検索クエリ
export const GetBusinessLocationsQuerySchema = v.object({
  id: v.optional(v.string()),
  name: v.optional(v.string()),
  status: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

export type GetBusinessLocationsQuery = v.InferOutput<
  typeof GetBusinessLocationsQuerySchema
>;

// 営業拠点の登録・更新共通ベーススキーマ(倉庫マスタよりFAX・メール・営業時間を除いた簡素な構成)
export const businessLocationUpsertSchema = v.object({
  // マスタコード自動採番: 新規登録時に未入力(null)の場合はサービス層でmaster_code_formatsの
  // 設定に基づき自動採番する(更新時は既存idがそのまま送られてくる想定)
  id: v.optional(v.nullable(v.string())),
  name: v.string("拠点名は必須です"),
  postalCode: v.optional(v.nullable(v.string())),
  address: v.optional(v.nullable(v.string())),
  phoneNumber: v.optional(v.nullable(v.string())),
  status: v.optional(v.string(), "temporary"),
  memo: v.optional(v.nullable(v.string())),
});

// 一括登録(CSV)スキーマ
export const bulkRegisterSchema = v.object({
  csvData: v.string("CSVデータは文字列で指定してください"),
});

export type BusinessLocationUpsertInput = v.InferOutput<
  typeof businessLocationUpsertSchema
>;
export type BulkRegisterInput = v.InferOutput<typeof bulkRegisterSchema>;
