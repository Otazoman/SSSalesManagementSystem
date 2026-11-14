// Item4-a Stage2: computeRenderPages()の結果をpdf-libで実際にPDFへ描画する薄いラッパー。
// レイアウト計算(明細ひな形行の複製・ヘッダー/フッターのページ割り当て・プレースホルダー解決)は
// compute-render-instructions.tsに分離済み。この関数自体はベクター描画のみで軽量(xlsx解析を含まない)
// なため、既存pdfGenerator.tsと同様に同期リクエスト内(見積送信時)で実行してよい。
// 明細件数が多く1ページに収まらない場合は自動的に複数ページへ分割する(v1: 継続ページへの
// 列見出し等の繰り返しは無い)。
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { CompiledImage, CompiledLayout } from "./types";
import { ResolvedCell, ResolvedImage } from "./compute-render-instructions";
import { computeRenderPages } from "./compute-render-pages";
import { fitTextToWidth } from "./fit-text";

const PAGE_WIDTH = 595.27;
const PAGE_HEIGHT = 841.89;
const CELL_PADDING_PT = 2;
const DEFAULT_TEXT_COLOR = "1A1A1A";

function hexToRgb(hex: string) {
  const n = parseInt(hex, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function drawCell(
  page: PDFPage,
  font: PDFFont,
  cell: ResolvedCell,
  marginLeft: number,
  cellTopY: number,
): void {
  const left = marginLeft + cell.xPt;
  const right = left + cell.widthPt;
  const top = cellTopY;
  const bottom = cellTopY - cell.heightPt;

  // Excelのセル背景色(単色塗りつぶしのみ対応)。文字・罫線より先に描画する
  if (cell.fillColor) {
    page.drawRectangle({
      x: left,
      y: bottom,
      width: cell.widthPt,
      height: cell.heightPt,
      color: hexToRgb(cell.fillColor),
    });
  }

  if (cell.text) {
    const fitted = fitTextToWidth(
      (text, size) => font.widthOfTextAtSize(text, size),
      cell.text,
      cell.fontSizePt,
      cell.textMaxWidthPt,
    );

    let x = marginLeft + cell.xPt + CELL_PADDING_PT;
    if (cell.align === "center") {
      x = marginLeft + cell.xPt + (cell.widthPt - fitted.width) / 2;
    } else if (cell.align === "right") {
      x = marginLeft + cell.xPt + cell.widthPt - fitted.width - CELL_PADDING_PT;
    }
    // Excelのセル内の上下配置(vertical alignment)を反映する。日本語フォントはLatin書体の
    // 経験則(ascent≒0.75em/descent≒0.25em)が全く当てはまらないことがあるため
    // (実測: 使用フォントはascent≒1.152em/descent≒0.458em)、埋め込みフォントの実際の
    // メトリクスから算出する
    const ascentPt = font.heightAtSize(fitted.size, { descender: false });
    const totalTextHeightPt = font.heightAtSize(fitted.size);
    const descentPt = totalTextHeightPt - ascentPt;

    let baselineY: number;
    if (cell.verticalAlign === "middle") {
      baselineY = cellTopY - cell.heightPt / 2 + (descentPt - ascentPt) / 2;
    } else if (cell.verticalAlign === "bottom") {
      baselineY = cellTopY - cell.heightPt + descentPt + CELL_PADDING_PT;
    } else {
      baselineY = cellTopY - ascentPt - CELL_PADDING_PT;
    }
    page.drawText(fitted.text, {
      x,
      y: baselineY,
      size: fitted.size,
      font,
      color: hexToRgb(cell.fontColor || DEFAULT_TEXT_COLOR),
    });
  }

  const lineColor = rgb(0.3, 0.3, 0.3);
  const thickness = 0.5;

  if (cell.border.top) {
    page.drawLine({ start: { x: left, y: top }, end: { x: right, y: top }, thickness, color: lineColor });
  }
  if (cell.border.bottom) {
    page.drawLine({ start: { x: left, y: bottom }, end: { x: right, y: bottom }, thickness, color: lineColor });
  }
  if (cell.border.left) {
    page.drawLine({ start: { x: left, y: top }, end: { x: left, y: bottom }, thickness, color: lineColor });
  }
  if (cell.border.right) {
    page.drawLine({ start: { x: right, y: top }, end: { x: right, y: bottom }, thickness, color: lineColor });
  }
}

async function embedImage(
  pdfDoc: PDFDocument,
  cache: Map<string, PDFImage>,
  img: ResolvedImage,
): Promise<PDFImage | null> {
  const cacheKey = `${img.extension}:${img.base64.length}:${img.base64.slice(0, 32)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const bytes = Uint8Array.from(atob(img.base64), (c) => c.charCodeAt(0));
  const embedded =
    img.extension === "png"
      ? await pdfDoc.embedPng(bytes)
      : await pdfDoc.embedJpg(bytes);
  cache.set(cacheKey, embedded);
  return embedded;
}

function drawImage(
  page: PDFPage,
  pdfImage: PDFImage,
  img: ResolvedImage,
  marginLeft: number,
  imgTopY: number,
): void {
  page.drawImage(pdfImage, {
    x: marginLeft + img.xPt,
    y: imgTopY - img.heightPt,
    width: img.widthPt,
    height: img.heightPt,
  });
}

export async function renderLayoutToPdf(
  layout: CompiledLayout,
  values: Record<string, string>,
  items: Record<string, string>[],
  fontBuffer: ArrayBuffer,
): Promise<Uint8Array> {
  const resolvedPages = computeRenderPages(layout, values, items);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBuffer, { subset: true });

  const { top: marginTop, left: marginLeft } = layout.pageMarginsPt;
  const imageCache = new Map<string, PDFImage>();

  for (const resolvedPage of resolvedPages) {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    for (const img of resolvedPage.images) {
      const pdfImage = await embedImage(pdfDoc, imageCache, img);
      if (!pdfImage) continue;
      const imgTopY = PAGE_HEIGHT - marginTop - img.topYPt;
      drawImage(page, pdfImage, img, marginLeft, imgTopY);
    }

    for (const cell of resolvedPage.cells) {
      const cellTopY = PAGE_HEIGHT - marginTop - cell.topYPt;
      drawCell(page, font, cell, marginLeft, cellTopY);
    }
  }

  return await pdfDoc.save({ useObjectStreams: true });
}
