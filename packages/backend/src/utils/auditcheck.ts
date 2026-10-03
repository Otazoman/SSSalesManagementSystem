import { getCompanySettings } from "../platform/kv/company-settings-cache";

/**
 * KeyValue (COMPANY_SETTINGS) から共通の監査ログ出力フラグを取得する
 * @param kv Cloudflare KV Namespace
 * @returns 監査ログが出力有効(true)か無効(false)か
 */
export async function checkAuditLogEnabled(kv: KVNamespace): Promise<boolean> {
  try {
    if (!kv) {
      console.warn(
        "COMPANY_SETTINGS がバインドされていません。デフォルトでログを出力します。",
      );
      return true;
    }

    // 設定画面と共通の "config" キーから直接データを取得
    const settings = await getCompanySettings(kv);
    if (!settings) {
      return true; // データがない初期状態などはデフォルトで true
    }

    // スネークケースのプロパティを正確に評価
    if (settings && typeof settings.is_audit_log_enabled === "boolean") {
      return settings.is_audit_log_enabled;
    }

    return true;
  } catch (error) {
    console.error(
      "KeyValueからの監査ログフラグ取得に失敗しました。デフォルトでログを出力します。:",
      error,
    );
    return true;
  }
}
