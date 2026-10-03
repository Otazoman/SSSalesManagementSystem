import * as v from "valibot";

export const ItemPriceStatusSchema = v.union([
  v.literal("temporary"),
  v.literal("active"),
  v.literal("suspended"),
]);

export type ItemPriceStatus = v.InferOutput<typeof ItemPriceStatusSchema>;

// 一覧取得 クエリパラメータ
export const GetProductPricesQuerySchema = v.object({
  itemId: v.optional(v.string()),
  priceType: v.optional(v.string()),
  partnerId: v.optional(v.string()),
  quantity: v.optional(v.string()),
  status: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// 個別登録・更新 ボディ
export const RegisterProductPriceSchema = v.object({
  id: v.optional(v.string()),
  itemId: v.pipe(v.string(), v.minLength(1, "itemIdは必須です")),
  priceType: v.pipe(v.string(), v.minLength(1, "priceTypeは必須です")),
  partnerId: v.optional(v.nullable(v.string())),
  minQuantity: v.optional(v.union([v.number(), v.string()]), 0),
  unitPrice: v.optional(v.union([v.number(), v.string()]), 0),
  unitCode: v.optional(v.string(), "PCS"),
  status: v.optional(ItemPriceStatusSchema),
});

export type RegisterProductPriceInput = v.InferOutput<
  typeof RegisterProductPriceSchema
>;
