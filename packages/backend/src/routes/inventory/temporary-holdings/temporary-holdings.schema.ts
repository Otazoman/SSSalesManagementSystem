import * as v from "valibot";

// REQ-011(2): 一時保管の台帳の入力
export const HOLDING_CATEGORIES = ["OWN", "CUSTODY"] as const;

const positiveQuantity = v.pipe(
  v.number("数量は数値で指定してください"),
  v.minValue(0.001, "数量は0より大きい値を指定してください"),
);

// 受入(新しい台帳の行を作る)
export const ReceiveTemporaryHoldingSchema = v.object({
  category: v.picklist(HOLDING_CATEGORIES, "区分(自社品・預り品)を指定してください"),
  itemName: v.pipe(v.string("品名は必須です"), v.trim(), v.minLength(1, "品名は必須です")),
  spec: v.optional(v.nullable(v.string())),
  quantity: positiveQuantity,
  unitName: v.optional(v.nullable(v.string())),
  warehouseId: v.pipe(v.string("倉庫は必須です"), v.minLength(1, "倉庫は必須です")),
  locationId: v.optional(v.nullable(v.string())),
  partnerId: v.optional(v.nullable(v.string())),
  receivedDate: v.pipe(v.string("受入日は必須です"), v.minLength(1, "受入日は必須です")),
  plannedReleaseDate: v.optional(v.nullable(v.string())),
  // 発注の直接入力の明細から受け入れる場合(発注の「入荷済数量」には数えない)
  purchaseOrderId: v.optional(v.nullable(v.string())),
  purchaseOrderItemId: v.optional(v.nullable(v.string())),
  memo: v.optional(v.nullable(v.string())),
});
export type ReceiveTemporaryHoldingInput = v.InferOutput<typeof ReceiveTemporaryHoldingSchema>;

// 払出
export const ReleaseTemporaryHoldingSchema = v.object({
  quantity: positiveQuantity,
  movementDate: v.pipe(v.string("払出日は必須です"), v.minLength(1, "払出日は必須です")),
  memo: v.optional(v.nullable(v.string())),
  // 受注の直接入力の明細に紐づけて払い出す場合
  salesOrderId: v.optional(v.nullable(v.string())),
  salesOrderItemId: v.optional(v.nullable(v.string())),
});
export type ReleaseTemporaryHoldingInput = v.InferOutput<typeof ReleaseTemporaryHoldingSchema>;

// 数量の調整(増やす時は+、減らす時は−)
export const AdjustTemporaryHoldingSchema = v.object({
  quantity: v.pipe(
    v.number("数量は数値で指定してください"),
    v.check((n) => n !== 0, "調整する数量は0以外を指定してください"),
  ),
  movementDate: v.pipe(v.string("調整日は必須です"), v.minLength(1, "調整日は必須です")),
  memo: v.pipe(v.string("調整の理由は必須です"), v.trim(), v.minLength(1, "調整の理由は必須です")),
});
export type AdjustTemporaryHoldingInput = v.InferOutput<typeof AdjustTemporaryHoldingSchema>;

// REQ-011(3): 自社品を品目マスタの品目として在庫へ移す(残りの数量で入庫を作る)
export const MoveTemporaryHoldingToStockSchema = v.object({
  itemId: v.pipe(v.string("品目は必須です"), v.minLength(1, "品目は必須です")),
  locationId: v.pipe(v.string("ロケーションは必須です"), v.minLength(1, "ロケーションは必須です")),
  lotNumber: v.optional(v.string(), "NONE"),
  receivedDate: v.pipe(v.string("入庫日は必須です"), v.minLength(1, "入庫日は必須です")),
  applicantDepartmentSurrogateId: v.optional(v.nullable(v.string())),
});
export type MoveTemporaryHoldingToStockInput = v.InferOutput<typeof MoveTemporaryHoldingToStockSchema>;

export const SearchTemporaryHoldingsQuerySchema = v.object({
  category: v.optional(v.string()),
  status: v.optional(v.string()),
  warehouseId: v.optional(v.string()),
  partnerId: v.optional(v.string()),
  keyword: v.optional(v.string()),
});
export type SearchTemporaryHoldingsQuery = v.InferOutput<typeof SearchTemporaryHoldingsQuerySchema>;
