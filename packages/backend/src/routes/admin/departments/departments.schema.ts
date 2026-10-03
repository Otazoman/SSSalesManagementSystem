import * as v from "valibot";
import { requiredString } from "../../../platform/validation/common-schema";

// 日付文字列を Date オブジェクトに変換するヘルパー
const dateTransform = v.pipe(
  v.string(),
  v.transform((val) => new Date(val)),
);

// 1. GET / 用のクエリパラメータースキーマ
export const GetDepartmentsQuerySchema = v.object({
  status: v.optional(v.picklist(["active", "inactive", "all"]), "active"),
  filter: v.optional(v.string()),
  targetDate: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

export type GetDepartmentsQueryInput = v.InferOutput<
  typeof GetDepartmentsQuerySchema
>;

// 2. POST / 用の作成スキーマ
export const CreateDepartmentSchema = v.object({
  id: requiredString("部署IDを入力してください"),
  name: requiredString("部署名を入力してください"),
  parentDepartmentId: v.optional(v.nullable(v.string())),
  memo: v.optional(v.nullable(v.string())),
  validFrom: v.optional(v.nullable(dateTransform)),
  validTo: v.optional(v.nullable(dateTransform)),
});

export type CreateDepartmentInput = v.InferOutput<
  typeof CreateDepartmentSchema
>;

// 3. PUT /:idOrSurrogate 用の更新スキーマ
export const UpdateDepartmentSchema = v.object({
  id: v.optional(v.string()),
  name: requiredString("部署名を入力してください"),
  parentDepartmentId: v.optional(v.nullable(v.string())),
  memo: v.optional(v.nullable(v.string())),
  validFrom: v.optional(v.nullable(dateTransform)),
  validTo: v.optional(v.nullable(dateTransform)),
});

export type UpdateDepartmentInput = v.InferOutput<
  typeof UpdateDepartmentSchema
>;
