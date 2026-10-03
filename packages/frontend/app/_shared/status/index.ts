// 追加要望J-2-c: アプリ内の日本語⇔英語(コード値)ステータス変換ロジックを、どこにあるか
// 1箇所(このファイル)から把握・参照できるようにするバレル。
//
// ドメインごとに語彙(キー集合)が異なるため辞書自体は統合していない(意図的な設計。各ファイル冒頭の
// コメント参照)。新しいステータス系の変換表を追加する場合は、このディレクトリに1ファイル追加し、
// ここに再エクスポートを1行足すこと。
export * from "./document-lifecycle-status";
export * from "./approval-result-status";
export * from "./journal-posting-status";
export * from "./master-lifecycle-status";
export * from "./mail-delivery-status";
export * from "./reconciliation-status";
export * from "./billing-payment-header-status";
