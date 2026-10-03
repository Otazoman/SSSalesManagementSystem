import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/audit-schema";

interface WriteMailLogOptions {
  dbLogBinding: D1Database; // c.env.DB_LOG
  category: "sales_quote" | string; // 帳票種別
  documentId: string; // 伝票番号 (QT-xxx 等)
  smtpFrom: string;
  recipientTo: string;
  recipientCc?: string | null;
  subject: string;
  attachedR2Path?: string | null;
  status: "SUCCESS" | "FAILED";
  errorMessage?: string | null;
  performedById: string;
}

/**
 * 📝 配信履歴専用ログテーブル (mailDeliveryLogs) へ証跡を永続化する共通ユーティリティ
 */
export async function writeMailDeliveryLog(
  options: WriteMailLogOptions,
): Promise<void> {
  try {
    const dbLog = drizzle(options.dbLogBinding, { schema });

    await dbLog.insert(schema.mailDeliveryLogs).values({
      id: crypto.randomUUID(),
      category: options.category,
      documentId: options.documentId,
      smtpFrom: options.smtpFrom,
      recipientTo: options.recipientTo,
      recipientCc: options.recipientCc || null,
      subject: options.subject,
      attachedR2Path: options.attachedR2Path || null,
      status: options.status,
      errorMessage: options.errorMessage || null,
      performedById: options.performedById,
      performedAt: new Date(),
    });
  } catch (err) {
    // 統制ログ自体の失敗でメイン処理を巻き添えにしないよう、エラーはキャッチして警告を出力
    console.error(
      `[CRITICAL] メール送信履歴ログの書き込みに失敗しました (${options.documentId}):`,
      err,
    );
  }
}
