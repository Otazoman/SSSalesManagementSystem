import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as auditSchema from "../../db/audit-schema";
import type { Env } from "../../types/env";
import { processNotificationById } from "../../scheduled/process-notification-outbox";

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
// PERF-08: 登録した行の id を返す(sendNotificationNow ですぐに送るため)
export async function enqueueNotification(
  options: EnqueueNotificationOptions,
): Promise<string> {
  const db = drizzle(options.dbLog, { schema: auditSchema });
  const id = crypto.randomUUID();

  await db.insert(auditSchema.mailDeliveryLogs).values({
    id,
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
  return id;
}

/**
 * PERF-08: 登録した通知を、定期処理(1分ごと)を待たずに、応答を返した後すぐに送る(OTP メールなど)。
 * 失敗した場合の再送は、今までどおり定期処理が行う。リクエストの実行環境(executionCtx)が無い時
 * (テストでルーターを直接呼んだ場合など)は何もせず、定期処理に任せる
 */
export function sendNotificationNow(c: Context<{ Bindings: Env }>, id: string): void {
  let executionCtx: Context["executionCtx"];
  try {
    executionCtx = c.executionCtx;
  } catch {
    return;
  }
  executionCtx.waitUntil(
    processNotificationById(c.env, id).catch((err) => {
      console.error(`[NotificationSendNowError] id=${id}:`, err);
    }),
  );
}
