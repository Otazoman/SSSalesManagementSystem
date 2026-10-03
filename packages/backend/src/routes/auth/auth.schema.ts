import * as v from "valibot";

// 1. ログインリクエスト用 Schema
// メールアドレス・従業員番号のどちらか一方 + パスワードでログインする(パスワードリセットは引き続きメールアドレス必須)。
export const loginSchema = v.pipe(
  v.object({
    email: v.optional(
      v.pipe(
        v.string("メールアドレスは文字列で指定してください"),
        v.nonEmpty("メールアドレスを入力してください"),
        v.email("有効なメールアドレス形式で入力してください"),
        v.transform((val) => val.trim().toLowerCase()),
      ),
    ),
    employeeNumber: v.optional(
      v.pipe(
        v.string("従業員番号は文字列で指定してください"),
        v.nonEmpty("従業員番号を入力してください"),
        v.transform((val) => val.trim()),
      ),
    ),
    password: v.pipe(
      v.string("パスワードは文字列で指定してください"),
      v.nonEmpty("パスワードを入力してください"),
    ),
  }),
  v.check(
    (input) => Boolean(input.email) !== Boolean(input.employeeNumber),
    "メールアドレスまたは従業員番号のいずれか一方を指定してください",
  ),
);

// 2. 通知設定更新リクエスト用 Schema(プロフィール画面の自己編集用)
export const updateNotificationSettingsSchema = v.object({
  slackUserId: v.optional(v.nullable(v.string())),
  notificationChannel: v.optional(v.picklist(["email", "slack"])),
});

// 型定義の抽出
export type LoginInput = v.InferOutput<typeof loginSchema>;
export type UpdateNotificationSettingsInput = v.InferOutput<
  typeof updateNotificationSettingsSchema
>;
