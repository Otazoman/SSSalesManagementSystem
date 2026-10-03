// Item4-a: xlsx帳票テンプレート → CompiledLayout(layout.json)へのコンパイル。
// アップロード時(低頻度)にCron経由で1回だけ実行する想定。技術検証(scratchpadでのwrangler dev実測)により、
// この処理は同期リクエスト内では実行できない(無料プランのCPU予算10ms/リクエストに対し実測7〜11ms)ため、
// 必ず非同期(process-report-template-compiles.ts、Cron Trigger)から呼び出すこと。
import ExcelJS from "exceljs";
import {
  CompiledCell,
  CompiledCellBorder,
  CompiledImage,
  CompiledLayout,
} from "./types";

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
const DEFAULT_COL_WIDTH_CHARS = 8.43;
const DEFAULT_ROW_HEIGHT_PT = 15;
const DEFAULT_FONT_SIZE_PT = 10;
const DEFAULT_FONT_COLOR = "1A1A1A"; // 既存の描画側デフォルト rgb(0.1, 0.1, 0.1) 相当
const INCH_TO_PT = 72;

// Office既定テーマ(Office 2013-2022)のクラー順。ExcelJSはテーマXMLを解析済みの形では公開していないため、
// ビジネステンプレートの大半が使う既定パレットをフォールバックとして採用する
// (順序はOOXMLの色インデックス仕様: 0=lt1/背景1, 1=dk1/文字1, 2=lt2/背景2, 3=dk2/文字2, 4-9=accent1-6)
const OFFICE_THEME_COLORS = [
  "FFFFFF",
  "000000",
  "E7E6E6",
  "44546A",
  "4472C4",
  "ED7D31",
  "A5A5A5",
  "FFC000",
  "5B9BD5",
  "70AD47",
];

// ARGB(先頭2桁がアルファ)またはテーマカラー指定から"RRGGBB"を解決する。指定が無ければnull
function resolveColor(color: Partial<ExcelJS.Color> | undefined): string | null {
  if (!color) return null;
  if (color.argb && color.argb.length >= 6) return color.argb.slice(-6);
  if (color.theme !== undefined) return OFFICE_THEME_COLORS[color.theme] ?? null;
  return null;
}

// 単色塗りつぶし(パターン=solid)のセル背景色。グラデーション等の非対応パターンは無視(背景無しとして扱う)
function cellFillColor(style: Partial<ExcelJS.Style> | undefined): string | null {
  const fill = style?.fill;
  if (!fill || fill.type !== "pattern" || fill.pattern !== "solid") return null;
  return resolveColor((fill as ExcelJS.FillPattern).fgColor);
}

function extractPlaceholders(text: string): string[] {
  const matches = [...text.matchAll(PLACEHOLDER_PATTERN)];
  return matches.map((m) => m[1]);
}

// Excelの列幅(文字数単位)をpt換算する近似式(Calibri 11既定フォント基準、多くのxlsxライブラリで採用されている近似)
function colWidthCharsToPt(widthChars: number): number {
  const px = Math.round(widthChars * 7 + 5);
  return px * 0.75;
}

function cellAlign(
  alignment: Partial<ExcelJS.Alignment> | undefined,
): "left" | "center" | "right" {
  if (alignment?.horizontal === "center") return "center";
  if (alignment?.horizontal === "right") return "right";
  return "left";
}

// Excelの既定値(未指定時)は"bottom"だが、既存の描画は"top"相当の位置に固定していたため、
// 明示的に"top"/"bottom"が無いセルは互換のため"top"のまま扱う("middle"だけは確実に反映する)
function cellVerticalAlign(
  alignment: Partial<ExcelJS.Alignment> | undefined,
): "top" | "middle" | "bottom" {
  if (alignment?.vertical === "middle") return "middle";
  if (alignment?.vertical === "bottom") return "bottom";
  return "top";
}

function cellBorder(style: Partial<ExcelJS.Style> | undefined): CompiledCellBorder {
  const border = style?.border;
  return {
    top: !!border?.top?.style,
    bottom: !!border?.bottom?.style,
    left: !!border?.left?.style,
    right: !!border?.right?.style,
  };
}

interface MergeInfo {
  masterRow: number;
  masterCol: number;
  rowSpan: number;
  colSpan: number;
}

// ExcelJSは結合セルの範囲をworksheet.model.merges(文字列の範囲表記の配列)で公開している。
function buildMergeMap(worksheet: ExcelJS.Worksheet): Map<string, MergeInfo> {
  const map = new Map<string, MergeInfo>();
  const merges: string[] = (worksheet.model as { merges?: string[] }).merges || [];

  for (const rangeStr of merges) {
    const [startRef, endRef] = rangeStr.split(":");
    if (!startRef || !endRef) continue;
    const start = worksheet.getCell(startRef).fullAddress;
    const end = worksheet.getCell(endRef).fullAddress;
    const info: MergeInfo = {
      masterRow: start.row,
      masterCol: start.col,
      rowSpan: end.row - start.row + 1,
      colSpan: end.col - start.col + 1,
    };
    for (let r = start.row; r <= end.row; r++) {
      for (let c = start.col; c <= end.col; c++) {
        map.set(`${r}:${c}`, info);
      }
    }
  }
  return map;
}

export async function compileTemplateLayout(
  fileBuffer: ArrayBuffer,
): Promise<CompiledLayout> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("テンプレートにシートが存在しません");
  }

  const marginsInch = worksheet.pageSetup?.margins;
  const pageMarginsPt = {
    top: (marginsInch?.top ?? 0.75) * INCH_TO_PT,
    bottom: (marginsInch?.bottom ?? 0.75) * INCH_TO_PT,
    left: (marginsInch?.left ?? 0.7) * INCH_TO_PT,
    right: (marginsInch?.right ?? 0.7) * INCH_TO_PT,
  };

  const defaultColWidthChars =
    (worksheet as unknown as { properties: { defaultColWidth?: number } })
      .properties.defaultColWidth ?? DEFAULT_COL_WIDTH_CHARS;
  const defaultRowHeightPt =
    worksheet.properties.defaultRowHeight ?? DEFAULT_ROW_HEIGHT_PT;

  const colCount = worksheet.columnCount;
  const colWidthsPt: number[] = [];
  for (let c = 1; c <= colCount; c++) {
    const col = worksheet.getColumn(c);
    colWidthsPt[c] = colWidthCharsToPt(col.width ?? defaultColWidthChars);
  }
  const colOffsetsPt: number[] = [0];
  for (let c = 1; c <= colCount; c++) {
    colOffsetsPt[c + 1] = (colOffsetsPt[c] ?? 0) + (colWidthsPt[c] ?? 0);
  }

  const mergeMap = buildMergeMap(worksheet);

  const cells: CompiledCell[] = [];
  const rowOffsetsPt: number[] = [0];
  let itemTemplateRow: number | null = null;

  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const heightPt = row.height ?? defaultRowHeightPt;
    rowOffsetsPt[rowNumber + 1] = (rowOffsetsPt[rowNumber] ?? 0) + heightPt;

    // includeEmpty:falseだと、値が無く罫線/塗りつぶしのみのセル(ValueType.Null)がExcelJS自身の
    // フィルタで最初から除外されてしまう(このコールバックに一切渡ってこない)ため、装飾専用セルを
    // 拾うには true にしたうえで、下の空セル判定(テキストも装飾も無ければ除外)で絞り込む
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const merge = mergeMap.get(`${rowNumber}:${colNumber}`);
      // 結合セルは左上(マスター)セルのみを1件として記録する
      if (merge && (merge.masterRow !== rowNumber || merge.masterCol !== colNumber)) {
        return;
      }

      if (
        cell.value !== null &&
        typeof cell.value === "object" &&
        ("formula" in cell.value || "sharedFormula" in cell.value)
      ) {
        // Excel数式が残ったまま(=プレースホルダーへの置換漏れ)のセルはコンパイラで評価できない。
        // 値だけを機械的に文字列化すると"[object Object]"になり気付きにくいため、ここで明示的に失敗させる。
        throw new Error(
          `セル${cell.address}にExcelの数式が残っています。プレースホルダー({{...}})に置き換えてください。`,
        );
      }

      const rawText =
        typeof cell.value === "string"
          ? cell.value
          : cell.value != null
            ? String(cell.value)
            : "";

      const border = cellBorder(cell.style);
      const fillColor = cellFillColor(cell.style);
      // テキストが空でも罫線・塗りつぶしがあれば、備考欄の枠を複数列に渡って伸ばす等の
      // 装飾目的のセルとして扱い、除外しない(文字も装飾も無い純粋な空セルのみ除外する)
      const hasDecoration = border.top || border.bottom || border.left || border.right || fillColor !== null;
      if (rawText.trim() === "" && !hasDecoration) return;

      const placeholders = extractPlaceholders(rawText);
      if (placeholders.some((p) => p.startsWith("item."))) {
        itemTemplateRow = itemTemplateRow ?? rowNumber;
      }

      cells.push({
        row: rowNumber,
        col: colNumber,
        rowSpan: merge?.rowSpan ?? 1,
        colSpan: merge?.colSpan ?? 1,
        // yPtは行ループ完了後にrowOffsetsPtが確定してから一括で補完する(下記参照)
        xPt: colOffsetsPt[colNumber] ?? 0,
        yPt: 0,
        widthPt: 0,
        heightPt: 0,
        text: rawText,
        placeholders,
        fontSizePt: cell.font?.size ?? DEFAULT_FONT_SIZE_PT,
        bold: !!cell.font?.bold,
        align: cellAlign(cell.alignment),
        verticalAlign: cellVerticalAlign(cell.alignment),
        border,
        fillColor,
        fontColor: resolveColor(cell.font?.color) ?? DEFAULT_FONT_COLOR,
      });
    });
  });

  // 行高はシート全体を読み終えるまで確定しないため、幅/高さ/Y座標をここで補完する
  for (const cell of cells) {
    const rowSpan = cell.rowSpan;
    const colSpan = cell.colSpan;
    cell.yPt = rowOffsetsPt[cell.row] ?? 0;
    cell.heightPt =
      (rowOffsetsPt[cell.row + rowSpan] ?? rowOffsetsPt[cell.row] ?? 0) -
      (rowOffsetsPt[cell.row] ?? 0);
    cell.widthPt =
      (colOffsetsPt[cell.col + colSpan] ?? colOffsetsPt[cell.col] ?? 0) -
      (colOffsetsPt[cell.col] ?? 0);
  }

  const images = extractImages(
    worksheet,
    workbook,
    colOffsetsPt,
    rowOffsetsPt,
    colWidthCharsToPt(defaultColWidthChars),
    defaultRowHeightPt,
  );

  return {
    version: 1,
    pageMarginsPt,
    itemTemplateRow,
    cells,
    images,
  };
}

const EMU_PER_PT = 12700; // 914400 EMU/inch ÷ 72pt/inch
const SUPPORTED_IMAGE_EXTENSIONS = new Set(["png", "jpeg", "jpg"]);

// 画像が使用範囲(セルが存在する行/列)より右・下に配置されている場合、colOffsetsPt/rowOffsetsPtに
// 該当インデックスが無くwidth/heightが0になってしまう。既定幅/高さで必要な分だけ配列を伸ばす
function ensureOffset(offsets: number[], index: number, defaultStep: number): number {
  while (offsets[index] === undefined) {
    const lastIndex = offsets.length - 1;
    offsets[lastIndex + 1] = (offsets[lastIndex] ?? 0) + defaultStep;
  }
  return offsets[index];
}

// Excelに直接貼り込まれた画像(ロゴ・印影等)の位置・サイズをpt単位で算出する。
// セルのテキストとは独立した要素のため、cellsとは別配列で保持する(未対応形式は無視して継続)
function extractImages(
  worksheet: ExcelJS.Worksheet,
  workbook: ExcelJS.Workbook,
  colOffsetsPt: number[],
  rowOffsetsPt: number[],
  defaultColWidthPt: number,
  defaultRowHeightPt: number,
): CompiledImage[] {
  const images: CompiledImage[] = [];

  for (const anchor of worksheet.getImages()) {
    const media = workbook.getImage(Number(anchor.imageId));
    if (!media?.buffer || !SUPPORTED_IMAGE_EXTENSIONS.has(media.extension)) continue;

    const tl = anchor.range.tl;
    const br = anchor.range.br;
    const xPt =
      ensureOffset(colOffsetsPt, tl.nativeCol + 1, defaultColWidthPt) +
      tl.nativeColOff / EMU_PER_PT;
    const yPt =
      ensureOffset(rowOffsetsPt, tl.nativeRow + 1, defaultRowHeightPt) +
      tl.nativeRowOff / EMU_PER_PT;
    const xEndPt =
      ensureOffset(colOffsetsPt, br.nativeCol + 1, defaultColWidthPt) +
      br.nativeColOff / EMU_PER_PT;
    const yEndPt =
      ensureOffset(rowOffsetsPt, br.nativeRow + 1, defaultRowHeightPt) +
      br.nativeRowOff / EMU_PER_PT;

    images.push({
      xPt,
      yPt,
      widthPt: Math.max(xEndPt - xPt, 0),
      heightPt: Math.max(yEndPt - yPt, 0),
      extension: media.extension as CompiledImage["extension"],
      base64: Buffer.from(media.buffer).toString("base64"),
    });
  }

  return images;
}
