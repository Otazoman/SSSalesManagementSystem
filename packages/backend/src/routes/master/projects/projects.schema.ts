import * as v from "valibot";

// GET / 検索クエリ
export const GetProjectsQuerySchema = v.object({
  id: v.optional(v.string()),
  name: v.optional(v.string()),
  status: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// POST /register 登録ボディ
export const RegisterProjectBodySchema = v.object({
  // マスタコード自動採番: 未入力(null)の場合はサービス層でmaster_code_formatsの設定に基づき自動採番する
  id: v.optional(v.nullable(v.string())),
  name: v.pipe(v.string(), v.minLength(1, "プロジェクト名称は必須です")),
  memo: v.optional(v.nullable(v.string())),
  startDate: v.optional(v.nullable(v.string())),
  endDate: v.optional(v.nullable(v.string())),
});

// PUT /:id 更新ボディ
export const UpdateProjectBodySchema = v.object({
  name: v.pipe(v.string(), v.minLength(1, "プロジェクト名称は必須です")),
  memo: v.optional(v.nullable(v.string())),
  startDate: v.optional(v.nullable(v.string())),
  endDate: v.optional(v.nullable(v.string())),
});

// パラメータ (:id)
export const IdParamSchema = v.object({
  id: v.string(),
});

export type GetProjectsQuery = v.InferOutput<typeof GetProjectsQuerySchema>;
export type RegisterProjectInput = v.InferOutput<typeof RegisterProjectBodySchema>;
export type UpdateProjectInput = v.InferOutput<typeof UpdateProjectBodySchema>;
