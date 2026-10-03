import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// 💡 監査ログ（別DB：DB_LOG 側へデプロイする隔離スキーマ）
export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  action: text("action").notNull(),
  tableName: text("table_name").notNull(),
  recordId: text("record_id").notNull(),
  oldValues: text("old_values"), // JSON文字列を格納
  newValues: text("new_values"), // JSON文字列を格納
  performedAt: integer("performed_at", { mode: "timestamp" }).notNull(),
});

// 💡 Item0: 通知送信キュー兼配信ログ。email送信は従来通りここに結果を記録するのに加え、
//    非同期化により「送信待ち(PENDING/PROCESSING)」の行もこのテーブルに一時的に存在する(outboxを兼ねる)。
export const mailDeliveryLogs = sqliteTable("mail_delivery_logs", {
  id: text("id").primaryKey(), // ログ一意ID (UUID)
  type: text("type").notNull().default("email"), // 'email' または 'slack'
  category: text("category").notNull(), // 帳票種別 (例: 'sales_quote')
  documentId: text("document_id").notNull(), // 元伝票番号 (例: 見積番号 'QT-202606-0001')
  smtpFrom: text("smtp_from"), // 実際に使用された送信元 (email種別のみ。slackはnull)
  recipientTo: text("recipient_to").notNull(), // 宛先To (email: カンマ区切り含む / slack: チャンネルID)
  recipientCc: text("recipient_cc"), // 同報Cc (email種別のみ)
  subject: text("subject").notNull(), // 送信件名 (slackの場合も同じ文言を流用)
  body: text("body"), // 送信本文 (PENDING登録時に保存。Cronがこれを読んで送信する)
  attachedR2Path: text("attached_r2_path"), // 添付した見積書PDFのR2相対パス
  status: text("status").notNull(), // 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED'
  errorMessage: text("error_message"), // 失敗時のエラー内容
  retryCount: integer("retry_count").notNull().default(0), // 送信失敗時の再試行回数
  nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }), // 次回再試行予定時刻(nullなら即時対象)
  performedById: text("performed_by_id"), // 実行ユーザーID
  performedAt: integer("performed_at", { mode: "timestamp" }).notNull(),
});
