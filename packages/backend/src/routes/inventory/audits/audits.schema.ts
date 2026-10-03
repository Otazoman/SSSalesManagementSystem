import * as v from "valibot";

export const createAuditSchema = v.object({
  itemId: v.string("品目IDは必須です"),
  warehouseId: v.string("倉庫IDは必須です"),
  locationId: v.string("ロケーションIDは必須です"),
  lotNumber: v.optional(v.string(), "NONE"),
  accountCode: v.optional(v.nullable(v.string())),
  qualityStatus: v.optional(v.string(), "NORMAL"),
  countedQuantity: v.pipe(v.number("実棚数量は数値で指定してください"), v.minValue(0, "実棚数量は0以上を指定してください")),
  memo: v.optional(v.nullable(v.string())),
  // 追加要望F: 申請者が複数部門に所属する場合に選択した申請部門(任意)
  applicantDepartmentSurrogateId: v.optional(v.nullable(v.string())),
});

export type CreateAuditInput = v.InferOutput<typeof createAuditSchema>;

// 棚卸履歴一覧の検索クエリ
export const GetAuditsQuerySchema = v.object({
  status: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  createdBy: v.optional(v.string()),
  // 追加要望J-2-j: 品目・ロケーションによる検索
  itemId: v.optional(v.string()),
  locationId: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

export type GetAuditsQuery = v.InferOutput<typeof GetAuditsQuerySchema>;

// CSV一括登録(1行=1棚卸)
export const bulkRegisterAuditSchema = v.object({
  csvData: v.string("CSVデータは文字列で指定してください"),
});

export type BulkRegisterAuditInput = v.InferOutput<typeof bulkRegisterAuditSchema>;
