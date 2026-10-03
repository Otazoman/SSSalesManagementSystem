import * as v from "valibot";
import { requiredString } from "../../../platform/validation/common-schema";

// 登録・更新用バリデーションスキーマ
export const saveTaxCategorySchema = v.object({
  code: requiredString("税区分コードは必須です。"),
  name: requiredString("税区分名称は必須です。"),
  taxType: v.union([
    v.literal("EXEMPT"),
    v.literal("STANDARD"),
    v.literal("VARIABLE"),
  ]),
  taxRate: v.number(),
  validFrom: v.optional(v.nullable(v.string())),
  validTo: v.optional(v.nullable(v.string())),
});

export type SaveTaxCategoryInput = v.InferOutput<typeof saveTaxCategorySchema>;
