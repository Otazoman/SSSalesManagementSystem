// Item4-a: xlsx帳票テンプレートをコンパイルして得られるレイアウト記述の型。
// アップロード時(低頻度)にExcelJSで一度だけ生成しR2へ保存し、
// 見積送信等の高頻度パスではこのJSONをpdf-libで描画するだけにする(CPU予算対策)。

export interface CompiledCellBorder {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
}

export interface CompiledCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  // ページ左上を原点とした位置・サイズ(pt単位)。pdf-lib描画時にページ高さから引いてY座標に変換する。
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  // 元のセルテキスト({{token}}形式のプレースホルダーはそのまま埋め込まれている)
  text: string;
  // textに含まれるプレースホルダー名の一覧(例: ["partner_name"])。空配列なら純粋な静的テキスト
  placeholders: string[];
  fontSizePt: number;
  bold: boolean;
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  border: CompiledCellBorder;
  // "RRGGBB"形式(16進6桁)。塗りつぶし無しはnull
  fillColor: string | null;
  // "RRGGBB"形式(16進6桁)。未指定時は既定の濃いグレー
  fontColor: string;
}

export interface CompiledImage {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  // pdf-libが直接埋め込める形式のみ対応(png/jpeg)。base64エンコード済みのバイナリ
  extension: "png" | "jpeg" | "jpg";
  base64: string;
}

export interface CompiledLayout {
  version: 1;
  pageMarginsPt: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  // item.*プレースホルダーを含む行(明細のひな形行)。無ければnull。
  itemTemplateRow: number | null;
  cells: CompiledCell[];
  // Excelに直接貼り込まれた画像(ロゴ・印影等)。テキストを含まないため上記cellsとは別に保持する
  images: CompiledImage[];
}
