import * as v from "valibot";

// 一覧・CSVダウンロード共通の検索クエリ
export const GetWarehousesQuerySchema = v.object({
  id: v.optional(v.string()),
  name: v.optional(v.string()),
  status: v.optional(v.string()),
  // REQ-005: "true" の時だけ、直送用の倉庫(区分「直送」)も含める(倉庫マスタの一覧など)
  includeDirect: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

export type GetWarehousesQuery = v.InferOutput<typeof GetWarehousesQuerySchema>;

// 添付ファイルのスキーマ
export const warehouseAttachmentSchema = v.object({
  id: v.optional(v.string()),
  fileName: v.string(),
  storageType: v.optional(v.string(), "R2"),
  attachmentR2Path: v.optional(v.nullable(v.string())),
  externalUrl: v.optional(v.nullable(v.string())),
  fileType: v.optional(v.string(), "OTHER"),
});

// 受付可能日のスキーマ
export const warehouseAvailableDaySchema = v.object({
  availabledayOfWeek: v.optional(v.string()),
  availableDayOfWeek: v.optional(v.string()),
  timeSlotMemo: v.optional(v.nullable(v.string())),
});

// 倉庫の登録・更新共通ベーススキーマ
export const warehouseUpsertSchema = v.object({
  // マスタコード自動採番: 新規登録時に未入力(null)の場合はサービス層でmaster_code_formatsの
  // 設定に基づき自動採番する(更新時は既存idがそのまま送られてくる想定のため引き続き必須級で運用される)
  id: v.optional(v.nullable(v.string())),
  name: v.string("倉庫名は必須です"),
  postalCode: v.optional(v.nullable(v.string())),
  address: v.optional(v.nullable(v.string())),
  phoneNumber: v.optional(v.nullable(v.string())),
  faxNumber: v.optional(v.nullable(v.string())),
  email: v.nullable(
    v.pipe(v.string(), v.email("不正なメールアドレス形式です")),
  ),
  businessStartTime: v.optional(v.nullable(v.string())),
  businessEndTime: v.optional(v.nullable(v.string())),
  storageRestrictions: v.optional(v.nullable(v.string())),
  // REQ-005: DIRECT(直送)は直送完了の記録用。システムが自動で作る(倉庫マスタでの名前の変更などのため受け付ける)
  warehouseType: v.optional(v.picklist(["INTERNAL", "EXTERNAL", "DIRECT"]), "INTERNAL"),
  status: v.optional(v.string(), "temporary"),
  memo: v.optional(v.nullable(v.string())),
  availableDays: v.optional(v.array(warehouseAvailableDaySchema)),
  attachments: v.optional(v.array(warehouseAttachmentSchema)),
});

// 一括登録（CSV）スキーマ
export const bulkRegisterSchema = v.object({
  csvData: v.string("CSVデータは文字列で指定してください"),
});

export type WarehouseUpsertInput = v.InferOutput<typeof warehouseUpsertSchema>;
export type BulkRegisterInput = v.InferOutput<typeof bulkRegisterSchema>;
