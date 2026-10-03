// 追加要望L-2-a: 赤伝(売上・仕入のマイナス伝票)の扱い。
// 売上・仕入の伝票は金額を「正」で保存し、伝票区分(documentType)で符号を解釈する
// (既存の返品/値引/赤伝(訂正)データとの互換のため)。SALE/PURCHASE以外の区分が赤伝。
export const RED_SLIP_DOCUMENT_TYPES = ["RETURN", "DISCOUNT", "CORRECTION"] as const;

// 元伝票(originalInvoiceId/originalRecognitionId)の指定が必須な区分。
// CORRECTION(赤伝(訂正))は元伝票を持たない自由入力の赤伝も起票できるため、任意とする
export const ORIGINAL_REQUIRED_DOCUMENT_TYPES = ["RETURN", "DISCOUNT"] as const;

export function isRedSlip(documentType: string | null | undefined): boolean {
  return (RED_SLIP_DOCUMENT_TYPES as readonly string[]).includes(documentType ?? "");
}

// 請求・支払の集計用: 赤伝は減算(マイナス)として扱う
export function signedAmount(documentType: string | null | undefined, amount: number): number {
  return isRedSlip(documentType) ? -amount : amount;
}
