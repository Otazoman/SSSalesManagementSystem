import * as v from "valibot";

// Phase6: 承認機能展開。他マスタ(product-prices等)と同じtemporary/active/suspendedの3値
export const ItemStructureStatusSchema = v.union([
  v.literal("temporary"),
  v.literal("active"),
  v.literal("suspended"),
]);

export type ItemStructureStatus = v.InferOutput<typeof ItemStructureStatusSchema>;

// GET / 検索クエリ
export const GetItemStructuresQuerySchema = v.object({
  parentItemId: v.optional(v.string()),
  childItemId: v.optional(v.string()),
  revision: v.optional(v.string()),
  // 画面の期間タブ(現行有効/期限切れ/将来適用/全て)と同じ動的な期間判定。現在時刻基準。
  periodStatus: v.optional(
    v.picklist(["current", "expired", "future", "all"]),
  ),
  status: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// POST /register 登録ボディ
export const RegisterItemStructureBodySchema = v.object({
  parentItemId: v.pipe(v.string(), v.minLength(1, "親品目は必須です")),
  childItemId: v.pipe(v.string(), v.minLength(1, "構成部品(子品目)は必須です")),
  revision: v.optional(v.string()),
  quantityRequired: v.optional(v.union([v.number(), v.string()])),
  validFrom: v.optional(v.nullable(v.string())),
  validTo: v.optional(v.nullable(v.string())),
  memo: v.optional(v.nullable(v.string())),
  status: v.optional(ItemStructureStatusSchema),
});

// DELETE /:id パラメータ
export const IdParamSchema = v.object({
  id: v.string(),
});

export type GetItemStructuresQuery = v.InferOutput<
  typeof GetItemStructuresQuerySchema
>;
export type RegisterItemStructureInput = v.InferOutput<
  typeof RegisterItemStructureBodySchema
>;
