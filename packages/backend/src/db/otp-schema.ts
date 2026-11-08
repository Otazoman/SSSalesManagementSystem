import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Item4-c: 見積書PDFのOTPダウンロード用チャレンジ(別DB: DB_OTP側へデプロイする隔離スキーマ)。
// メイン/ログ用DBとも分離する理由: OTPコード自体は機微情報であり、書き込み頻度も他と異なるため、
// 影響範囲を独立させる目的で専用DBを新設する方針(2026-08-13にユーザー確認済み)。
export const otpChallenges = sqliteTable("otp_challenges", {
  id: text("id").primaryKey(), // UUID
  documentType: text("document_type").notNull().default("sales_quote"), // 将来的な他伝票への拡張を見込んだ種別
  documentId: text("document_id").notNull(), // 対象の見積ID等
  attachmentId: text("attachment_id").notNull(), // 対象の添付ファイルID
  email: text("email").notNull(), // OTP送信先として入力されたメールアドレス
  otpCode: text("otp_code").notNull(), // 4桁数字(平文。10分間の短命トークンのため試行回数制限で保護する)
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  verifiedAt: integer("verified_at", { mode: "timestamp" }), // 検証成功時刻(単一使用のため成功後は再利用不可)
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// REQ-004: ログイン時の OTP のチャレンジ。パスワードが合った後に発行し、OTP が合ったらセッションを発行する。
// コードは平文で持たず、チャレンジのIDと合わせたハッシュ(SHA-256)で持つ。帳票ダウンロード用(otp_challenges)とは
// 設定(会社設定の login_otp_*)・用途が異なるため、別のテーブルにする
export const loginOtpChallenges = sqliteTable("login_otp_challenges", {
  id: text("id").primaryKey(), // UUID(画面に渡し、OTP の確認・再送で使う)
  userId: text("user_id").notNull(), // 対象のユーザー(業務DBの users.id。別DBのため外部キーは付けない)
  codeHash: text("code_hash").notNull(), // OTP のハッシュ(SHA-256。チャレンジのIDと合わせて計算する)
  channel: text("channel").notNull(), // 送った方法(email / slack)
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  attemptCount: integer("attempt_count").notNull().default(0), // 入力を間違えた回数
  lastSentAt: integer("last_sent_at", { mode: "timestamp" }).notNull(), // 最後に送った日時(再送の間隔の判定に使う)
  verifiedAt: integer("verified_at", { mode: "timestamp" }), // 確認できた日時(一度だけ使える)
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
