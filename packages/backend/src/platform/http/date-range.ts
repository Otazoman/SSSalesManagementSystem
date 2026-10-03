/**
 * 「YYYY-MM-DD」または「YYYY-MM-DDTHH:mm」等の日時文字列を、秒精度のUNIXタイムスタンプに変換する。
 * `audit-logs`・`mail-logs`の検索条件（開始日時・終了日時）で同一ロジックが重複していたため共通化。
 * 終了日時側は秒を59に切り上げ、その日時を含む範囲として扱う。
 */
export function parseDateTimeToUnixSeconds(
  dateStr: string | undefined,
  isEndDate: boolean,
): number | null {
  if (!dateStr || dateStr.trim() === "") return null;
  try {
    const normalizedStr = dateStr.replace(" ", "T");
    const d = new Date(normalizedStr);
    if (isNaN(d.getTime())) return null;

    if (isEndDate) {
      d.setSeconds(59);
    } else {
      d.setSeconds(0);
    }

    return Math.floor(d.getTime() / 1000);
  } catch {
    return null;
  }
}
