import { drizzle } from "drizzle-orm/d1";
import * as logSchema from "../db/audit-schema";
import { getSession } from "../platform/auth/get-session";

export async function writeAuditLog(
  c: any,
  action: string,
  tableName: string,
  recordId: string,
  oldValues?: any,
  newValues?: any,
  forceAuditEnabled?: boolean,
) {
  // 署名付きセッションcookieから実行者の情報を取得(改ざん不可)
  const session = await getSession(c);
  const sessionIsEnabled = session?.isAuditEnabled === true;

  // 1. 引数があれば最優先、なければセッションから判定した値を使う
  let isAuditEnabled =
    forceAuditEnabled !== undefined ? forceAuditEnabled : sessionIsEnabled;

  // 2. マスタ設定の変更時だけは、newValues内の生のbooleanを見る
  if (tableName === "system_settings_kv" && newValues) {
    isAuditEnabled =
      newValues.is_audit_log_enabled === true ||
      newValues.is_audit_log_enabled === "true";
  }

  // 厳格シャットアウト
  if (!isAuditEnabled) {
    return;
  }

  try {
    const logDb = drizzle(c.env.DB_LOG, { schema: logSchema });
    // Item1: 実行者はusers.idではなくemployeeNumberで記録する(列名はuserIdのまま、値の意味だけ変更)
    const userId = session?.employeeNumber || "SYSTEM";

    await logDb.insert(logSchema.auditLogs).values({
      id: crypto.randomUUID(),
      userId: userId,
      action: action,
      tableName: tableName,
      recordId: recordId,
      oldValues: oldValues ? JSON.stringify(oldValues) : null,
      newValues: newValues ? JSON.stringify(newValues) : null,
      performedAt: new Date(),
    });
  } catch (err) {
    console.error(
      "⚠️ 監査ログ隔離データベースへの書き込みに失敗しました:",
      err,
    );
  }
}
