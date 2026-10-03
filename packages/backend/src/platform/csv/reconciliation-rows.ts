import { BadRequestError } from "../http/http-error";

// 入金消込・支払消込のCSV取込の共通検証。この取込は「消込の記録を追加する」処理のため、同じファイルを
// 二重に取り込むと入金/支払が二重に記録されてしまう。全行を書き込み前に検証し、既存と同じ記録・CSV内の
// 重複・存在しない請求/支払・不正な日付/金額があれば、1件も登録せず行番号つきで400にする。
export interface ReconRow {
  /** CSV上の行番号(ヘッダーを1行目とする) */
  line: number;
  headerId: string;
  date: Date;
  amount: number;
  method: string;
  memo: string | null;
}

const MAX_REPORTED_ERRORS = 20;

/** BUG-051: 請求・支払ごとの上限(合計金額・既存の消込額)と、記録できない理由(未発行など。無ければ省略) */
export interface ReconLimit {
  totalAmount: number;
  reconciledAmount: number;
  blockedReason?: string;
}

// 「請求/支払 + 日付 + 金額 + 方法 + メモ」が同じなら同一の消込記録とみなす
// (同日・同額の別々の記録は、メモを変えれば登録できる)
export function reconKey(r: { headerId: string; date: Date; amount: number; method: string; memo: string | null }): string {
  return [r.headerId, r.date.toISOString().slice(0, 10), r.amount, r.method, r.memo ?? ""].join("|");
}

/** 生のセル値を検証しながらReconRowへ変換する。不正な行は errors へ行番号つきで追加する */
export function parseReconCells(
  cells: { line: number; headerId: string; date: string | null; amount: string | null; method: string | null; memo: string | null },
  defaultMethod: string,
  errors: string[],
): ReconRow | null {
  const fail = (message: string) => {
    errors.push(`${cells.line}行目: ${message}`);
    return null;
  };
  if (!cells.date) return fail("日付は必須です(YYYY-MM-DD)");
  const date = new Date(cells.date);
  if (Number.isNaN(date.getTime())) return fail(`日付「${cells.date}」が正しくありません(YYYY-MM-DD)`);
  if (!cells.amount) return fail("金額は必須です");
  const amount = Number(cells.amount);
  if (!Number.isFinite(amount) || amount <= 0) return fail(`金額「${cells.amount}」は1以上の数値で指定してください`);
  return { line: cells.line, headerId: cells.headerId, date, amount, method: cells.method || defaultMethod, memo: cells.memo };
}

/**
 * 解析済みの行を検証する(存在確認・既存との重複・CSV内の重複)。問題があれば全件をまとめて400にする。
 * label は「入金」「支払」、headerLabel は「請求」「支払」。
 */
export function assertReconRowsAreNew(
  rows: ReconRow[],
  parseErrors: string[],
  existingHeaderIds: Set<string>,
  existingKeys: Set<string>,
  label: string,
  headerLabel: string,
  limits?: Map<string, ReconLimit>,
): void {
  const errors = [...parseErrors];
  const seen = new Map<string, number>();
  const runningTotals = new Map<string, number>();
  for (const row of rows) {
    if (!existingHeaderIds.has(row.headerId)) {
      errors.push(`${row.line}行目: ${headerLabel}[${row.headerId}]が見つかりません`);
      continue;
    }
    const key = reconKey(row);
    const firstLine = seen.get(key);
    if (firstLine !== undefined) {
      errors.push(`${row.line}行目: ${firstLine}行目と同じ${label}がCSV内で重複しています`);
      continue;
    }
    seen.set(key, row.line);
    if (existingKeys.has(key)) {
      errors.push(
        `${row.line}行目: ${headerLabel}[${row.headerId}]に、同じ${label}(日付・金額・方法・メモが同一)が既に登録されています。二重にインポートしている可能性があります`,
      );
      continue;
    }
    // BUG-051: 記録できない状態(未発行など)と、既存の消込 + CSV の金額の合計が合計金額を超えないかを確認する
    const limit = limits?.get(row.headerId);
    if (!limit) continue;
    if (limit.blockedReason) {
      errors.push(`${row.line}行目: ${headerLabel}[${row.headerId}]は${limit.blockedReason}`);
      continue;
    }
    const total = (runningTotals.get(row.headerId) ?? limit.reconciledAmount) + row.amount;
    runningTotals.set(row.headerId, total);
    if (total > limit.totalAmount) {
      errors.push(
        `${row.line}行目: ${headerLabel}[${row.headerId}]の${label}の合計(¥${total.toLocaleString()})が${headerLabel}額(¥${limit.totalAmount.toLocaleString()})を超えています`,
      );
    }
  }
  if (errors.length === 0) return;
  const shown = errors.slice(0, MAX_REPORTED_ERRORS);
  const rest = errors.length - shown.length;
  throw new BadRequestError(
    `CSVに問題があるため、${label}を1件も登録していません(${errors.length}件)\n${shown.join("\n")}${rest > 0 ? `\n...ほか${rest}件` : ""}`,
  );
}
