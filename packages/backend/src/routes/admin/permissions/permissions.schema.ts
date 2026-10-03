import * as v from "valibot";
import { requiredString } from "../../../platform/validation/common-schema";

// 1. POST /bulk: 基本権限の一括自動生成 schema
export const bulkCreatePermissionsSchema = v.object({
  items: v.array(
    v.object({
      id: requiredString("権限IDは必須です"),
      resource: requiredString("リソースは必須です"),
      action: requiredString("アクションは必須です"),
      name: requiredString("権限名は必須です"),
      description: v.optional(v.nullable(v.string())),
    }),
  ),
});

export type BulkCreatePermissionsInput = v.InferOutput<
  typeof bulkCreatePermissionsSchema
>;

// 2. GET /role/:roleId : パラメータ schema
export const getRolePermissionsParamSchema = v.object({
  roleId: requiredString("ロールIDは必須です"),
});

export type GetRolePermissionsParamInput = v.InferOutput<
  typeof getRolePermissionsParamSchema
>;

// 3. PUT /role/:roleId : ロール権限上書き更新 schema
export const updateRolePermissionsSchema = v.object({
  permissionIds: v.array(
    v.string(),
    "permissionIdsは文字列の配列で指定してください",
  ),
});

export type UpdateRolePermissionsInput = v.InferOutput<
  typeof updateRolePermissionsSchema
>;
