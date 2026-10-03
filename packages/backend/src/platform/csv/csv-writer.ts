// BUG-028: Excel で開いた時に数式として動く値の先頭文字(=・+・-・@・タブ・改行(CR))
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
// 数値(-100・-12.5・+3・-1,000 など)は数式として動かないため対象外にする(Excel で数値のまま計算に使えるように)
const NUMERIC_VALUE = /^[+-]?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/;

/** Excel で数式として動く値の先頭に ' を付ける(取込の時は csv-parser の unescapeFormulaCell で外す) */
export function escapeFormulaCell(s: string): string {
  return FORMULA_PREFIX.test(s) && !NUMERIC_VALUE.test(s) ? `'${s}` : s;
}

/**
 * CSVの1フィールド値をダブルクォートで囲み、内部の " を "" にエスケープする。
 * BUG-028: = + - @ などで始まる値(数値を除く)は、Excel で数式として動かないよう先頭に ' を付ける。
 */
export function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${escapeFormulaCell(s).replace(/"/g, '""')}"`;
}

/**
 * ヘッダー行と、あらかじめカンマ結合済みの行文字列配列からCSV本文を組み立てる。
 * ヘッダーはダブルクォートで囲まない(既存の全実装と同じ)。
 */
export function buildCsvContent(
  headers: string[],
  rows: string[],
  lineBreak: string = "\n",
): string {
  return [headers.join(","), ...rows].join(lineBreak);
}

// CRLF改行(既存実装でCRLFを使っていた箇所向け)。文字コードから生成し、エスケープ表記の衝突を避ける。
export const CRLF = String.fromCharCode(13) + String.fromCharCode(10);

// UTF-8 BOM (U+FEFF)。エスケープ表記の衝突を避けるため文字コードから生成する。
const BOM_CHAR = String.fromCharCode(0xfeff);

/** 文字列CSVの先頭にUTF-8 BOM文字を付与する(c.body用の文字列レスポンス向け) */
export function withBom(content: string): string {
  return BOM_CHAR + content;
}

/** CSVをUTF-8 BOM付きのバイト列に変換する(c.body用のUint8Arrayレスポンス向け) */
export function toCsvBytes(content: string): Uint8Array<ArrayBuffer> {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const body = new TextEncoder().encode(content);
  const out = new Uint8Array(bom.length + body.length);
  out.set(bom, 0);
  out.set(body, bom.length);
  return out;
}
