/**
 * ラベルに描くバーコードの種類を、値から決める(BUG-007)。
 * チェックデジットが正しい13桁・8桁の数字は JAN(EAN-13・EAN-8)として描く。市販品・インストアコード
 * (20〜29 で始まる JAN)と同じ形になり、同じ長さなら CODE128 より線が太くなって読み取りやすい。
 * それ以外(英字を含む値、桁数やチェックデジットが合わない数字)は CODE128 で描く。
 * 名前は JsBarcode の format 名。
 */
export type LabelBarcodeFormat = "EAN13" | "EAN8" | "CODE128";

/** JAN(EAN-13・EAN-8)のチェックデジットが正しいか */
export function hasValidJanCheckDigit(digits: string): boolean {
  if (!/^\d+$/.test(digits) || (digits.length !== 13 && digits.length !== 8)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    // チェックデジットの左隣から数えて奇数番目に3、偶数番目に1を掛ける
    const weight = (body.length - i) % 2 === 1 ? 3 : 1;
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

export function labelBarcodeFormat(value: string): LabelBarcodeFormat {
  const trimmed = value.trim();
  if (hasValidJanCheckDigit(trimmed)) return trimmed.length === 13 ? "EAN13" : "EAN8";
  return "CODE128";
}
