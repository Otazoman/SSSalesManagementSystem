// Item6 Phase6-4: 外部倉庫向け指示書(出荷指示書/入荷指示書)のPDF生成。
// 既存のutils/pdfGenerator.ts(generateDocumentPDF)は請求書系(単価・合計金額を持つ)向けの
// 専用レイアウトで、指示書(単価・金額を持たない、数量指示のみの文書)とは項目構成が異なるため
// 共通化せず、同じ低レベルAPI(pdf-lib + fontkit、SYSTEM_BUCKETのフォント/ロゴ/社印)のみを踏襲した
// 専用の軽量レンダラーとして新設する。
import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { fitTextToWidth } from "./fit-text";

export interface InstructionPdfItem {
  itemId: string;
  itemName: string;
  lotNumber: string;
  quantity: number;
  unit?: string | null;
  remark?: string | null;
  // Item7残課題7追加: 納品書のみ使用(受注紐づけ明細のみ設定、単独出庫明細はnull/undefined)
  unitPrice?: number | null;
  amount?: number | null;
}

export interface InstructionPdfData {
  documentTitle: string; // "出荷指示書" | "入荷指示書"
  code: string;
  date: string;
  recipientLabel: string; // "出荷先(外部倉庫)" | "入荷先(外部倉庫)"
  recipientName: string;
  recipientAddress?: string | null;
  recipientTel?: string | null;
  partnerLabel: string; // "得意先" | "仕入先"
  partnerName: string;
  scheduledDateLabel: string; // "出荷予定日" | "入荷予定日"
  scheduledDate: string;
  companyName: string;
  companyZip?: string | null;
  companyAddress: string;
  companyTel: string;
  companyFax: string;
  memo?: string | null;
  staffName?: string | null; // 指示書の作成者(社員名)
  items: InstructionPdfItem[];
  // Item6 Phase6-4追加: 「どこに対して出荷するか」(納品先)情報。出荷指示書のみで使用する
  // (倉庫マスタの宛先=指示書を受け取る外部倉庫、納品先=外部倉庫が実際に商品を送り届ける先で、別概念)
  deliveryAddressee?: string | null;
  deliveryLocation?: string | null;
  deliveryPhone?: string | null;
  // Item7残課題7追加: 納品書のみ使用。設定時のみ単価・金額列を描画し、参照情報ボックスに
  // 受注番号の行を追加する(出荷指示書/入荷指示書はこれらを渡さないため既存レイアウトのまま)
  salesOrderId?: string | null;
  showPriceColumns?: boolean;
}

interface PdfResources {
  fontBuffer: ArrayBuffer;
  logoBuffer?: ArrayBuffer | null;
  sealBuffer?: ArrayBuffer | null;
}

type DrawTextFn = (
  page: PDFPage,
  text: string | null | undefined,
  x: number,
  y: number,
  size?: number,
  color?: ReturnType<typeof rgb>,
) => void;

const ROW_HEIGHT = 20;
const CELL_PADDING = 6;

export async function generateInstructionPdf(
  data: InstructionPdfData,
  resources: PdfResources,
): Promise<Uint8Array> {
  // 明細テーブルの列境界(x座標)。既定は商品コード/品名/ロット/数量/単位/備考の6列。
  // 納品書(data.showPriceColumns)の場合のみ、単位と備考の間に単価・金額の2列を挿入する
  // (先頭5つの境界[50,130,260,320,375,415]は両パターンで完全に一致させ、既存の描画コードを
  // そのまま共用できるようにしている。挿入分だけ備考列の幅が狭くなる)
  const COL_BOUNDS = data.showPriceColumns
    ? [50, 130, 260, 320, 375, 415, 465, 515, 545]
    : [50, 130, 260, 320, 375, 415, 545];
  const TABLE_LEFT = COL_BOUNDS[0];
  const TABLE_RIGHT = COL_BOUNDS[COL_BOUNDS.length - 1];
  const TABLE_WIDTH = TABLE_RIGHT - TABLE_LEFT;
  // 備考列の開始位置(単価・金額列が挿入される場合はその分だけ後ろにずれる)
  const remarkColStart = data.showPriceColumns ? COL_BOUNDS[7] : COL_BOUNDS[5];

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const customFont = await pdfDoc.embedFont(resources.fontBuffer, { subset: true });

  const pageSize: [number, number] = [595.27, 841.89]; // A4
  const bottomLimit = 80;
  const createPage = (): PDFPage => pdfDoc.addPage(pageSize);

  const drawTextOnPage: DrawTextFn = (page, text, x, y, size = 10, color = rgb(0.1, 0.1, 0.1)) => {
    if (!text) return;
    page.drawText(text, { x, y, size, font: customFont, color });
  };

  // 明細テーブルのセル用: 列幅を超える場合はフォントを縮小し、それでも収まらなければ末尾を
  // 省略記号にして、隣の列に文字が被らないようにする(商品コード等の長さが不定のため)
  const drawFittedCellText = (
    page: PDFPage,
    text: string | null | undefined,
    x: number,
    y: number,
    columnWidthPt: number,
    size = 8.5,
    color = rgb(0.1, 0.1, 0.1),
  ) => {
    if (!text) return;
    const fitted = fitTextToWidth(
      (t, s) => customFont.widthOfTextAtSize(t, s),
      text,
      size,
      columnWidthPt - CELL_PADDING,
    );
    page.drawText(fitted.text, { x, y, size: fitted.size, font: customFont, color });
  };

  const drawRightAlignedText = (
    page: PDFPage,
    text: string,
    rightX: number,
    y: number,
    size = 9.5,
    color = rgb(0.1, 0.1, 0.1),
  ) => {
    const textWidth = customFont.widthOfTextAtSize(text, size);
    drawTextOnPage(page, text, rightX - textWidth, y, size, color);
  };

  // テーブルの1行分の外枠+内部の縦罫線を描画する(ヘッダー行・データ行共通)
  const drawRowGrid = (
    page: PDFPage,
    y: number,
    fillColor?: ReturnType<typeof rgb>,
  ) => {
    page.drawRectangle({
      x: TABLE_LEFT,
      y: y - ROW_HEIGHT,
      width: TABLE_WIDTH,
      height: ROW_HEIGHT,
      color: fillColor,
      borderWidth: 0.7,
      borderColor: rgb(0.25, 0.25, 0.25),
    });
    for (let i = 1; i < COL_BOUNDS.length - 1; i++) {
      page.drawLine({
        start: { x: COL_BOUNDS[i], y },
        end: { x: COL_BOUNDS[i], y: y - ROW_HEIGHT },
        thickness: 0.7,
        color: rgb(0.25, 0.25, 0.25),
      });
    }
  };

  let page = createPage();
  const { width, height } = page.getSize();

  // タイトル・管理情報(管理番号・発行日は右寄せ、右端(明細テーブルの右端と同じ位置)に揃える)
  drawTextOnPage(page, data.documentTitle, width / 2 - 60, height - 42, 20, rgb(0.1, 0.1, 0.1));
  drawRightAlignedText(page, `管理番号: ${data.code}`, TABLE_RIGHT, height - 65, 9);
  drawRightAlignedText(page, `発行日: ${data.date}`, TABLE_RIGHT, height - 77, 9);

  // 左側: 宛先(外部倉庫)ボックス
  let leftY = height - 90;
  drawTextOnPage(page, `${data.recipientLabel}`, 50, leftY, 9, rgb(0.3, 0.3, 0.3));
  leftY -= 18;
  drawTextOnPage(page, `${data.recipientName} 御中`, 50, leftY, 14, rgb(0.1, 0.1, 0.1));
  leftY -= 18;
  if (data.recipientAddress) {
    drawTextOnPage(page, data.recipientAddress, 50, leftY, 9);
    leftY -= 14;
  }
  if (data.recipientTel) {
    drawTextOnPage(page, `TEL: ${data.recipientTel}`, 50, leftY, 9);
    leftY -= 14;
  }

  // 右側: 自社情報。ロゴの実際の高さ分だけ下げてから文字を置くことで、ロゴが大きい場合でも
  // 文字と重ならないようにする
  const infoTop = height - 90;
  let logoBottomY = infoTop;
  if (resources.logoBuffer) {
    try {
      const logoImg = await pdfDoc.embedPng(resources.logoBuffer);
      const targetWidth = 110;
      const scale = targetWidth / logoImg.width;
      const logoHeight = logoImg.height * scale;
      logoBottomY = infoTop - logoHeight;
      page.drawImage(logoImg, {
        x: 380,
        y: logoBottomY,
        width: targetWidth,
        height: logoHeight,
      });
    } catch {
      // ロゴ埋め込み失敗は致命的ではないため無視して続行(既存パターン踏襲)
    }
  }
  let rightY = logoBottomY - 15;
  const companyNameY = rightY;
  drawTextOnPage(page, data.companyName, 380, companyNameY, 11, rgb(0.1, 0.1, 0.1));

  // 社印: 社名に少しかぶるように、社名の行より少し上寄りの位置に重ねて配置する
  if (resources.sealBuffer) {
    try {
      const sealImg = await pdfDoc.embedPng(resources.sealBuffer);
      const sealSize = 45;
      page.drawImage(sealImg, {
        x: 460,
        y: companyNameY - 15,
        width: sealSize,
        height: sealSize,
      });
    } catch {
      // 社印埋め込み失敗も同様に無視
    }
  }

  rightY -= 14;
  if (data.companyZip) {
    drawTextOnPage(page, `〒${data.companyZip}`, 380, rightY, 8.5);
    rightY -= 12;
  }
  drawTextOnPage(page, data.companyAddress, 380, rightY, 8.5);
  rightY -= 12;
  drawTextOnPage(page, `TEL: ${data.companyTel} FAX: ${data.companyFax}`, 380, rightY, 8.5);
  rightY -= 12;

  // 押印欄(承認/確認/担当、枠のみ・ラベル非表示)。社名・住所を含む自社情報ブロックの下に配置する
  const stampBoxWidth = 60;
  const stampBoxHeight = 55;
  const stampTop = rightY - 10;
  for (let i = 0; i < 3; i++) {
    page.drawRectangle({
      x: 340 + i * stampBoxWidth,
      y: stampTop - stampBoxHeight,
      width: stampBoxWidth,
      height: stampBoxHeight,
      borderWidth: 0.6,
      borderColor: rgb(0.4, 0.4, 0.4),
    });
  }
  rightY = stampTop - stampBoxHeight;

  let currentY = Math.min(leftY, rightY) - 20;

  // 参照情報ボックス(得意先/仕入先・予定日、納品書のみ受注番号の3行目を追加)。
  // 列境界をCOL_BOUNDSと揃えて縦罫線の見た目を統一する
  const refLabelWidth = 100;
  const refBoxRows = data.salesOrderId ? 3 : 2;
  page.drawRectangle({
    x: TABLE_LEFT,
    y: currentY - ROW_HEIGHT * refBoxRows,
    width: TABLE_WIDTH,
    height: ROW_HEIGHT * refBoxRows,
    borderWidth: 0.7,
    borderColor: rgb(0.25, 0.25, 0.25),
  });
  for (let row = 1; row < refBoxRows; row++) {
    page.drawLine({
      start: { x: TABLE_LEFT, y: currentY - ROW_HEIGHT * row },
      end: { x: TABLE_RIGHT, y: currentY - ROW_HEIGHT * row },
      thickness: 0.7,
      color: rgb(0.25, 0.25, 0.25),
    });
  }
  page.drawLine({
    start: { x: TABLE_LEFT + refLabelWidth, y: currentY },
    end: { x: TABLE_LEFT + refLabelWidth, y: currentY - ROW_HEIGHT * refBoxRows },
    thickness: 0.7,
    color: rgb(0.25, 0.25, 0.25),
  });
  drawTextOnPage(
    page,
    data.partnerLabel,
    TABLE_LEFT + CELL_PADDING,
    currentY - ROW_HEIGHT + 6,
    8.5,
    rgb(0.1, 0.1, 0.1),
  );
  drawTextOnPage(
    page,
    data.partnerName,
    TABLE_LEFT + refLabelWidth + CELL_PADDING,
    currentY - ROW_HEIGHT + 6,
    8.5,
  );
  drawTextOnPage(
    page,
    data.scheduledDateLabel,
    TABLE_LEFT + CELL_PADDING,
    currentY - ROW_HEIGHT * 2 + 6,
    8.5,
    rgb(0.1, 0.1, 0.1),
  );
  drawTextOnPage(
    page,
    data.scheduledDate,
    TABLE_LEFT + refLabelWidth + CELL_PADDING,
    currentY - ROW_HEIGHT * 2 + 6,
    8.5,
  );
  if (data.salesOrderId) {
    drawTextOnPage(
      page,
      "受注番号",
      TABLE_LEFT + CELL_PADDING,
      currentY - ROW_HEIGHT * 3 + 6,
      8.5,
      rgb(0.1, 0.1, 0.1),
    );
    drawTextOnPage(
      page,
      data.salesOrderId,
      TABLE_LEFT + refLabelWidth + CELL_PADDING,
      currentY - ROW_HEIGHT * 3 + 6,
      8.5,
    );
  }
  currentY -= ROW_HEIGHT * refBoxRows + 16;

  // 納品先ボックス(出荷指示書のみ。どこに対して出荷するかを明示する)
  const hasDeliveryInfo = data.deliveryAddressee || data.deliveryLocation || data.deliveryPhone;
  if (hasDeliveryInfo) {
    const deliveryRows =
      1 + (data.deliveryLocation ? 1 : 0) + (data.deliveryPhone ? 1 : 0);
    const deliveryBoxHeight = ROW_HEIGHT * deliveryRows;
    page.drawRectangle({
      x: TABLE_LEFT,
      y: currentY - deliveryBoxHeight,
      width: TABLE_WIDTH,
      height: deliveryBoxHeight,
      borderWidth: 0.7,
      borderColor: rgb(0.25, 0.25, 0.25),
    });
    page.drawLine({
      start: { x: TABLE_LEFT + refLabelWidth, y: currentY },
      end: { x: TABLE_LEFT + refLabelWidth, y: currentY - deliveryBoxHeight },
      thickness: 0.7,
      color: rgb(0.25, 0.25, 0.25),
    });
    let deliveryRowY = currentY;
    const drawDeliveryRow = (label: string, value: string) => {
      deliveryRowY -= ROW_HEIGHT;
      if (deliveryRowY > currentY - deliveryBoxHeight) {
        page.drawLine({
          start: { x: TABLE_LEFT, y: deliveryRowY },
          end: { x: TABLE_RIGHT, y: deliveryRowY },
          thickness: 0.7,
          color: rgb(0.25, 0.25, 0.25),
        });
      }
      drawTextOnPage(page, label, TABLE_LEFT + CELL_PADDING, deliveryRowY + 6, 8.5, rgb(0.1, 0.1, 0.1));
      drawTextOnPage(page, value, TABLE_LEFT + refLabelWidth + CELL_PADDING, deliveryRowY + 6, 8.5);
    };
    drawDeliveryRow("納品先宛名", data.deliveryAddressee || "-");
    if (data.deliveryLocation) drawDeliveryRow("納品場所", data.deliveryLocation);
    if (data.deliveryPhone) drawDeliveryRow("納品先電話番号", data.deliveryPhone);
    currentY -= deliveryBoxHeight + 16;
  }

  // 明細テーブル(品目/ロット/数量/単位/備考)
  const drawTableHeader = (p: PDFPage, y: number) => {
    drawRowGrid(p, y, rgb(0.85, 0.85, 0.9));
    drawTextOnPage(p, "品目コード", COL_BOUNDS[0] + CELL_PADDING, y - ROW_HEIGHT + 6, 8.5, rgb(0.1, 0.1, 0.1));
    drawTextOnPage(p, "品名", COL_BOUNDS[1] + CELL_PADDING, y - ROW_HEIGHT + 6, 8.5, rgb(0.1, 0.1, 0.1));
    drawTextOnPage(p, "ロット", COL_BOUNDS[2] + CELL_PADDING, y - ROW_HEIGHT + 6, 8.5, rgb(0.1, 0.1, 0.1));
    drawRightAlignedText(
      p,
      "数量",
      COL_BOUNDS[4] - CELL_PADDING,
      y - ROW_HEIGHT + 6,
      8.5,
      rgb(0.1, 0.1, 0.1),
    );
    drawTextOnPage(p, "単位", COL_BOUNDS[4] + CELL_PADDING, y - ROW_HEIGHT + 6, 8.5, rgb(0.1, 0.1, 0.1));
    if (data.showPriceColumns) {
      drawRightAlignedText(p, "単価", COL_BOUNDS[6] - CELL_PADDING, y - ROW_HEIGHT + 6, 8.5, rgb(0.1, 0.1, 0.1));
      drawRightAlignedText(p, "金額", COL_BOUNDS[7] - CELL_PADDING, y - ROW_HEIGHT + 6, 8.5, rgb(0.1, 0.1, 0.1));
    }
    drawTextOnPage(p, "備考", remarkColStart + CELL_PADDING, y - ROW_HEIGHT + 6, 8.5, rgb(0.1, 0.1, 0.1));
    return y - ROW_HEIGHT;
  };

  currentY = drawTableHeader(page, currentY);

  for (const item of data.items) {
    if (currentY - ROW_HEIGHT < bottomLimit) {
      page = createPage();
      currentY = height - 60;
      currentY = drawTableHeader(page, currentY);
    }
    drawRowGrid(page, currentY);
    const rowTextY = currentY - ROW_HEIGHT + 6;
    drawFittedCellText(page, item.itemId, COL_BOUNDS[0] + CELL_PADDING, rowTextY, COL_BOUNDS[1] - COL_BOUNDS[0]);
    drawFittedCellText(page, item.itemName, COL_BOUNDS[1] + CELL_PADDING, rowTextY, COL_BOUNDS[2] - COL_BOUNDS[1]);
    drawFittedCellText(page, item.lotNumber, COL_BOUNDS[2] + CELL_PADDING, rowTextY, COL_BOUNDS[3] - COL_BOUNDS[2]);
    drawRightAlignedText(
      page,
      String(item.quantity),
      COL_BOUNDS[4] - CELL_PADDING,
      rowTextY,
      9,
    );
    drawFittedCellText(page, item.unit, COL_BOUNDS[4] + CELL_PADDING, rowTextY, COL_BOUNDS[5] - COL_BOUNDS[4]);
    if (data.showPriceColumns) {
      if (item.unitPrice != null) {
        drawRightAlignedText(page, item.unitPrice.toLocaleString(), COL_BOUNDS[6] - CELL_PADDING, rowTextY, 8.5);
      }
      if (item.amount != null) {
        drawRightAlignedText(page, item.amount.toLocaleString(), COL_BOUNDS[7] - CELL_PADDING, rowTextY, 8.5);
      }
    }
    drawFittedCellText(page, item.remark, remarkColStart + CELL_PADDING, rowTextY, TABLE_RIGHT - remarkColStart);
    currentY -= ROW_HEIGHT;
  }

  currentY -= 20;
  if (data.memo) {
    const memoBoxHeight = 50;
    if (currentY - memoBoxHeight < bottomLimit) {
      page = createPage();
      currentY = height - 60;
    }
    drawTextOnPage(page, "備考", TABLE_LEFT, currentY, 9, rgb(0.3, 0.3, 0.3));
    currentY -= 6;
    page.drawRectangle({
      x: TABLE_LEFT,
      y: currentY - memoBoxHeight,
      width: TABLE_WIDTH,
      height: memoBoxHeight,
      borderWidth: 0.7,
      borderColor: rgb(0.25, 0.25, 0.25),
    });
    drawTextOnPage(page, data.memo, TABLE_LEFT + CELL_PADDING, currentY - 16, 9);
  }

  const allPages = pdfDoc.getPages();
  allPages.forEach((p, index) => {
    drawTextOnPage(p, `${index + 1} / ${allPages.length}`, 535, height - 26, 8, rgb(0.4, 0.4, 0.4));
  });

  return await pdfDoc.save({ useObjectStreams: true });
}
