// #14-2③: 帳票PDF(*-pdf.service.ts、pdfGenerator.tsの固定レイアウト)6ファイルに
// 同じ文字列がそれぞれ埋め込まれていたため、1箇所にまとめる(見積書・受注・発注・
// 請求・売上計上・仕入計上のPDF生成で共通して使う既定値)。

// 支払条件が未設定の場合の既定表示
export const DEFAULT_PAYMENT_TERMS = "貴社お支払基準に準拠";

// 明細の品目名が取得できない場合の代替表示
export const DEFAULT_ITEM_NAME = "マスタ品目";
