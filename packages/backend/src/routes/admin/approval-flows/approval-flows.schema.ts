import * as v from "valibot";
import { requiredString } from "../../../platform/validation/common-schema";

// ステップ単体の定義
export const stepSchema = v.object({
  approverRoleId: requiredString("承認者ロールIDは必須です"),
  targetDepartmentSurrogateId: v.optional(v.nullable(v.string())),
  stepName: v.optional(v.nullable(v.string())),
  memo: v.optional(v.nullable(v.string())),
});

// フロー作成・更新のリクエストボディ定義
export const createApprovalFlowSchema = v.object({
  name: v.pipe(
    v.string("名前は文字列で指定してください"),
    v.transform((s) => s.trim()),
    v.nonEmpty("名前は必須です"),
  ),
  requestType: requiredString("申請種別は必須です"),
  minAmount: v.optional(
    v.pipe(
      v.unknown(),
      v.transform((val) => Number(val) || 0),
    ),
    0,
  ),
  maxAmount: v.optional(
    v.pipe(
      v.unknown(),
      v.transform((val) => Number(val) || 0),
    ),
    0,
  ),
  steps: v.pipe(
    v.array(stepSchema),
    v.minLength(1, "ステップは1つ以上指定してください"),
  ),
  // 💡 isActive を追加（任意フィールド）
  isActive: v.optional(v.boolean()),
  // Item9 Phase2: 金額レンジに加え、申請payload内の任意フィールドでも分岐できる汎用マッチ軸(任意)。
  matchField: v.optional(v.nullable(v.string())),
  matchValue: v.optional(v.nullable(v.string())),
});

// Valibotスキーマから型を抽出
export type CreateApprovalFlowInput = v.InferOutput<
  typeof createApprovalFlowSchema
>;

// 新規要望: 承認フローの申請経路プレビュー(2026-09-22確定)のクエリパラメータ定義
export const previewRouteQuerySchema = v.object({
  userId: requiredString("ユーザーは必須です"),
  targetType: requiredString("書類種別は必須です"),
  amount: v.pipe(
    v.string("金額は必須です"),
    v.transform((val) => Number(val)),
    v.number("金額は数値で指定してください"),
    v.minValue(0, "金額は0以上で指定してください"),
  ),
});
