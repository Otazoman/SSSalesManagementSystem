import * as v from "valibot";
import { stockQualityStatusSchema } from "../../../constants/stock-transaction-types";

export const createReclassificationSchema = v.pipe(
  v.object({
    itemId: v.string("品目IDは必須です"),
    warehouseId: v.string("倉庫IDは必須です"),
    locationId: v.string("ロケーションIDは必須です"),
    lotNumber: v.optional(v.string(), "NONE"),
    accountCode: v.optional(v.nullable(v.string())),
    fromQualityStatus: stockQualityStatusSchema,
    toQualityStatus: stockQualityStatusSchema,
    quantity: v.pipe(
      v.number("数量は数値で指定してください"),
      v.minValue(0.001, "数量は0より大きい値を指定してください"),
    ),
    memo: v.optional(v.nullable(v.string())),
    // 追加要望F: 申請者が複数部門に所属する場合に選択した申請部門(任意)
    applicantDepartmentSurrogateId: v.optional(v.nullable(v.string())),
  }),
  v.check(
    (input) => input.fromQualityStatus !== input.toQualityStatus,
    "変更元と変更先の品質区分は異なる値を指定してください",
  ),
);

export type CreateReclassificationInput = v.InferOutput<typeof createReclassificationSchema>;

// 品質区分変更履歴一覧の検索クエリ
export const GetReclassificationsQuerySchema = v.object({
  status: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  createdBy: v.optional(v.string()),
});

export type GetReclassificationsQuery = v.InferOutput<typeof GetReclassificationsQuerySchema>;
