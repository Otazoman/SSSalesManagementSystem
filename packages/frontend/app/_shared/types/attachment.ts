// 添付ファイル型（quotes/products/partners/warehouses等で同一形状のまま5箇所以上再定義されている）の共通形状。
// 既存の重複定義の置き換えはPhase4で該当featureに触れる際に行う。

// TFileTypeはfeatureごとに異なる場合がある（例: productsは"IMAGE"|"SPEC_SHEET"|"OTHER"の狭いunion）ため、
// ジェネリクスで上書き可能にする（デフォルトはstring、既存の呼び出し箇所に影響しない）。
export interface AttachmentRecord<TFileType extends string = string> {
  id?: string;
  fileName: string;
  storageType: "R2" | "GOOGLE_DRIVE" | "EXTERNAL_LINK";
  attachmentR2Path?: string | null;
  externalUrl?: string | null;
  fileType: TFileType;
}
