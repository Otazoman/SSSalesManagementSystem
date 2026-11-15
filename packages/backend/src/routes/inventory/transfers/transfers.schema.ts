import * as v from "valibot";

// REQ-006: 倉庫間移動の入力
export const CreateStockTransferSchema = v.object({
  sourceWarehouseId: v.pipe(v.string("移動元の倉庫は必須です"), v.minLength(1, "移動元の倉庫は必須です")),
  destinationWarehouseId: v.pipe(v.string("移動先の倉庫は必須です"), v.minLength(1, "移動先の倉庫は必須です")),
  shippedDate: v.pipe(v.string("出庫日は必須です"), v.minLength(1, "出庫日は必須です")),
  memo: v.optional(v.nullable(v.string())),
  items: v.pipe(
    v.array(
      v.object({
        itemId: v.pipe(v.string("品目は必須です"), v.minLength(1, "品目は必須です")),
        // 移動元が自社倉庫の時は必須(外部倉庫の時は、出荷指示の実績で決まる)
        locationId: v.optional(v.nullable(v.string())),
        lotNumber: v.optional(v.nullable(v.string())),
        qualityStatus: v.optional(v.nullable(v.string())),
        quantity: v.pipe(v.number("数量は数値で指定してください"), v.minValue(0.001, "数量は0より大きい値を指定してください")),
      }),
    ),
    v.minLength(1, "明細を1件以上指定してください"),
  ),
  applicantDepartmentSurrogateId: v.optional(v.nullable(v.string())),
});
export type CreateStockTransferInput = v.InferOutput<typeof CreateStockTransferSchema>;

// 移動先(自社倉庫)での入庫。輸送中の残りまで、何回かに分けてできる
export const ReceiveStockTransferSchema = v.object({
  receivedDate: v.pipe(v.string("入庫日は必須です"), v.minLength(1, "入庫日は必須です")),
  items: v.pipe(
    v.array(
      v.object({
        transferItemId: v.pipe(v.string(), v.minLength(1, "移動の明細は必須です")),
        locationId: v.pipe(v.string("ロケーションは必須です"), v.minLength(1, "ロケーションは必須です")),
        quantity: v.pipe(v.number("数量は数値で指定してください"), v.minValue(0.001, "数量は0より大きい値を指定してください")),
        inspectionStatus: v.optional(v.picklist(["PASSED", "DAMAGED", "QUARANTINE"]), "PASSED"),
      }),
    ),
    v.minLength(1, "明細を1件以上指定してください"),
  ),
  applicantDepartmentSurrogateId: v.optional(v.nullable(v.string())),
});
export type ReceiveStockTransferInput = v.InferOutput<typeof ReceiveStockTransferSchema>;

export const CloseStockTransferSchema = v.object({
  reason: v.pipe(v.string("理由は必須です"), v.trim(), v.minLength(1, "差異で完了する理由は必須です")),
});
export type CloseStockTransferInput = v.InferOutput<typeof CloseStockTransferSchema>;

export const SearchStockTransfersQuerySchema = v.object({
  status: v.optional(v.string()),
  warehouseId: v.optional(v.string()),
  keyword: v.optional(v.string()),
});
export type SearchStockTransfersQuery = v.InferOutput<typeof SearchStockTransfersQuerySchema>;
