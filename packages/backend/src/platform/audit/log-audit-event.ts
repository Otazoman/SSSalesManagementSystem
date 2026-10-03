import type { Context } from "hono";
import type { Env } from "../../types/env";
import { checkAuditLogEnabled } from "../../utils/auditcheck";
import { writeAuditLog } from "../../utils/logger";

/**
 * 会社設定の監査ログ出力トグル(checkAuditLogEnabled)を確認した上でwriteAuditLogを呼び出す。
 * 各機能で重複していた「isAuditEnabled取得→writeAuditLogへ明示的に渡す」定型パターンを共通化したもの。
 * ループ内で複数回writeAuditLogを呼ぶ箇所(CSV一括登録等)は、KV読み取りをループ外で1回にまとめるため
 * 対象外とし、従来通りcheckAuditLogEnabledを直接利用する。
 */
export async function logAuditEvent(
  c: Context<{ Bindings: Env }>,
  action: string,
  tableName: string,
  recordId: string,
  oldValues?: any,
  newValues?: any,
): Promise<void> {
  const isAuditEnabled = await checkAuditLogEnabled(c.env.COMPANY_SETTINGS);
  await writeAuditLog(
    c,
    action,
    tableName,
    recordId,
    oldValues,
    newValues,
    isAuditEnabled,
  );
}
