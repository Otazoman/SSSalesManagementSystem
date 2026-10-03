import * as v from "valibot";

// ベース定義
// 💡 DEDUP-BE-09で発見した抜け穴の修正: trimしてから空文字チェックする順序に統一
//    (旧: 空文字チェック→trim だと、空白のみの入力が必須チェックを一旦通過してしまっていた)
const roleIdSchema = v.pipe(
  v.string("ロールIDは文字列で指定してください"),
  v.transform((val) => val.trim()),
  v.nonEmpty("ロールIDは必須です"),
  v.transform((val) => val.toLowerCase()),
);

const roleNameSchema = v.pipe(
  v.string("ロール名は文字列で指定してください"),
  v.transform((val) => val.trim()),
  v.nonEmpty("ロール名は必須です"),
);

const roleDescriptionSchema = v.optional(
  v.nullable(
    v.pipe(
      v.string(),
      v.transform((val) => val.trim() || null),
    ),
  ),
);

// 1. 新規作成用 (POST)
export const createRoleSchema = v.object({
  id: roleIdSchema,
  name: roleNameSchema,
  description: roleDescriptionSchema,
});

// 2. 更新用 (PUT)
export const updateRoleSchema = v.object({
  name: roleNameSchema,
  description: roleDescriptionSchema,
});

// 3. パラメータ用 (ID指定)
export const roleParamSchema = v.object({
  id: v.pipe(
    v.string(),
    v.transform((val) => val.trim()),
    v.nonEmpty("IDパラメータは必須です"),
    v.transform((val) => val.toLowerCase()),
  ),
});

// 型抽出
export type CreateRoleInput = v.InferOutput<typeof createRoleSchema>;
export type UpdateRoleInput = v.InferOutput<typeof updateRoleSchema>;
