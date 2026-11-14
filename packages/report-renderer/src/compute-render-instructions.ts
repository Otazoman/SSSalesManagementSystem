// Item4-a Stage2: CompiledLayout + プレースホルダー値 から、実際の描画に必要な「解決済みセル」の
// 一覧を計算する純粋関数(pdf-lib/fontkitに依存しない)。明細ひな形行の複製・フッターのシフト・
// プレースホルダー文字列の置換・1ページ収まりチェックをここに集約し、pdf-lib描画部分から分離することで
// テスト時にフォントファイルの読み込みを必要としないようにしている。
import { CompiledCell, CompiledImage, CompiledLayout } from "./types";

// compute-render-pages.tsからも利用するためexport
export const PAGE_HEIGHT = 841.89; // A4(pt)

export interface ResolvedCell {
  text: string;
  xPt: number;
  topYPt: number; // ページ左上を原点としたセル上端のY(pt)
  widthPt: number;
  heightPt: number;
  fontSizePt: number;
  bold: boolean;
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  border: CompiledCell["border"];
  // Excelの「同じ行の右隣が空セルならテキストがそこへはみ出す」挙動を再現するための、
  // 文字を収める判定専用の幅(pt)。widthPt(罫線の描画位置)は変更せずそのまま保つ
  textMaxWidthPt: number;
  fillColor: string | null;
  fontColor: string;
}

export interface ResolvedImage {
  xPt: number;
  topYPt: number;
  widthPt: number;
  heightPt: number;
  extension: CompiledImage["extension"];
  base64: string;
}

// 同じ行にある他のセルの位置から、右方向へどこまで空いているか(はみ出せるか)を算出する。
// widthPt(罫線の描画位置)は変更しない。右揃えのセルは自身の幅より右へはみ出す意味がないため対象外
// (compute-render-pages.tsからも利用するためexport)
export function computeTextMaxWidthPt(
  cell: CompiledCell,
  rowCells: CompiledCell[],
  tableRightEdgePt: number,
): number {
  if (cell.align === "right") return cell.widthPt;

  let rightBoundary = tableRightEdgePt;
  for (const other of rowCells) {
    if (other.col >= cell.col + cell.colSpan && other.xPt < rightBoundary) {
      rightBoundary = other.xPt;
    }
  }
  return Math.max(rightBoundary - cell.xPt, cell.widthPt);
}

// compute-render-pages.tsからも利用するためexport
export function buildRowIndex(cells: CompiledCell[]): Map<number, CompiledCell[]> {
  const byRow = new Map<number, CompiledCell[]>();
  for (const cell of cells) {
    const list = byRow.get(cell.row);
    if (list) list.push(cell);
    else byRow.set(cell.row, [cell]);
  }
  return byRow;
}

// compute-render-pages.tsからも利用するためexport
export function resolveCellText(
  cell: CompiledCell,
  values: Record<string, string>,
  itemValues: Record<string, string> | null,
): string {
  if (cell.placeholders.length === 0) return cell.text;

  let resolved = cell.text;
  for (const token of cell.placeholders) {
    let replacement = "";
    if (token.startsWith("item.")) {
      const key = token.slice("item.".length);
      replacement = itemValues?.[key] ?? "";
    } else {
      replacement = values[token] ?? "";
    }
    const pattern = new RegExp(`\\{\\{\\s*${token.replace(/\./g, "\\.")}\\s*\\}\\}`, "g");
    resolved = resolved.replace(pattern, replacement);
  }
  return resolved;
}

export function computeRenderInstructions(
  layout: CompiledLayout,
  values: Record<string, string>,
  items: Record<string, string>[],
): ResolvedCell[] {
  const { top: marginTop, bottom: marginBottom } = layout.pageMarginsPt;
  const contentHeight = PAGE_HEIGHT - marginTop - marginBottom;

  const itemTemplateRow = layout.itemTemplateRow;
  const itemRowCells = itemTemplateRow
    ? layout.cells.filter((c) => c.row === itemTemplateRow)
    : [];
  const templateRowHeight =
    itemRowCells.length > 0 ? Math.max(...itemRowCells.map((c) => c.heightPt)) : 0;

  const itemCount = items.length;
  // ひな形は「1行分のitem行が存在する」前提でデザインされているため、シフト量はN件描画した差分になる
  const shiftPt = itemTemplateRow ? Math.max(itemCount - 1, -1) * templateRowHeight : 0;

  const rowIndex = buildRowIndex(layout.cells);
  const tableRightEdgePt = layout.cells.reduce(
    (max, c) => Math.max(max, c.xPt + c.widthPt),
    0,
  );

  const resolved: ResolvedCell[] = [];

  for (const cell of layout.cells) {
    const textMaxWidthPt = computeTextMaxWidthPt(
      cell,
      rowIndex.get(cell.row) ?? [],
      tableRightEdgePt,
    );

    if (itemTemplateRow && cell.row === itemTemplateRow) {
      items.forEach((item, index) => {
        resolved.push({
          text: resolveCellText(cell, values, item),
          xPt: cell.xPt,
          topYPt: cell.yPt + index * templateRowHeight,
          widthPt: cell.widthPt,
          heightPt: cell.heightPt,
          fontSizePt: cell.fontSizePt,
          bold: cell.bold,
          align: cell.align,
          verticalAlign: cell.verticalAlign,
          border: cell.border,
          textMaxWidthPt,
          fillColor: cell.fillColor,
          fontColor: cell.fontColor,
        });
      });
      continue;
    }

    const rowShift = itemTemplateRow && cell.row > itemTemplateRow ? shiftPt : 0;
    resolved.push({
      text: resolveCellText(cell, values, null),
      xPt: cell.xPt,
      topYPt: cell.yPt + rowShift,
      widthPt: cell.widthPt,
      heightPt: cell.heightPt,
      fontSizePt: cell.fontSizePt,
      bold: cell.bold,
      align: cell.align,
      verticalAlign: cell.verticalAlign,
      border: cell.border,
      textMaxWidthPt,
      fillColor: cell.fillColor,
      fontColor: cell.fontColor,
    });
  }

  const estimatedBottomPt = resolved.reduce(
    (max, c) => Math.max(max, c.topYPt + c.heightPt),
    0,
  );
  if (estimatedBottomPt > contentHeight) {
    throw new Error(
      `テンプレートのレイアウトが1ページに収まりません(推定高さ${Math.round(estimatedBottomPt)}pt > ${Math.round(contentHeight)}pt)。明細件数: ${itemCount}`,
    );
  }

  return resolved;
}
