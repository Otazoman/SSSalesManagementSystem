import { encodeHalfWidth, padField } from "./jis-x0201";
import { BadRequestError } from "../http/http-error";

// ファームバンキング: 全銀協会「総合振込(コード21)」固定長フォーマット(1レコード120バイト、
// ヘッダー1件+データN件+トレーラー1件+エンド1件)の生成。
//
// 【重要な注記】このフォーマットの項目定義・桁数は広く採用されている標準的な仕様に基づいて
// 実装しているが、金融機関によって細部の運用差異(新規コードの扱い、EDI情報の要否等)が
// あり得る。実際に振込に使用する前に、必ず取引銀行のファームバンキングソフトのテスト取込・
// 検証機能で確認すること。

export type AccountType = "ORDINARY" | "CURRENT";

function accountTypeDigit(type: AccountType): string {
  return type === "CURRENT" ? "2" : "1";
}

export interface ZenginTransferHeaderInput {
  committerCode: string; // 委託者コード(10桁以内、数字)
  committerName: string; // 委託者名(半角、40桁以内)
  transferDate: Date; // 取組日
  bankCode: string; // 仕向銀行番号(4桁)
  bankName: string; // 仕向銀行名(半角、15桁以内)
  branchCode: string; // 仕向支店番号(3桁)
  branchName: string; // 仕向支店名(半角、15桁以内)
  accountType: AccountType;
  accountNumber: string; // 口座番号(7桁以内、数字)
}

export interface ZenginTransferLineInput {
  partnerId: string; // エラーメッセージでの特定用(ファイルには出力しない)
  bankCode: string;
  bankName: string;
  branchCode: string;
  branchName: string;
  accountType: AccountType;
  accountNumber: string;
  accountHolderName: string; // 受取人名(半角、30桁以内)
  amount: number; // 振込金額(10桁以内)
}

export interface GenerateZenginTransferFileResult {
  bytes: Uint8Array<ArrayBuffer>;
  recordCount: number;
  totalAmount: number;
  // 半角変換できなかった文字・桁あふれで切り詰めた項目等の警告(生成は継続するが、
  // 呼び出し元は振込前にこれをユーザーへ提示し確認を促すべき)
  warnings: string[];
}

function twoDigits(n: number): string {
  return String(n).padStart(2, "0");
}

function buildRecord(fields: string[], warnings: string[], recordLabel: string): number[] {
  const joined = fields.join("");
  if (joined.length !== 120) {
    // 固定長の組み立てミス(実装バグ)。防御的にthrowする(データ内容の問題ではないため
    // warningsではなく例外にする)
    throw new Error(`全銀フォーマットのレコード長が120バイトになりません(${recordLabel}): ${joined.length}バイト`);
  }
  const { bytes, unsupportedChars } = encodeHalfWidth(joined);
  if (unsupportedChars.length > 0) {
    warnings.push(
      `${recordLabel}: 半角文字・半角カナ以外の文字が含まれていたためスペースに置換しました(${[...new Set(unsupportedChars)].join("")})`,
    );
  }
  return Array.from(bytes);
}

export function generateZenginTransferFile(
  header: ZenginTransferHeaderInput,
  lines: ZenginTransferLineInput[],
): GenerateZenginTransferFileResult {
  if (lines.length === 0) {
    throw new BadRequestError("振込対象の明細が1件もありません");
  }

  const warnings: string[] = [];
  const recordBytes: number[] = [];
  const CRLF = [0x0d, 0x0a];

  // 1. ヘッダーレコード
  const mmdd = twoDigits(header.transferDate.getMonth() + 1) + twoDigits(header.transferDate.getDate());
  const headerFields = [
    "1", // レコード区分
    "21", // 種別コード(総合振込)
    "0", // コード区分(JIS)
    padField(header.committerCode, 10, "right"),
    padField(header.committerName, 40, "left"),
    mmdd,
    padField(header.bankCode, 4, "right"),
    padField(header.bankName, 15, "left"),
    padField(header.branchCode, 3, "right"),
    padField(header.branchName, 15, "left"),
    accountTypeDigit(header.accountType),
    padField(header.accountNumber, 7, "right"),
    " ".repeat(17), // ダミー
  ];
  recordBytes.push(...buildRecord(headerFields, warnings, "ヘッダーレコード"));
  recordBytes.push(...CRLF);

  // 2. データレコード(明細ごと)
  let totalAmount = 0;
  for (const line of lines) {
    if (!Number.isFinite(line.amount) || line.amount <= 0) {
      throw new BadRequestError(`振込金額が不正です(取引先[${line.partnerId}]): ${line.amount}`);
    }
    totalAmount += line.amount;

    const dataFields = [
      "2", // レコード区分
      padField(line.bankCode, 4, "right"),
      padField(line.bankName, 15, "left"),
      " ".repeat(4), // 被仕向手形交換所番号(未使用)
      padField(line.branchCode, 3, "right"),
      padField(line.branchName, 15, "left"),
      accountTypeDigit(line.accountType),
      padField(line.accountNumber, 7, "right"),
      padField(line.accountHolderName, 30, "left"),
      padField(String(Math.round(line.amount)), 10, "right"),
      "1", // 新規コード(1=新規扱い。全件を毎回新規として送る安全側のデフォルト)
      " ".repeat(10), // 顧客コード1(未使用)
      " ".repeat(10), // 顧客コード2(未使用)
      " ", // 振込区分(銀行側で不要な場合が多いため空白)
      " ", // 識別表示(未使用)
      " ".repeat(7), // ダミー
    ];
    recordBytes.push(...buildRecord(dataFields, warnings, `データレコード(取引先[${line.partnerId}])`));
    recordBytes.push(...CRLF);
  }

  // 3. トレーラーレコード
  const trailerFields = [
    "8",
    padField(String(lines.length), 6, "right"),
    padField(String(totalAmount), 12, "right"),
    " ".repeat(101),
  ];
  recordBytes.push(...buildRecord(trailerFields, warnings, "トレーラーレコード"));
  recordBytes.push(...CRLF);

  // 4. エンドレコード
  const endFields = ["9", " ".repeat(119)];
  recordBytes.push(...buildRecord(endFields, warnings, "エンドレコード"));
  recordBytes.push(...CRLF);

  return {
    bytes: new Uint8Array(recordBytes),
    recordCount: lines.length,
    totalAmount,
    warnings,
  };
}
