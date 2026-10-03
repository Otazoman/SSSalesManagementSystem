// utils/pdfGenerator.ts
import { PDFDocument, rgb, PDFPage, PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import reportLayouts from "../jsons/reportLayouts.json";

export type PDFInvoiceData = {
  // Item7: ORDER_ACKNOWLEDGMENT = 受注に対する注文請書(自社が「注文を受けた」ことの確認書)。
  // 既存のORDER(発注書、Item9の自社発注用)とは方向が逆の別文書のため区別する
  // 検収書発行: ACCEPTANCE = 発注(仕入)に対する検収書(発注書と同じレイアウトを踏襲、Item9)
  // Item10: PURCHASE_RECOGNITION = 仕入計上の確認書(適格請求書要件は仕入側には不要なため、
  // INVOICE/ACCEPTANCEと同じ固定レイアウト方式のみでシンプルに新設する)
  // 追加要望(2026-09-16ユーザー確認済み): SALES_RECOGNITION = 売上計上の確認書。
  // 従来は"INVOICE"(御請求書)を流用していたが、正式な請求書発行は請求管理(billing)に一本化し、
  // こちらは内部確認・取引先への売上計上お知らせ用の非公式な書類に位置づけを変更した
  // (PURCHASE_RECOGNITIONと対称)
  templateType:
    | "QUOTATION"
    | "INVOICE"
    | "ORDER"
    | "ORDER_ACKNOWLEDGMENT"
    | "DELIVERY"
    | "ACCEPTANCE"
    | "PURCHASE_RECOGNITION"
    | "SALES_RECOGNITION";
  title?: string;
  code: string;
  date: string;
  customCompanyName: string;
  customCompanyZip?: string;
  customCompanyAddress: string;
  customCompanyTel: string;
  customCompanyFax: string;
  customerName: string;
  totalAmount: number;
  taxAmount: number;
  memo?: string | null;

  // Item4-b: 値引き合計・税率別内訳(明細のマイナス金額行=値引きとして扱う設計)
  discountTotal?: number;
  taxBreakdown?: {
    rate10: { excl: number; tax: number };
    rate8: { excl: number; tax: number };
    rate0: { excl: number; tax: number };
  };

  // 5大項目
  quoteTitle?: string | null; // 件名
  deliveryDate?: string | null; // 納期
  deliveryPlace?: string | null; // 納品場所
  paymentTerms?: string | null; // 支払条件
  expiryDate?: string | null; // 見積期限

  // 担当者氏名テキスト
  salesPersonName?: string | null;

  // Item4-f: 適格請求書発行事業者の登録番号(カスタムExcelテンプレート側は
  // resolve-quote-placeholders.tsの{{company_invoice_no}}で既に対応済みだったが、
  // 標準レイアウト側には出力項目自体が無かったため追加)
  companyInvoiceNo?: string | null;

  // 画面構成再編: 納品書(DELIVERY)向けの条件表項目(出荷元倉庫・受注番号)
  sourceWarehouseName?: string;
  salesOrderNumber?: string;

  // 検収書発行: 検収書(ACCEPTANCE)向けの条件表項目(発注番号)
  purchaseOrderNumber?: string;

  items: Array<{
    itemName: string;
    quantity: number;
    // 画面構成再編: 納品書では受注に紐づかない明細はunitPriceを持たない(null/undefined時は
    // 単価・金額列を空欄にする、drawItemsTable参照)。既存の見積/注文請書等は常に数値を渡す
    unitPrice?: number | null;
  }>;
};

interface PDFResource {
  fontBuffer: ArrayBuffer;
  logoBuffer?: ArrayBuffer | null;
  sealBuffer?: ArrayBuffer | null;
}

// Item4-f: generateDocumentPDF内でのみ使う描画ヘルパー群。pdfDoc/customFont/width/height/
// createPage/drawTextOnPageはリクエスト中一切変わらないためクロージャで共有し、
// ページまたぎで実際に変化する状態(page/currentY/subTotal等)だけを引数・戻り値でやり取りする
// (この方が、全ての値を毎回引数で受け渡すより誤り込みにくいため)。

// 1. ヘッダータイトル・管理情報
function drawHeaderAndTitle(
  page: PDFPage,
  data: PDFInvoiceData,
  layoutConfig: any,
  width: number,
  height: number,
  drawTextOnPage: DrawTextFn,
): void {
  const mainTitle = data.title || layoutConfig.mainTitle;
  const titleColor = rgb(0.1, 0.1, 0.1);
  drawTextOnPage(page, mainTitle, width / 2 - 50, height - 42, 20, titleColor);
  drawTextOnPage(page, `管理番号: ${data.code}`, 430, height - 35, 9);
  drawTextOnPage(page, `発行日: ${data.date}`, 430, height - 47, 9);
}

// 2. 左側：顧客名・条件ボックスエリア。戻り値のcurrentYが後続セクションの開始位置になる
function drawPartnerAndConditionsBlock(
  page: PDFPage,
  data: PDFInvoiceData,
  layoutConfig: any,
  height: number,
  customFont: PDFFont,
  drawTextOnPage: DrawTextFn,
): number {
  let displayPartnerName = "";
  if (
    !data.customerName ||
    data.customerName === "ご担当者" ||
    data.customerName.trim() === ""
  ) {
    displayPartnerName = "ご担当者様";
  } else {
    displayPartnerName = `${data.customerName} 御中`;
  }

  const partnerNameWidth = customFont.widthOfTextAtSize(
    displayPartnerName,
    14,
  );
  const lineEndX = 50 + partnerNameWidth + 2;

  drawTextOnPage(page, displayPartnerName, 50, height - 75, 14);
  page.drawLine({
    start: { x: 50, y: height - 80 },
    end: { x: lineEndX, y: height - 80 },
    thickness: 1,
    color: rgb(0.2, 0.2, 0.2),
  });
  // Item7: 帳票種別ごとの案内文(以前は見積専用の文言が全帳票で固定表示されていた)
  drawTextOnPage(
    page,
    layoutConfig.introText || "下記の通り、御見積申し上げます。",
    50,
    height - 95,
    9,
  );

  // 条件テーブルの開始座標
  let currentY = height - 105;

  if (layoutConfig.showConditionTable && layoutConfig.conditions.length > 0) {
    const tableTop = currentY;
    const rowHeight = 15;
    const tableWidth = 260;
    const labelWidth = 65;

    layoutConfig.conditions.forEach(
      (cond: { key: string; label: string }, idx: number) => {
        const y = tableTop - idx * rowHeight;
        const rawValue = data[cond.key as keyof PDFInvoiceData];
        const displayValue =
          typeof rawValue === "string" ? rawValue : "別途協議";

        page.drawRectangle({
          x: 50,
          y: y - rowHeight,
          width: tableWidth,
          height: rowHeight,
          borderWidth: 0.5,
          borderColor: rgb(0.2, 0.2, 0.2),
        });
        page.drawRectangle({
          x: 50,
          y: y - rowHeight,
          width: labelWidth,
          height: rowHeight,
          color: rgb(0.92, 0.92, 0.92),
          borderWidth: 0.5,
          borderColor: rgb(0.2, 0.2, 0.2),
        });

        drawTextOnPage(
          page,
          cond.label,
          54,
          y - rowHeight + 4,
          8.5,
          rgb(0.1, 0.1, 0.1),
        );
        drawTextOnPage(
          page,
          displayValue,
          54 + labelWidth,
          y - rowHeight + 4,
          8.5,
        );
      },
    );

    currentY -= layoutConfig.conditions.length * rowHeight;

    // 画面構成再編: 納品書(DELIVERY)は元々小計/消費税/合計を一切表示していなかったため、
    // layoutConfig.showTotals === false の場合はこの金額ボックス自体を描画しない
    if (layoutConfig.showTotals !== false) {
      // 見積金額(税込)ボックス
      page.drawRectangle({
        x: 50,
        y: currentY - rowHeight,
        width: tableWidth,
        height: rowHeight,
        borderWidth: 0.5,
        borderColor: rgb(0.2, 0.2, 0.2),
      });
      page.drawRectangle({
        x: 50,
        y: currentY - rowHeight,
        width: labelWidth,
        height: rowHeight,
        borderWidth: 0.5,
        borderColor: rgb(0.2, 0.2, 0.2),
      });

      drawTextOnPage(
        page,
        "見積金額(税込)",
        53,
        currentY - rowHeight + 4,
        8.5,
        rgb(0.1, 0.1, 0.1),
      );

      // 💡【バグ修正】金額文字列の正確なピクセル幅を計算し、ボックスの右端（50 + 260 = 310）から引き算して1ミリの狂いもなく右寄せします
      const totalAmountText = `¥${data.totalAmount.toLocaleString()}-`;
      const totalAmountWidth = customFont.widthOfTextAtSize(totalAmountText, 10);
      const totalAmountX = 305 - totalAmountWidth; // 右端から5px内側にマージン

      drawTextOnPage(
        page,
        totalAmountText,
        totalAmountX,
        currentY - rowHeight + 4,
        10,
        rgb(0, 0, 0),
      );

      currentY -= rowHeight;
    }
  }

  return currentY;
}

// 3. 右側：自社情報エリア(ロゴ・会社情報・TEL/FAX・担当者・社印・ハンコ枠)
async function drawCompanyInfoBlock(
  pdfDoc: PDFDocument,
  page: PDFPage,
  data: PDFInvoiceData,
  resources: PDFResource,
  height: number,
  drawTextOnPage: DrawTextFn,
): Promise<void> {
  const rightAreaX = 360; // 右側エリアの開始X座標

  // 1. 会社ロゴの調整（潰れ防止と位置調整）
  if (resources.logoBuffer) {
    try {
      const logoImg = await pdfDoc.embedPng(resources.logoBuffer);
      const targetWidth = 130;
      const scaleFactor = targetWidth / logoImg.width;
      const targetHeight = logoImg.height * scaleFactor;

      page.drawImage(logoImg, {
        x: rightAreaX,
        y: height - 45 - targetHeight,
        width: targetWidth,
        height: targetHeight,
      });
    } catch (e) {
      console.error("Logo render error:", e);
    }
  }

  // 💡【TEL/FAX パディング解消】文字の間に細かく1マスずつ挟み込まれている半角・全角の空白を完全に消去します
  const forceCleanHalfWidth = (str: string) => {
    if (!str) return "";
    // (E2) 特殊なホワイトスペースコード(U+00A0など)も含め、文字間にパディングされたすべてのスペースを完全に除去
    let cleanStr = str.replace(/[\s　  ]+/g, "");

    // 全角英数字をすべて半角にマッピング
    cleanStr = cleanStr.replace(/[！-～]/g, (s) =>
      String.fromCharCode(s.charCodeAt(0) - 0xfee0),
    );
    return cleanStr
      .replace(/[－ーーー−—―–]/g, "-")
      .replace(/[：:]/g, ":")
      .replace(/[０-９]/g, (s) =>
        String.fromCharCode(s.charCodeAt(0) - 0xfee0),
      );
  };

  const finalCompTel = forceCleanHalfWidth(
    data.customCompanyTel || "03-1234-5678",
  );
  const finalCompFax = forceCleanHalfWidth(
    data.customCompanyFax || "03-1234-5679",
  );

  // 会社名などのテキスト情報
  const finalCompName = data.customCompanyName || "株式会社 サンプル";
  const rawZip = forceCleanHalfWidth(data.customCompanyZip || ""); // 👈 整形処理を適用
  const finalCompZip = rawZip
    ? rawZip.startsWith("〒")
      ? rawZip
      : `〒${rawZip}`
    : "〒000-0000"; // 👈 〒マークの補正とフォールバック
  const finalCompAddr = data.customCompanyAddress || "東京都港区芝浦X-X-X";

  drawTextOnPage(
    page,
    finalCompName,
    rightAreaX,
    height - 110,
    11.5,
    rgb(0.1, 0.1, 0.1),
  );
  drawTextOnPage(
    page,
    finalCompZip,
    rightAreaX,
    height - 121,
    8,
    rgb(0.3, 0.3, 0.3),
  );
  drawTextOnPage(
    page,
    finalCompAddr,
    rightAreaX,
    height - 130,
    8,
    rgb(0.3, 0.3, 0.3),
  );

  // 💡 完全に整形された半角のTEL/FAXが出力されます
  // TELの描画
  drawTextOnPage(
    page,
    "TEL: ",
    rightAreaX,
    height - 139,
    8,
    rgb(0.3, 0.3, 0.3),
  );
  drawTextOnPage(
    page,
    finalCompTel,
    rightAreaX + 22,
    height - 139,
    8,
    rgb(0.3, 0.3, 0.3),
  );
  // FAXの描画 (横並びにするため、X座標を右に100pxずらして個別に描画)
  drawTextOnPage(
    page,
    "FAX: ",
    rightAreaX + 100,
    height - 139,
    8,
    rgb(0.3, 0.3, 0.3),
  );
  drawTextOnPage(
    page,
    finalCompFax,
    rightAreaX + 122,
    height - 139,
    8,
    rgb(0.3, 0.3, 0.3),
  );

  // 担当者名の描画
  const dispatcherName = data.salesPersonName || "営業担当者";
  drawTextOnPage(
    page,
    `担当: ${dispatcherName}`,
    rightAreaX,
    height - 150,
    9,
    rgb(0.2, 0.2, 0.2),
  );

  // Item4-f: 適格請求書発行事業者の登録番号(会社設定が未入力の場合はラベルのみ表示)
  drawTextOnPage(
    page,
    `登録番号: ${data.companyInvoiceNo || ""}`,
    rightAreaX,
    height - 161,
    8,
    rgb(0.3, 0.3, 0.3),
  );

  // 2. 社印（角印）の調整
  if (resources.sealBuffer) {
    try {
      const sealImg = await pdfDoc.embedPng(resources.sealBuffer);
      page.drawImage(sealImg, {
        // 💡【位置さらに右寄せ】サイズ拡大に合わせて、右端のライン（1/1）に綺麗に沿うよう X座標を「488」に変更
        x: 488,
        // 💡【高さ微調整】大きくなった印影が文字を隠しすぎないよう、Y座標を「height - 150」に微調整
        y: height - 150,
        // 💡【サイズをさらに大きく】幅と高さを48から「58」へ大胆に拡大
        width: 58,
        height: 58,
        opacity: 0.7, // 文字が透けて見えるように不透明度を 0.7 に調整
      });
    } catch (e) {
      console.error("Seal render error:", e);
    }
  }

  // 3. 担当者の下の3つのハンコ枠。ユーザー要望によりgenerate-instruction-pdf.ts
  // (出荷指示書/入荷指示書/納品書)と同じ60×55ptに揃える(以前は38×38pt)。
  // 上端(height-175)は据え置き、下方向にのみ拡大することで既存のテキスト行(登録番号等)との
  // 衝突を避けつつ、明細テーブル側のフロア(height-250、drawItemsTable参照)との間に
  // 従来と同程度(約20pt)の余白を維持する
  const stampBoxHeight = 55;
  const stampBoxY = height - 175 - stampBoxHeight;
  const stampBoxWidth = 60;
  // 右端（x: 541）にジャストで右揃えにするため、スタートX座標を算出 (541 - 60*3 = 361)
  const startX = 541 - stampBoxWidth * 3;

  // 外枠および区切り線の描画
  for (let i = 0; i < 3; i++) {
    page.drawRectangle({
      x: startX + i * stampBoxWidth,
      y: stampBoxY,
      width: stampBoxWidth,
      height: stampBoxHeight,
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 0.5,
    });
  }
}

type DrawTextFn = (
  p: PDFPage,
  text: string,
  x: number,
  y: number,
  size?: number,
  color?: ReturnType<typeof rgb>,
) => void;

interface ItemsTableResult {
  page: PDFPage;
  currentY: number;
  subTotal: number;
}

// 4-5. 明細テーブルヘッダー+明細行の動的ループ&自動ページ送り
function drawItemsTable(
  initialPage: PDFPage,
  initialCurrentY: number,
  data: PDFInvoiceData,
  height: number,
  bottomLimit: number,
  createPage: () => PDFPage,
  drawTextOnPage: DrawTextFn,
  customFont: PDFFont,
): ItemsTableResult {
  let page = initialPage;
  // Item7: ハンコ枠を60×55ptへ拡大した際(height-230〜height-175)、下端とテーブルヘッダー上端の
  // 余白が窮屈という指摘を受け、フロアを従来のheight-250からさらに15pt下げてheight-265に変更。
  // ハンコ枠下端(height-230)との間に約35ptの空きが生まれる
  let currentY = Math.min(initialCurrentY - 30, height - 265);
  let tableTopY = currentY; // 💡 縦枠線の起点としてテーブルの最上部を記憶

  const drawTableHeader = (p: PDFPage, y: number) => {
    // 💡【エラー修正】fillColor を型定義通りの「color」に変更し、ライトグレーで塗りつぶします
    p.drawRectangle({
      x: 50,
      y,
      width: 495,
      height: 18,
      color: rgb(0.93, 0.93, 0.93),
      borderWidth: 0.5,
      borderColor: rgb(0.1, 0.1, 0.1),
    });
    drawTextOnPage(p, "No.", 57, y + 5, 9.5, rgb(0.1, 0.1, 0.1));
    drawTextOnPage(p, "品目名", 85, y + 5, 9.5, rgb(0.1, 0.1, 0.1));
    drawTextOnPage(p, "数量", 320, y + 5, 9.5, rgb(0.1, 0.1, 0.1));
    drawTextOnPage(p, "単価", 380, y + 5, 9.5, rgb(0.1, 0.1, 0.1));
    drawTextOnPage(p, "金額 (税抜)", 460, y + 5, 9.5, rgb(0.1, 0.1, 0.1));
  };

  drawTableHeader(page, currentY);

  let subTotal = 0;
  const rowHeight = 18;

  // 💡 縦の境界線を引くヘルパー関数（品名、数量、単価、金額の各列を正確に区切る）
  const drawTableVerticalLines = (
    p: PDFPage,
    startTopY: number,
    endBottomY: number,
  ) => {
    // 各列の境界となる正確なX座標（左端、品名の左(=No.の右)、数量の左、単価の左、金額の左、右端）
    const vLinesX = [50, 75, 310, 370, 450, 545];
    vLinesX.forEach((lineX) => {
      p.drawLine({
        start: { x: lineX, y: startTopY + 18 }, // ヘッダーの上端から
        end: { x: lineX, y: endBottomY }, // 明細の最下部まで
        thickness: 0.5,
        color: rgb(0.3, 0.3, 0.3), // 外枠になじむ落ち着いたグレー
      });
    });
  };

  data.items.forEach((item, index) => {
    // 画面構成再編: 納品書では受注に紐づかない明細のunitPriceがnull/undefinedになりうる。
    // その場合は小計に加算せず、単価・金額列も空欄のまま描画する
    const hasPrice = item.unitPrice != null;
    const lineAmount = hasPrice ? item.quantity * (item.unitPrice as number) : null;
    if (lineAmount != null) subTotal += lineAmount;

    // 💡【ページ跨ぎ修正】次の1行を引く前に、このページに収まるかを正しく安全に判定します
    if (currentY - rowHeight < bottomLimit) {
      // ⭕ 現在のページの最終行の底辺に合わせて、縦線を隙間なくピタッと閉じて終了させます
      drawTableVerticalLines(page, tableTopY, currentY);

      page = createPage();
      currentY = height - 60; // 2ページ目の先頭の高さ
      drawTableHeader(page, currentY);
      tableTopY = currentY; // 2ページ目の縦線の開始位置を新ヘッダーの底辺に同期
    }

    // 💡【重要】ページが確定したあとで、正しい行の高さ（1行分だけ）をマイナスします
    currentY -= rowHeight;

    page.drawRectangle({
      x: 50,
      y: currentY,
      width: 495,
      height: rowHeight,
      borderWidth: 0.5,
      borderColor: rgb(0.6, 0.6, 0.6),
    });
    drawTextOnPage(page, String(index + 1), 57, currentY + 5, 9);
    drawTextOnPage(page, item.itemName, 85, currentY + 5, 9);

    // 💡【数量の完全右寄せ】右区切り線(370)の手前でピタッと揃えます
    const qtyStr = String(item.quantity);
    const qtyWidth = customFont.widthOfTextAtSize(qtyStr, 9);
    drawTextOnPage(page, qtyStr, 365 - qtyWidth, currentY + 5, 9);

    if (hasPrice) {
      // 💡【単価の完全右寄せ】右区切り線(450)の手前で、0円を含めて1ミリのズレもなく右揃えにします
      const priceStr = `¥${(item.unitPrice as number).toLocaleString()}`;
      const priceWidth = customFont.widthOfTextAtSize(priceStr, 9);
      drawTextOnPage(page, priceStr, 445 - priceWidth, currentY + 5, 9);

      // 💡【金額の完全右寄せ】右区切り線(545)の手前で、0円を含めて1ミリのズレもなく右揃えにします
      const amountStr = `¥${(lineAmount as number).toLocaleString()}`;
      const amountWidth = customFont.widthOfTextAtSize(amountStr, 9);
      drawTextOnPage(page, amountStr, 540 - amountWidth, currentY + 5, 9);
    }
  });

  // 💡 全アイテムのループが回り終わったあとに、縦枠線を上から最下部まで綺麗に引く
  drawTableVerticalLines(page, tableTopY, currentY);

  return { page, currentY, subTotal };
}

// BUG-053: 備考欄の上端。税率別内訳がある場合はその下端の10pt下、無い場合は明細表の下端の15pt下に置く。
// 以前は「合計欄を描く時に currentY を35pt下げる」ことを前提に currentY + 20 としていたため、
// 合計欄を描かない納品書(showTotals: false)では備考欄が明細の最終行に重なっていた
export function resolveMemoBoxTopY(tableBottomY: number, breakdownBottomY: number | null): number {
  return breakdownBottomY !== null ? breakdownBottomY - 10 : tableBottomY - 15;
}

// 6. 小計・消費税・値引・税率別内訳・合計・備考欄（最終ページ）
function drawFooterBlock(
  initialPage: PDFPage,
  initialCurrentY: number,
  subTotal: number,
  data: PDFInvoiceData,
  layoutConfig: any,
  height: number,
  bottomLimit: number,
  createPage: () => PDFPage,
  drawTextOnPage: DrawTextFn,
  customFont: PDFFont,
): void {
  let page = initialPage;
  let currentY = initialCurrentY;
  // 画面構成再編: 納品書(DELIVERY)は元々小計/消費税/合計を一切表示していなかったため、
  // layoutConfig.showTotals === false の場合はこのブロック全体を描画しない
  const showTotals = layoutConfig.showTotals !== false;

  // Item4-b: 税率別内訳の行数を先に確定しておく(備考欄の位置決め・改ページ判定の両方で使う)
  const taxBreakdownRows = data.taxBreakdown
    ? (
        [
          { label: "10%対象", ...data.taxBreakdown.rate10 },
          { label: "8%対象", ...data.taxBreakdown.rate8 },
          { label: "非課税分", ...data.taxBreakdown.rate0 },
        ] as Array<{ label: string; excl: number; tax: number }>
      ).filter((r) => r.excl !== 0)
    : [];
  // 内訳がある場合はヘッダー行+各行ぶん(13pt刻み)だけ下に伸びるため、その分も含めて検証する
  const taxBreakdownExtraHeight =
    taxBreakdownRows.length > 0 ? (taxBreakdownRows.length + 1) * 13 : 0;

  // 備考欄の枠（高さ60px）も含めて、十分なスペースがあるか検証(showTotals=falseの場合は
  // 小計/消費税/合計ブロック分の高さを見積もる必要が無いため必要スペースを縮小する)
  // BUG-053: 合計欄が無い場合も、備考欄(15pt空けて高さ65)が収まるかを確認する
  const totalsBlockHeight = showTotals ? 140 : data.memo ? 85 : 40;
  if (currentY - totalsBlockHeight - taxBreakdownExtraHeight < bottomLimit) {
    page = createPage();
    currentY = height - 60;
  }
  const tableBottomY = currentY;

  let discountRowOffset = 0;
  if (showTotals) {
    currentY -= 35;
    page.drawLine({
      start: { x: 350, y: currentY + 28 },
      end: { x: 545, y: currentY + 28 },
      thickness: 1,
      color: rgb(0.1, 0.1, 0.1),
    });

    drawTextOnPage(
      page,
      `小計 (税抜):`,
      360,
      currentY + 12,
      9.5,
      rgb(0.2, 0.2, 0.2),
    );
    // 💡【小計の完全右寄せ】明細の金額列の右端（540）に合わせて完璧に揃えます
    const finalSubTotalText = `¥${subTotal.toLocaleString()}`;
    const finalSubTotalWidth = customFont.widthOfTextAtSize(
      finalSubTotalText,
      9.5,
    );
    drawTextOnPage(
      page,
      finalSubTotalText,
      540 - finalSubTotalWidth,
      currentY + 12,
      9.5,
    );

    // Item4-b: 値引き合計行(値引きがある場合のみ、小計と消費税の間に挿入)
    const hasDiscount = !!data.discountTotal && data.discountTotal < 0;
    discountRowOffset = hasDiscount ? 14 : 0;
    if (hasDiscount) {
      drawTextOnPage(
        page,
        `値引等:`,
        360,
        currentY - 2,
        9.5,
        rgb(0.75, 0.1, 0.1),
      );
      const finalDiscountText = `-¥${Math.abs(data.discountTotal!).toLocaleString()}`;
      const finalDiscountWidth = customFont.widthOfTextAtSize(
        finalDiscountText,
        9.5,
      );
      drawTextOnPage(
        page,
        finalDiscountText,
        540 - finalDiscountWidth,
        currentY - 2,
        9.5,
        rgb(0.75, 0.1, 0.1),
      );
    }

    drawTextOnPage(
      page,
      `消費税 (10%):`,
      360,
      currentY - 2 - discountRowOffset,
      9.5,
      rgb(0.2, 0.2, 0.2),
    );
    // 💡【消費税の完全右寄せ】同じく右端（540）に合わせて完璧に揃えます
    const finalTaxText = `¥${data.taxAmount.toLocaleString()}`;
    const finalTaxWidth = customFont.widthOfTextAtSize(finalTaxText, 9.5);
    drawTextOnPage(
      page,
      finalTaxText,
      540 - finalTaxWidth,
      currentY - 2 - discountRowOffset,
      9.5,
    );

    page.drawLine({
      start: { x: 350, y: currentY - 8 - discountRowOffset },
      end: { x: 545, y: currentY - 8 - discountRowOffset },
      thickness: 0.5,
      color: rgb(0.1, 0.1, 0.1),
    });

    drawTextOnPage(
      page,
      `税込合計金額:`,
      360,
      currentY - 22 - discountRowOffset,
      10.5,
      rgb(0.1, 0.1, 0.1),
    );
    // 💡【税込合計金額の完全右寄せ】右端（540）に合わせて、フォントサイズ11.5の横幅を計算して完璧に揃えます
    const finalTotalText = `¥${data.totalAmount.toLocaleString()}`;
    const finalTotalWidth = customFont.widthOfTextAtSize(finalTotalText, 11.5);
    drawTextOnPage(
      page,
      finalTotalText,
      540 - finalTotalWidth,
      currentY - 22 - discountRowOffset,
      11.5,
      rgb(0.1, 0.1, 0.1),
    );
  }

  // Item4-b: 税率別内訳(左側、10%/8%/0%のうち金額が発生している区分のみ表示)
  // 備考欄と同じ左側(x=50)の領域に描画されるため、下端(breakdownBottomY)を備考欄の
  // 位置決めに使い、重なりを防ぐ(以前は備考欄がcurrentY基準の固定位置で、内訳の行数に
  // 関わらず同じ場所に描画されており、内訳が表示されると必ず重なっていた)
  let breakdownBottomY: number | null = null;
  if (taxBreakdownRows.length > 0) {
    let breakdownY = currentY + 12;
    drawTextOnPage(page, "税率別内訳", 50, breakdownY, 9, rgb(0.2, 0.2, 0.2));
    drawTextOnPage(page, "税抜金額", 130, breakdownY, 8, rgb(0.4, 0.4, 0.4));
    drawTextOnPage(page, "消費税額", 200, breakdownY, 8, rgb(0.4, 0.4, 0.4));
    taxBreakdownRows.forEach((row) => {
      breakdownY -= 13;
      drawTextOnPage(page, row.label, 50, breakdownY, 8, rgb(0.2, 0.2, 0.2));
      drawTextOnPage(
        page,
        `¥${row.excl.toLocaleString()}`,
        130,
        breakdownY,
        8,
      );
      drawTextOnPage(
        page,
        `¥${row.tax.toLocaleString()}`,
        200,
        breakdownY,
        8,
      );
    });
    breakdownBottomY = breakdownY;
  }

  // 💡【修正】備考欄を綺麗な長方形の枠線（ボックス）で囲む処理
  if (data.memo) {
    // 枠線の配置座標を計算 (左側：x=50 から 幅260px のエリアに綺麗に配置)
    const boxX = 50;
    const boxWidth = 260;
    const boxHeight = 65;
    // Item4-b: 税率別内訳が表示されている場合はその下端(breakdownBottomY)を基準に、
    // 無い場合は明細表の下端(tableBottomY)を基準に配置する(BUG-053)
    const boxTopY = resolveMemoBoxTopY(tableBottomY, breakdownBottomY);
    const boxY = boxTopY - boxHeight;

    // 1. 備考欄の外枠（黒の薄い線）を描画
    page.drawRectangle({
      x: boxX,
      y: boxY,
      width: boxWidth,
      height: boxHeight,
      borderWidth: 0.5,
      borderColor: rgb(0.2, 0.2, 0.2),
    });

    // 2. 枠内の左上に「【備考】」のタイトルを配置
    drawTextOnPage(
      page,
      "【備考】",
      boxX + 8,
      boxY + boxHeight - 14,
      9.5,
      rgb(0.2, 0.2, 0.2),
    );

    // 3. 入力された備考テキストを枠内に描画 (改行が含まれる場合は安全に分割して描画)
    const memoLines = data.memo.split("\n");
    memoLines.forEach((line, lineIdx) => {
      drawTextOnPage(
        page,
        line,
        boxX + 10,
        boxY + boxHeight - 28 - lineIdx * 12,
        8.5,
        rgb(0.1, 0.1, 0.1),
      );
    });
  }
}

// 7. ページ番号スタンプ (右上端へ寄せる調整、全ページ分)
function stampPageNumbers(
  pdfDoc: PDFDocument,
  height: number,
  drawTextOnPage: DrawTextFn,
): void {
  const allPages = pdfDoc.getPages();
  const totalPages = allPages.length;

  allPages.forEach((p, index) => {
    const pageNumText = `${index + 1} / ${totalPages}`;
    drawTextOnPage(p, pageNumText, 535, height - 26, 8, rgb(0.4, 0.4, 0.4));
  });
}

export async function generateDocumentPDF(
  data: PDFInvoiceData,
  resources: PDFResource,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const customFont = await pdfDoc.embedFont(resources.fontBuffer, {
    subset: true,
  });

  const layoutConfig =
    reportLayouts[data.templateType] || reportLayouts["QUOTATION"];

  const createPage = (): PDFPage => {
    return pdfDoc.addPage([595.27, 841.89]); // A4
  };

  let page = createPage();
  const { width, height } = page.getSize();
  const bottomLimit = 80;

  const drawTextOnPage: DrawTextFn = (p, text, x, y, size = 10, color = rgb(0.1, 0.1, 0.1)) => {
    if (!text) return;
    p.drawText(text, { x, y, size, font: customFont, color });
  };

  drawHeaderAndTitle(page, data, layoutConfig, width, height, drawTextOnPage);

  let currentY = drawPartnerAndConditionsBlock(
    page,
    data,
    layoutConfig,
    height,
    customFont,
    drawTextOnPage,
  );

  await drawCompanyInfoBlock(pdfDoc, page, data, resources, height, drawTextOnPage);

  const tableResult = drawItemsTable(
    page,
    currentY,
    data,
    height,
    bottomLimit,
    createPage,
    drawTextOnPage,
    customFont,
  );
  page = tableResult.page;
  currentY = tableResult.currentY;

  drawFooterBlock(
    page,
    currentY,
    tableResult.subTotal,
    data,
    layoutConfig,
    height,
    bottomLimit,
    createPage,
    drawTextOnPage,
    customFont,
  );

  stampPageNumbers(pdfDoc, height, drawTextOnPage);

  return await pdfDoc.save({ useObjectStreams: true });
}
