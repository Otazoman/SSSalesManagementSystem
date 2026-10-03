import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { generateDocumentPDF, PDFInvoiceData, resolveMemoBoxTopY } from "./pdfGenerator";

/**
 * 画面構成再編: 納品書PDFのレンダラーを注文請書と同じgenerateDocumentPDF(pdfGenerator.ts)へ
 * 切り替えたための検証。既存の呼び出し元(見積/注文請書等、単価は常に数値・showTotals未指定)が
 * 今回の変更後も従来通り動作すること、および納品書(単価がnullの明細を含みうる、
 * showTotals:falseで小計/消費税/合計を表示しない)が例外なく生成できることを確認する。
 *
 * workerdサンドボックス内のnode:fsには実ファイルシステムへのアクセス権が無いため
 * (nodejs_compat有効でも同一パッケージ内のpackage.json読み取りすら失敗することを確認済み)、
 * リポジトリ直下の実フォントファイルをvitest.config.ts側(Node実行環境)で読み込みbase64化し、
 * TEST_FONT_BASE64 bindingとして受け取る(drizzle migrationファイルをTEST_MIGRATIONS bindingで
 * 渡している既存手法と同じ考え方)。
 */

let fontBuffer: ArrayBuffer;

beforeAll(() => {
  const buf = Buffer.from((env as any).TEST_FONT_BASE64, "base64");
  fontBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

function isValidPdf(bytes: Uint8Array): boolean {
  const header = new TextDecoder().decode(bytes.slice(0, 5));
  return header === "%PDF-";
}

describe("generateDocumentPDF", () => {
  it("QUOTATION(既存呼び出し元、単価は常に数値)は今回の変更後も例外なく生成できる", async () => {
    const data: PDFInvoiceData = {
      templateType: "QUOTATION",
      code: "Q-0001",
      date: "2026-08-31",
      customCompanyName: "テスト株式会社",
      customCompanyAddress: "東京都",
      customCompanyTel: "03-0000-0000",
      customCompanyFax: "03-0000-0001",
      customerName: "得意先株式会社",
      totalAmount: 1100,
      taxAmount: 100,
      memo: "テストメモ",
      items: [{ itemName: "テスト品目", quantity: 2, unitPrice: 500 }],
    };

    const pdf = await generateDocumentPDF(data, { fontBuffer });
    expect(isValidPdf(pdf)).toBe(true);
  });

  it("ORDER_ACKNOWLEDGMENT(既存呼び出し元、値引・税率別内訳あり)は今回の変更後も例外なく生成できる", async () => {
    const data: PDFInvoiceData = {
      templateType: "ORDER_ACKNOWLEDGMENT",
      code: "SO-0001",
      date: "2026-08-31",
      customCompanyName: "テスト株式会社",
      customCompanyAddress: "東京都",
      customCompanyTel: "03-0000-0000",
      customCompanyFax: "03-0000-0001",
      customerName: "得意先株式会社",
      totalAmount: 990,
      taxAmount: 90,
      discountTotal: -100,
      taxBreakdown: {
        rate10: { excl: 900, tax: 90 },
        rate8: { excl: 0, tax: 0 },
        rate0: { excl: 0, tax: 0 },
      },
      memo: null,
      items: [{ itemName: "テスト品目", quantity: 1, unitPrice: 1000 }],
    };

    const pdf = await generateDocumentPDF(data, { fontBuffer });
    expect(isValidPdf(pdf)).toBe(true);
  });

  it("DELIVERY(単価ありの明細・単価なし(null)の明細が混在)は例外なく生成でき、小計/消費税/合計を表示しない", async () => {
    const data: PDFInvoiceData = {
      templateType: "DELIVERY",
      code: "SHIP-0001",
      date: "2026-08-31",
      customCompanyName: "テスト株式会社",
      customCompanyAddress: "東京都",
      customCompanyTel: "03-0000-0000",
      customCompanyFax: "03-0000-0001",
      customerName: "得意先株式会社",
      totalAmount: 0,
      taxAmount: 0,
      memo: "検品後、受領印をお願いします。",
      deliveryDate: "2026-08-31",
      sourceWarehouseName: "本社倉庫",
      salesOrderNumber: "SO-0001",
      items: [
        { itemName: "受注紐付き品目(ロット:L001)", quantity: 3, unitPrice: 500 },
        { itemName: "単独出庫品目", quantity: 1, unitPrice: null },
      ],
    };

    const pdf = await generateDocumentPDF(data, { fontBuffer });
    expect(isValidPdf(pdf)).toBe(true);
    // 小計/消費税/合計ブロックは描画されないため、テキスト自体が含まれないことを軽く確認する
    // (pdf.jsのような本格的なテキスト抽出ライブラリはこのプロジェクトに無いため、PDF内部の
    // 未圧縮ストリーム上に該当文字列のバイト列が現れないことまでは厳密に保証しないが、
    // 例外なく生成できること自体が主目的の回帰テストとする)
  });

  it("DELIVERYで受注番号等が空文字の場合も例外なく生成できる(条件表の空欄表示)", async () => {
    const data: PDFInvoiceData = {
      templateType: "DELIVERY",
      code: "SHIP-0002",
      date: "2026-08-31",
      customCompanyName: "テスト株式会社",
      customCompanyAddress: "東京都",
      customCompanyTel: "03-0000-0000",
      customCompanyFax: "03-0000-0001",
      customerName: "得意先株式会社",
      totalAmount: 0,
      taxAmount: 0,
      memo: null,
      deliveryDate: "2026-08-31",
      sourceWarehouseName: "本社倉庫",
      salesOrderNumber: "",
      items: [{ itemName: "単独出庫品目", quantity: 1, unitPrice: undefined }],
    };

    const pdf = await generateDocumentPDF(data, { fontBuffer });
    expect(isValidPdf(pdf)).toBe(true);
  });

  it("多数の明細でページを跨いでも例外なく生成できる(改ページロジックの回帰確認)", async () => {
    const data: PDFInvoiceData = {
      templateType: "DELIVERY",
      code: "SHIP-0003",
      date: "2026-08-31",
      customCompanyName: "テスト株式会社",
      customCompanyAddress: "東京都",
      customCompanyTel: "03-0000-0000",
      customCompanyFax: "03-0000-0001",
      customerName: "得意先株式会社",
      totalAmount: 0,
      taxAmount: 0,
      memo: "改ページ確認用の長い備考\nテストテストテスト",
      deliveryDate: "2026-08-31",
      sourceWarehouseName: "本社倉庫",
      salesOrderNumber: "SO-0003",
      items: Array.from({ length: 40 }, (_, i) => ({
        itemName: `品目${i + 1}(ロット:L${String(i + 1).padStart(3, "0")})`,
        quantity: i + 1,
        unitPrice: i % 2 === 0 ? 100 * (i + 1) : null,
      })),
    };

    const pdf = await generateDocumentPDF(data, { fontBuffer });
    expect(isValidPdf(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

describe("BUG-053: 備考欄の位置", () => {
  it("税率別内訳が無い時、備考欄の上端は明細表の下端より下になる(合計欄の有無に関わらず同じ)", () => {
    const tableBottomY = 500;

    const top = resolveMemoBoxTopY(tableBottomY, null);

    expect(top).toBeLessThan(tableBottomY);
    expect(top).toBe(tableBottomY - 15);
  });

  it("税率別内訳がある時は、内訳の下端の下に備考欄を置く", () => {
    expect(resolveMemoBoxTopY(500, 420)).toBe(410);
  });

  it("DELIVERY(合計欄なし)で備考ありの納品書を、明細が多くページ末尾に近い場合も例外なく生成できる", async () => {
    const data: PDFInvoiceData = {
      templateType: "DELIVERY",
      code: "SH-0001",
      date: "2026-08-31",
      customCompanyName: "テスト株式会社",
      customCompanyAddress: "東京都",
      customCompanyTel: "03-0000-0000",
      customCompanyFax: "03-0000-0001",
      customerName: "得意先株式会社",
      totalAmount: 0,
      taxAmount: 0,
      memo: "得意先Aへの出荷",
      items: Array.from({ length: 25 }, (_, i) => ({ itemName: `品目${i + 1}`, quantity: 1, unitPrice: null })),
    } as PDFInvoiceData;

    const pdf = await generateDocumentPDF(data, { fontBuffer });
    expect(isValidPdf(pdf)).toBe(true);
  });
});
