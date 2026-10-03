// ファームバンキング: 全銀協会フォーマットは半角文字(数字・半角カナ・基本記号)のみで構成される
// 固定長テキストで、伝統的にJIS X0201(1バイト/文字)でエンコードされる。Cloudflare Workers
// ランタイムにはShift_JIS等のレガシーエンコーディングを扱うネイティブAPIが無いため、
// 対象文字集合(ASCII可視域+半角カナ)に限定した単純な1:1バイト変換をここで自前実装する。
//
// 半角カナ(Unicode U+FF61-U+FF9F)→JIS X0201(0xA1-0xDF)は固定オフセットの線形変換
// (よく知られた変換表、要出典確認不要な程度に標準化されている)

const HALFWIDTH_KATAKANA_OFFSET = 0xfec0; // codePoint - 0xFEC0 = JIS X0201バイト値

export interface EncodeResult {
  bytes: Uint8Array;
  // 変換できなかった文字(全角文字・かな漢字等)がある場合、スペースに置換したうえで
  // その一覧を返す(呼び出し元が警告表示できるように。生成自体は止めない)
  unsupportedChars: string[];
}

// 1文字をJIS X0201の1バイトへ変換する。対象外の文字はnullを返す
function encodeChar(ch: string): number | null {
  const code = ch.codePointAt(0)!;
  if (code >= 0x20 && code <= 0x7e) {
    // ASCII可視域はそのままJIS X0201ローマ字集合として扱う(0x5C/0x7Eの円記号/オーバーライン
    // 差異は口座名義・銀行名等の実用上の文字集合には現れないため無視する)
    return code;
  }
  if (code >= 0xff61 && code <= 0xff9f) {
    return code - HALFWIDTH_KATAKANA_OFFSET;
  }
  return null;
}

// 半角文字列(数字・半角カナ・基本記号)をJIS X0201の1バイト/文字としてエンコードする。
// 全角文字等、対象外の文字が含まれる場合はスペース(0x20)に置換し、unsupportedCharsに記録する
export function encodeHalfWidth(text: string): EncodeResult {
  const bytes: number[] = [];
  const unsupportedChars: string[] = [];
  for (const ch of text) {
    const byte = encodeChar(ch);
    if (byte === null) {
      unsupportedChars.push(ch);
      bytes.push(0x20);
    } else {
      bytes.push(byte);
    }
  }
  return { bytes: new Uint8Array(bytes), unsupportedChars };
}

// 固定長フィールド用: 半角文字列を指定バイト数に切り詰め/パディングする。
// align: "left"(空白パディング、氏名等) | "right"(0パディング、コード・金額等)
export function padField(
  value: string,
  byteLength: number,
  align: "left" | "right",
  padChar: string = align === "right" ? "0" : " ",
): string {
  const truncated = value.length > byteLength ? value.slice(0, byteLength) : value;
  const padCount = byteLength - truncated.length;
  if (padCount <= 0) return truncated;
  const pad = padChar.repeat(padCount);
  return align === "right" ? pad + truncated : truncated + pad;
}
