import * as v from "valibot";

// ステータス定義
export const AccountStatusSchema = v.enum({
  temporary: "temporary",
  active: "active",
  suspended: "suspended",
});

// GET / 検索クエリ
export const GetAccountsQuerySchema = v.object({
  code: v.optional(v.string()),
  name: v.optional(v.string()),
  status: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// POST /register 登録ボディ
export const RegisterAccountBodySchema = v.object({
  code: v.pipe(v.string(), v.minLength(1, "コードは必須です")),
  name: v.pipe(v.string(), v.minLength(1, "名称は必須です")),
  externalMappingCode: v.optional(v.nullable(v.string())),
  memo: v.optional(v.nullable(v.string())),
});

// PUT /:code 更新ボディ
export const UpdateAccountBodySchema = v.object({
  name: v.pipe(v.string(), v.minLength(1, "名称は必須です")),
  externalMappingCode: v.optional(v.nullable(v.string())),
  status: v.optional(AccountStatusSchema),
  memo: v.optional(v.nullable(v.string())),
});

// パラメータ (:code)
export const CodeParamSchema = v.object({
  code: v.string(),
});

export type GetAccountsQuery = v.InferOutput<typeof GetAccountsQuerySchema>;
export type RegisterAccountInput = v.InferOutput<
  typeof RegisterAccountBodySchema
>;
export type UpdateAccountInput = v.InferOutput<typeof UpdateAccountBodySchema>;
