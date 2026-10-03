// Item4-f: compute-render-instructions.tsから分割。1ページに収まらない明細件数の場合に
// 自動的に複数ページへ分割する computeRenderPages() を担当。
import { CompiledCell, CompiledLayout } from "./types";
import {
  PAGE_HEIGHT,
  ResolvedCell,
  ResolvedImage,
  buildRowIndex,
  computeRenderInstructions,
  computeTextMaxWidthPt,
  resolveCellText,
} from "./compute-render-instructions";

export interface ResolvedPage {
  cells: ResolvedCell[];
  images: ResolvedImage[];
}

function buildResolvedCell(
  cell: CompiledCell,
  text: string,
  topYPt: number,
  rowIndex: Map<number, CompiledCell[]>,
  tableRightEdgePt: number,
): ResolvedCell {
  return {
    text,
    xPt: cell.xPt,
    topYPt,
    widthPt: cell.widthPt,
    heightPt: cell.heightPt,
    fontSizePt: cell.fontSizePt,
    bold: cell.bold,
    align: cell.align,
    verticalAlign: cell.verticalAlign,
    border: cell.border,
    textMaxWidthPt: computeTextMaxWidthPt(cell, rowIndex.get(cell.row) ?? [], tableRightEdgePt),
    fillColor: cell.fillColor,
    fontColor: cell.fontColor,
  };
}

// Item4-a: 明細ひな形行より上を「ヘッダー」、下を「フッター」とみなし、1ページに収まらない
// 明細件数の場合は自動的に複数ページへ分割する。ヘッダー全体(タイトル・宛先・日付等)は
// 1ページ目のみに描画するが、そのうち明細ひな形行の直上の行(摘要・数量・単位等の列見出し行、
// Excelの「印刷タイトル行」に相当)だけは2ページ目以降にも繰り返し描画する
// (2ページ目以降が列見出しの無い明細だけのページになってしまう不具合をユーザー指摘で修正)。
// フッター(小計・消費税・合計)は総額の二重表示を避けるため最終ページのみに描画する。
export function computeRenderPages(
  layout: CompiledLayout,
  values: Record<string, string>,
  items: Record<string, string>[],
): ResolvedPage[] {
  const { top: marginTop, bottom: marginBottom } = layout.pageMarginsPt;
  const contentHeight = PAGE_HEIGHT - marginTop - marginBottom;

  const itemTemplateRow = layout.itemTemplateRow;
  if (!itemTemplateRow) {
    // 明細ひな形行が無いテンプレートはそもそも件数に応じて伸び縮みしないため、常に1ページ
    return [
      {
        cells: computeRenderInstructions(layout, values, items),
        images: (layout.images ?? []).map((img) => ({ ...img, topYPt: img.yPt })),
      },
    ];
  }

  const headerCells = layout.cells.filter((c) => c.row < itemTemplateRow);
  const itemCells = layout.cells.filter((c) => c.row === itemTemplateRow);
  const footerCells = layout.cells.filter((c) => c.row > itemTemplateRow);

  // 明細ひな形行の直上の行(列見出し行)のみ、2ページ目以降の先頭に繰り返す対象とする
  const titleRowCells = layout.cells.filter((c) => c.row === itemTemplateRow - 1);
  const titleRowTopYPt =
    titleRowCells.length > 0 ? Math.min(...titleRowCells.map((c) => c.yPt)) : 0;
  const titleRowHeight =
    titleRowCells.length > 0 ? Math.max(...titleRowCells.map((c) => c.yPt + c.heightPt)) - titleRowTopYPt : 0;

  const templateRowHeight =
    itemCells.length > 0 ? Math.max(...itemCells.map((c) => c.heightPt)) : 0;
  const itemRowTopYPt = itemCells.length > 0 ? Math.min(...itemCells.map((c) => c.yPt)) : 0;
  const itemRowBottomYPt = itemRowTopYPt + templateRowHeight;

  const headerBlockHeight = headerCells.reduce(
    (max, c) => Math.max(max, c.yPt + c.heightPt),
    0,
  );
  const footerBlockHeight = footerCells.reduce(
    (max, c) => Math.max(max, c.yPt + c.heightPt - itemRowBottomYPt),
    0,
  );

  const rowIndex = buildRowIndex(layout.cells);
  const tableRightEdgePt = layout.cells.reduce(
    (max, c) => Math.max(max, c.xPt + c.widthPt),
    0,
  );

  const headerImages = (layout.images ?? []).filter(
    (img) => img.yPt + img.heightPt <= itemRowTopYPt,
  );
  const footerImages = (layout.images ?? []).filter((img) => img.yPt >= itemRowBottomYPt);

  const pages: ResolvedPage[] = [];
  let itemIndex = 0;
  let pageNumber = 0;

  do {
    const isFirstPage = pageNumber === 0;
    // 1ページ目はヘッダー全体、2ページ目以降は繰り返す列見出し行の高さのみを差し引く
    const availableHeight = contentHeight - (isFirstPage ? headerBlockHeight : titleRowHeight);
    const rowHeight = templateRowHeight || 1;

    const maxItemsWithFooter = Math.max(
      Math.floor((availableHeight - footerBlockHeight) / rowHeight),
      0,
    );
    const remainingItems = items.length - itemIndex;
    const isLastPage = remainingItems <= maxItemsWithFooter;

    let itemsOnThisPage: number;
    if (isLastPage) {
      itemsOnThisPage = remainingItems;
    } else {
      const maxItemsNoFooter = Math.max(Math.floor(availableHeight / rowHeight), 0);
      itemsOnThisPage = Math.min(maxItemsNoFooter, remainingItems);
      if (itemsOnThisPage === 0) {
        throw new Error(
          `テンプレートのヘッダー/フッターが大きすぎて明細行を1行も配置できません(ページ${pageNumber + 1})`,
        );
      }
    }

    const cells: ResolvedCell[] = [];
    const images: ResolvedImage[] = [];

    if (isFirstPage) {
      for (const cell of headerCells) {
        cells.push(
          buildResolvedCell(
            cell,
            resolveCellText(cell, values, null),
            cell.yPt,
            rowIndex,
            tableRightEdgePt,
          ),
        );
      }
      for (const img of headerImages) {
        images.push({ ...img, topYPt: img.yPt });
      }
    } else {
      for (const cell of titleRowCells) {
        const relativeY = cell.yPt - titleRowTopYPt;
        cells.push(
          buildResolvedCell(
            cell,
            resolveCellText(cell, values, null),
            relativeY,
            rowIndex,
            tableRightEdgePt,
          ),
        );
      }
    }

    const itemsBaseYPt = isFirstPage ? itemRowTopYPt : titleRowHeight;
    const pageItems = items.slice(itemIndex, itemIndex + itemsOnThisPage);
    pageItems.forEach((item, idx) => {
      for (const cell of itemCells) {
        const relativeY = cell.yPt - itemRowTopYPt;
        cells.push(
          buildResolvedCell(
            cell,
            resolveCellText(cell, values, item),
            itemsBaseYPt + idx * templateRowHeight + relativeY,
            rowIndex,
            tableRightEdgePt,
          ),
        );
      }
    });

    if (isLastPage) {
      const lastItemBottomYPt = itemsBaseYPt + pageItems.length * templateRowHeight;
      for (const cell of footerCells) {
        const relativeY = cell.yPt - itemRowBottomYPt;
        cells.push(
          buildResolvedCell(
            cell,
            resolveCellText(cell, values, null),
            lastItemBottomYPt + relativeY,
            rowIndex,
            tableRightEdgePt,
          ),
        );
      }
      for (const img of footerImages) {
        images.push({ ...img, topYPt: lastItemBottomYPt + (img.yPt - itemRowBottomYPt) });
      }
    }

    pages.push({ cells, images });
    itemIndex += itemsOnThisPage;
    pageNumber++;
  } while (itemIndex < items.length);

  return pages;
}
