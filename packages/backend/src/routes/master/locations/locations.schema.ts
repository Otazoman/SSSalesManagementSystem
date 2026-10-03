import * as v from "valibot";

// GET / 検索クエリ
export const GetLocationsQuerySchema = v.object({
  id: v.optional(v.string()),
  warehouseId: v.optional(v.string()),
  name: v.optional(v.string()),
  status: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// POST /register 登録ボディ
export const RegisterLocationBodySchema = v.object({
  id: v.pipe(v.string(), v.minLength(1, "ロケーションIDは必須です")),
  warehouseId: v.pipe(v.string(), v.minLength(1, "倉庫IDは必須です")),
  name: v.pipe(v.string(), v.minLength(1, "ロケーション名は必須です")),
  memo: v.optional(v.nullable(v.string())),
});

// PUT /:id 更新ボディ
export const UpdateLocationBodySchema = v.object({
  warehouseId: v.pipe(v.string(), v.minLength(1, "倉庫IDは必須です")),
  name: v.pipe(v.string(), v.minLength(1, "ロケーション名は必須です")),
  memo: v.optional(v.nullable(v.string())),
  status: v.pipe(v.string(), v.minLength(1, "ステータスは必須です")),
});

// パラメータ (:id)
export const IdParamSchema = v.object({
  id: v.string(),
});

export type GetLocationsQuery = v.InferOutput<typeof GetLocationsQuerySchema>;
export type RegisterLocationInput = v.InferOutput<
  typeof RegisterLocationBodySchema
>;
export type UpdateLocationInput = v.InferOutput<
  typeof UpdateLocationBodySchema
>;
