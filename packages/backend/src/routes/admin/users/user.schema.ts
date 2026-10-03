import * as v from "valibot";
import {
  requiredString,
  requiredTrimmedString,
} from "../../../platform/validation/common-schema";

// 💡 DEDUP-BE-09で発見した抜け穴の修正: trimしてから空文字チェックする順序に統一
//    (旧: 空文字チェック→trim だと、空白のみの入力が必須チェックを一旦通過してしまっていた)

// リレーション（所属・権限マトリックス）のスキーマ
export const userRelationSchema = v.object({
  roleId: requiredString("ロールIDは必須です"),
  departmentId: v.optional(v.nullable(v.string())),
});

// 1. 初期管理者セットアップ用
export const setupAdminSchema = v.object({
  setupToken: requiredString("初期セットアップトークンは必須です"),
  employeeNumber: v.pipe(
    v.string("従業員番号は文字列である必要があります"),
    v.transform((val) => val.trim()),
    v.nonEmpty("従業員番号は必須です"),
  ),
  name: v.pipe(
    v.string("氏名は文字列である必要があります"),
    v.transform((val) => val.trim()),
    v.nonEmpty("氏名は必須です"),
  ),
  email: v.pipe(
    v.string("メールアドレスは文字列である必要があります"),
    v.email("有効なメールアドレスを指定してください"),
    v.transform((val) => val.trim().toLowerCase()),
  ),
  password: v.pipe(
    v.string("パスワードは文字列である必要があります"),
    v.minLength(8, "パスワードは8文字以上で指定してください"),
  ),
});

// 2. 一覧検索クエリ用
export const userListQuerySchema = v.object({
  status: v.optional(
    v.enum({ active: "active", inactive: "inactive", all: "all" }),
  ),
  employeeNumber: v.optional(v.string()),
  name: v.optional(v.string()),
  nameMode: v.optional(v.enum({ exact: "exact", partial: "partial" })),
  email: v.optional(v.string()),
  emailMode: v.optional(v.enum({ exact: "exact", partial: "partial" })),
  departmentId: v.optional(v.string()),
  roleId: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// 3. ユーザー登録用
export const registerUserSchema = v.object({
  employeeNumber: requiredTrimmedString("従業員番号は必須です"),
  name: requiredTrimmedString("氏名は必須です"),
  email: v.pipe(
    v.string(),
    v.email("有効なメールアドレスを指定してください"),
    v.transform((val) => val.trim().toLowerCase()),
  ),
  password: v.optional(v.string()),
  sendEmail: v.optional(v.boolean()),
  // 追加要望B: 管理者によるSlack通知設定(SlackメンバーID・通知方法)。省略時は変更しない
  slackUserId: v.optional(v.nullable(v.pipe(v.string(), v.trim()))),
  notificationChannel: v.optional(v.picklist(["email", "slack"])),
  relations: v.optional(v.array(userRelationSchema)),
});

// 4. ユーザー更新用
export const updateUserSchema = v.object({
  name: requiredTrimmedString("氏名は必須です"),
  email: v.pipe(
    v.string(),
    v.email("有効なメールアドレスを指定してください"),
    v.transform((val) => val.trim().toLowerCase()),
  ),
  isActive: v.optional(v.boolean()),
  password: v.optional(v.string()),
  // 追加要望B: 管理者によるSlack通知設定(SlackメンバーID・通知方法)。省略時は変更しない
  slackUserId: v.optional(v.nullable(v.pipe(v.string(), v.trim()))),
  notificationChannel: v.optional(v.picklist(["email", "slack"])),
  relations: v.optional(v.array(userRelationSchema)),
});

// 5. パスワード変更用
export const changePasswordSchema = v.object({
  // BUG-021: 変更する相手はログイン中の本人(セッション)に限るため、この値は使わない。
  // 既存の画面が送ってくるため、受け付けだけは続ける(API の入力形式は変えない)
  userId: v.optional(v.string()),
  currentPassword: requiredString("現在のパスワードは必須です"),
  newPassword: v.pipe(
    v.string(),
    v.minLength(8, "新しいパスワードは8文字以上である必要があります"),
  ),
});

// 6. パスワードリセット要求用
export const forgotPasswordSchema = v.object({
  email: v.pipe(
    v.string(),
    v.email("有効なメールアドレスを指定してください"),
    v.transform((val) => val.trim().toLowerCase()),
  ),
});

// 7. トークン経由リセット用
export const resetPasswordViaTokenSchema = v.object({
  token: requiredString("トークンは必須です"),
  newPassword: v.pipe(
    v.string(),
    v.minLength(8, "新しいパスワードは8文字以上である必要があります"),
  ),
});

// 8. IDパラメータ検証用
export const userIdParamSchema = v.object({
  id: requiredString("IDは必須です"),
});

// 型定義の抽出
export type SetupAdminInput = v.InferOutput<typeof setupAdminSchema>;
export type UserListQueryInput = v.InferOutput<typeof userListQuerySchema>;
export type RegisterUserInput = v.InferOutput<typeof registerUserSchema>;
export type UpdateUserInput = v.InferOutput<typeof updateUserSchema>;
export type ChangePasswordInput = v.InferOutput<typeof changePasswordSchema>;
export type ForgotPasswordInput = v.InferOutput<typeof forgotPasswordSchema>;
export type ResetPasswordViaTokenInput = v.InferOutput<
  typeof resetPasswordViaTokenSchema
>;
