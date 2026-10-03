import * as v from "valibot";
import { requiredString } from "../../../platform/validation/common-schema";

// Item9 Phase7: 発注点/安全在庫マスタ(品目×倉庫単位)の登録・更新用バリデーションスキーマ
export const ItemReorderSettingPayloadSchema = v.object({
  itemId: requiredString("品目は必須です。"),
  warehouseId: requiredString("倉庫は必須です。"),
  reorderPoint: v.pipe(v.number(), v.minValue(0, "発注点は0以上で入力してください。")),
  safetyStock: v.pipe(v.number(), v.minValue(0, "安全在庫は0以上で入力してください。")),
  memo: v.optional(v.nullable(v.string())),
});

export type ItemReorderSettingPayload = v.InferOutput<typeof ItemReorderSettingPayloadSchema>;
