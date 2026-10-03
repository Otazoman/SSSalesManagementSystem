import { drizzle } from "drizzle-orm/d1";
import * as auditSchema from "../../db/audit-schema";

export interface EnqueueNotificationOptions {
  dbLog: D1Database; // c.env.DB_LOG
  type?: "email" | "slack"; // 未指定時は"email"
  category: string;
  documentId: string;
  recipientTo: string; // email: 宛先(カンマ区切り可) / slack: SlackメンバーID
  recipientCc?: string | null; // email種別のみ有効
  smtpFromOverride?: string | null; // 帳票テンプレート等が送信元を上書きする場合。未指定ならCron側がCOMPANY_SETTINGSの既定値を使う
  subject: string;
  body: string; // Cronがこれを読んで実際に送信する
  attachedR2Path?: string | null;
  performedById?: string | null;
}

/**
 * Item0: メール/Slack通知を即時送信せず、mailDeliveryLogs(outbox兼配信ログ)へ
 * status='PENDING'で登録するだけの共通処理。実際の送信はCron Trigger(scheduled)側が行う。
 * 呼び出し元(notifier.ts / quote.service.ts / password.service.ts / user.service.ts)で
 * 重複していた「ログテーブルへの書き込み」を1箇所に集約したもの。
 */
export async function enqueueNotification(
  options: EnqueueNotificationOptions,
): Promise<void> {
  const db = drizzle(options.dbLog, { schema: auditSchema });

  await db.insert(auditSchema.mailDeliveryLogs).values({
    id: crypto.randomUUID(),
    type: options.type || "email",
    category: options.category,
    documentId: options.documentId,
    smtpFrom: options.smtpFromOverride || null, // 未指定時は送信時にCron側がCOMPANY_SETTINGSから解決する
    recipientTo: options.recipientTo,
    recipientCc: options.recipientCc || null,
    subject: options.subject,
    body: options.body,
    attachedR2Path: options.attachedR2Path || null,
    status: "PENDING",
    retryCount: 0,
    performedById: options.performedById || null,
    performedAt: new Date(),
  });
}
