import * as v from "valibot";

// 現在庫一覧の検索クエリ
export const GetStocksQuerySchema = v.object({
  itemId: v.optional(v.string()),
  warehouseId: v.optional(v.string()),
  locationId: v.optional(v.string()),
  qualityStatus: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

export type GetStocksQuery = v.InferOutput<typeof GetStocksQuerySchema>;
