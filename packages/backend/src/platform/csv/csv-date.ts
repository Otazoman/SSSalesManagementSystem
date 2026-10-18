import { BadRequestError } from "../http/http-error";

// 新規要望(2026-10-18): CSV取込の日付列(明細の納期等)をYYYY-MM-DDへ正規化する。
// Excelで開いて保存するとYYYY/M/D形式になることが多いため、区切りが「/」で月日が1桁の形式も受け付ける。
// 空欄はnull。解釈できない値は取込全体を止めてエラーにする(不正な日付が保存されるのを防ぐ)
export function normalizeCsvDate(value: string | null, columnName: string): string | null {
  if (value === null || value.trim() === "") return null;
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) {
    throw new BadRequestError(`${columnName}の日付「${value}」を読み取れません(YYYY-MM-DD形式で入力してください)`);
  }
  const [, y, m, d] = match;
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new BadRequestError(`${columnName}の日付「${value}」は存在しない日付です`);
  }
  return iso;
}
