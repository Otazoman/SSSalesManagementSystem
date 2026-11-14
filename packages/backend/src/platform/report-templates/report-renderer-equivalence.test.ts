import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { env } from "cloudflare:test";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { appendPdfPages, generateDocumentPDF, type PDFInvoiceData } from "../../utils/pdfGenerator";
import { generateInstructionPdf, type InstructionPdfData } from "./generate-instruction-pdf";
import { renderLayoutToPdf } from "./render-layout-pdf";
import { compileTemplateLayout } from "./compile-template";
import { renderReportPdf } from "report-renderer";

/**
 * PERF-07 B-1: 帳票の描画のコードを共有パッケージ(packages/report-renderer)へ移す前と後で、
 * 同じ入力から同じ PDF(ページ数・バイト列)ができることを確かめる。
 * PDF には作成日時と、フォント名に付く乱数が入るため、時刻と Math.random を固定して作る。
 * 期待値(EXPECTED)は、移す前のコード(コミット 1ea7ac5)で作った PDF のもの。
 * 帳票の見た目を意図して変えた時(BUG-092 など)は、この期待値を作り直す。
 */

const FIXED_NOW = new Date("2026-11-14T00:00:00Z");

let fontBuffer: ArrayBuffer;
// 1x1 の PNG(ロゴ・社印の描画を通すため)
const PNG_1X1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
).buffer;

beforeAll(() => {
  const bin = atob((env as unknown as { TEST_FONT_BASE64: string }).TEST_FONT_BASE64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  fontBuffer = buf.buffer;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

async function fingerprint(make: () => Promise<Uint8Array>) {
  const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
  try {
    const bytes = await make();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const pages = (await PDFDocument.load(bytes)).getPageCount();
    return { pages, sha256 };
  } finally {
    random.mockRestore();
  }
}

function documentData(templateType: PDFInvoiceData["templateType"], itemCount = 3): PDFInvoiceData {
  return {
    templateType,
    code: `${templateType}-0001`,
    date: "2026-11-14",
    customCompanyName: "テスト株式会社",
    customCompanyAddress: "東京都千代田区1-1-1",
    customCompanyTel: "03-0000-0000",
    customCompanyFax: "03-0000-0001",
    customerName: "得意先株式会社",
    totalAmount: 3300 * itemCount,
    taxAmount: 300 * itemCount,
    discountTotal: -100,
    taxBreakdown: {
      rate10: { excl: 2000, tax: 200 },
      rate8: { excl: 1000, tax: 80 },
      rate0: { excl: 0, tax: 0 },
    },
    memo: "テストの備考です。\n2行目の備考。",
    items: Array.from({ length: itemCount }, (_, i) => ({
      itemName: `テスト品目${i + 1}(長い名前の品目を含めて折り返しを確かめる)`,
      quantity: i + 1,
      unitPrice: 1000 + i,
      deliveryDate: "2026-12-01",
    })),
  } as PDFInvoiceData;
}

const TEMPLATE_TYPES = [
  "QUOTATION",
  "INVOICE",
  "ORDER",
  "ORDER_ACKNOWLEDGMENT",
  "DELIVERY",
  "ACCEPTANCE",
  "PURCHASE_RECOGNITION",
  "SALES_RECOGNITION",
  "CUSTOMER_ORDER_FORM",
] as const;

function instructionData(kind: "receipt" | "shipment" | "delivery", itemCount = 3): InstructionPdfData {
  const shipment = kind !== "receipt";
  return {
    documentTitle: kind === "receipt" ? "入荷指示書" : kind === "shipment" ? "出荷指示書" : "納品書",
    code: `${kind}-0001`,
    date: "2026-11-14",
    recipientLabel: shipment ? "出荷先(外部倉庫)" : "入荷先(外部倉庫)",
    recipientName: "外部倉庫株式会社",
    recipientAddress: "埼玉県さいたま市1-1",
    recipientTel: "048-000-0000",
    partnerLabel: shipment ? "得意先" : "仕入先",
    partnerName: "取引先株式会社",
    scheduledDateLabel: shipment ? "出荷予定日" : "入荷予定日",
    scheduledDate: "2026-11-20",
    companyName: "テスト株式会社",
    companyZip: "100-0001",
    companyAddress: "東京都千代田区1-1-1",
    companyTel: "03-0000-0000",
    companyFax: "03-0000-0001",
    memo: "指示書の備考",
    staffName: "担当太郎",
    deliveryAddressee: shipment ? "納品先様" : null,
    deliveryLocation: shipment ? "大阪府大阪市1-1" : null,
    deliveryPhone: shipment ? "06-0000-0000" : null,
    salesOrderId: kind === "delivery" ? "SO-0001" : null,
    showPriceColumns: kind === "delivery",
    items: Array.from({ length: itemCount }, (_, i) => ({
      itemId: `ITEM-${i + 1}`,
      itemName: `指示品目${i + 1}`,
      lotNumber: `LOT-${i + 1}`,
      quantity: i + 1,
      unit: "個",
      remark: i === 0 ? "備考あり" : null,
      unitPrice: kind === "delivery" ? 500 : null,
      amount: kind === "delivery" ? 500 * (i + 1) : null,
    })),
  };
}

async function compiledLayout() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("テンプレート");
  sheet.getCell("A1").value = "請求書 {{billing_no}}";
  sheet.getCell("A2").value = "{{partner_name}} 御中";
  sheet.getCell("A4").value = "{{item.name}}";
  sheet.getCell("B4").value = "{{item.amount}}";
  sheet.getColumn(1).width = 40;
  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  return compileTemplateLayout(buffer);
}

// 移す前のコード(コミット 1ea7ac5)で作った PDF のページ数とバイト列の SHA-256
const EXPECTED: Record<string, { pages: number; sha256: string }> = {
  "QUOTATION": { pages: 1, sha256: "d60a3c911b3a532a67aafb80b0a1365fd44cb67e12e1336d2a067fde6f5b59c8" },
  "INVOICE": { pages: 1, sha256: "42232b0406ce688a77fc7731d4da5bc716a34ba868b46a701880f7bdaaddfd77" },
  "ORDER": { pages: 1, sha256: "3e224e0506d6412e7a3bb58304cec21d6e893f2a4d5a858c8861a1e59f97928b" },
  "ORDER_ACKNOWLEDGMENT": { pages: 1, sha256: "ff37cfa84c639f4ada6e3adff4c6587202ba5a5c03ccf90d8f509d96854c0765" },
  "DELIVERY": { pages: 1, sha256: "3db467b783b09420716861f71caafd0576231c7da9f8dcc2f2cbc72432a70e43" },
  "ACCEPTANCE": { pages: 1, sha256: "8c1622b34526a986fd0d760b683082f52198d2dfb7c4ff26d9314c67ad938981" },
  "PURCHASE_RECOGNITION": { pages: 1, sha256: "311cda4d71883eb9b82347ac2d0aba01bf0f84dc47bef56a32740aac109de6f6" },
  "SALES_RECOGNITION": { pages: 1, sha256: "fffe1de967c063e25deeb63f2bd43cafe199256d99cd57d05a77d79dbb94aee6" },
  "CUSTOMER_ORDER_FORM": { pages: 1, sha256: "ff59acab4508773c6638cf41c6d430dd63b20c332f39a9edd0bebcdc751f3638" },
  "QUOTATION(ロゴ・社印・改ページ)": { pages: 3, sha256: "72e13a1938fa5b272e21f9b1a53ecf8208b90316b5b09770b4856fb6d6ce7c8c" },
  "見積書+ご発注書(appendPdfPages)": { pages: 2, sha256: "16ca67c9faf67a4cfe50b914e379c842a216271443c21ee7d89216ed6c3e63d8" },
  "指示書(receipt)": { pages: 1, sha256: "92154ff16072e7f5123cf1b3d83aced9188e0fe642d77b9fcfc722c9bf55a99b" },
  "指示書(shipment)": { pages: 1, sha256: "bfa375a693f7ef5cc016cfba09cf85c0fdc63c9ec119623855074aa5bf1acdd3" },
  "指示書(delivery)": { pages: 1, sha256: "61e5ce75be616582096adff5c3e473d5edad7eeca495d3762937327d5fcf2f9d" },
  "指示書(改ページ)": { pages: 3, sha256: "1d0a913931ceb6f34e61d1acedec0b4599483e6df5daddd3653fe232f403339c" },
  "Excel テンプレート": { pages: 1, sha256: "9fafd16a2e7c168b6aeef398e5851d982e96e15da368e34ce3dcf29e9fa01edb" },
};

async function actualFingerprints() {
  const result: Record<string, { pages: number; sha256: string }> = {};
  for (const templateType of TEMPLATE_TYPES) {
    result[templateType] = await fingerprint(() =>
      generateDocumentPDF(documentData(templateType), { fontBuffer }),
    );
  }
  result["QUOTATION(ロゴ・社印・改ページ)"] = await fingerprint(() =>
    generateDocumentPDF(documentData("QUOTATION", 60), {
      fontBuffer,
      logoBuffer: PNG_1X1,
      sealBuffer: PNG_1X1,
    } as Parameters<typeof generateDocumentPDF>[1]),
  );
  result["見積書+ご発注書(appendPdfPages)"] = await fingerprint(async () =>
    appendPdfPages(
      await generateDocumentPDF(documentData("QUOTATION"), { fontBuffer }),
      await generateDocumentPDF(documentData("CUSTOMER_ORDER_FORM"), { fontBuffer }),
    ),
  );
  for (const kind of ["receipt", "shipment", "delivery"] as const) {
    result[`指示書(${kind})`] = await fingerprint(() =>
      generateInstructionPdf(instructionData(kind), { fontBuffer, logoBuffer: PNG_1X1, sealBuffer: PNG_1X1 }),
    );
  }
  result["指示書(改ページ)"] = await fingerprint(() =>
    generateInstructionPdf(instructionData("shipment", 60), { fontBuffer }),
  );
  const layout = await compiledLayout();
  result["Excel テンプレート"] = await fingerprint(() =>
    renderLayoutToPdf(
      layout,
      { billing_no: "BL-0001", partner_name: "得意先株式会社" },
      Array.from({ length: 5 }, (_, i) => ({ name: `明細${i + 1}`, amount: `${(i + 1) * 1000}` })),
      fontBuffer,
    ),
  );
  return result;
}

describe("帳票の描画を共有パッケージへ移す前後で同じ PDF になる(PERF-07 B-1)", () => {
  it("帳票の種類ごとに、ページ数とバイト列が移す前と同じ", async () => {
    const actual = await actualFingerprints();
    expect(actual).toEqual(EXPECTED);
  });

  it("同じ入力から作ると、毎回同じ PDF になる(この確かめ方が成り立つこと)", async () => {
    const a = await fingerprint(() => generateDocumentPDF(documentData("QUOTATION"), { fontBuffer }));
    const b = await fingerprint(() => generateDocumentPDF(documentData("QUOTATION"), { fontBuffer }));
    expect(a).toEqual(b);
  });
});

// PERF-07 B-3: ブラウザとサーバーで使う描画の入口(renderReportPdf)が、以前の各 *-pdf.service.ts と同じ順番で描き、
// 移す前と同じ PDF になること(期待値は上の EXPECTED をそのまま使う)
describe("renderReportPdf(PERF-07 B-3)", () => {
  it("既定のレイアウト(帳票・指示書)・ご発注書の付加・Excel テンプレートで、移す前と同じ PDF になる", async () => {
    expect(
      await fingerprint(() =>
        renderReportPdf(
          { documentType: "billing_invoice", customLayout: null, fallback: { kind: "document", data: documentData("INVOICE") } },
          { fontBuffer },
        ),
      ),
    ).toEqual(EXPECTED["INVOICE"]);
    expect(
      await fingerprint(() =>
        renderReportPdf(
          {
            documentType: "sales_quote",
            customLayout: null,
            fallback: { kind: "document", data: documentData("QUOTATION") },
            appendDocuments: [documentData("CUSTOMER_ORDER_FORM")],
          },
          { fontBuffer },
        ),
      ),
    ).toEqual(EXPECTED["見積書+ご発注書(appendPdfPages)"]);
    expect(
      await fingerprint(() =>
        renderReportPdf(
          { documentType: "shipment_instruction", customLayout: null, fallback: { kind: "instruction", data: instructionData("shipment") } },
          { fontBuffer, logoBuffer: PNG_1X1, sealBuffer: PNG_1X1 },
        ),
      ),
    ).toEqual(EXPECTED["指示書(shipment)"]);
    const layout = await compiledLayout();
    expect(
      await fingerprint(() =>
        renderReportPdf(
          {
            documentType: "billing_invoice",
            customLayout: {
              layout,
              values: { billing_no: "BL-0001", partner_name: "得意先株式会社" },
              items: Array.from({ length: 5 }, (_, i) => ({ name: `明細${i + 1}`, amount: `${(i + 1) * 1000}` })),
            },
            fallback: { kind: "document", data: documentData("INVOICE") },
          },
          { fontBuffer },
        ),
      ),
    ).toEqual(EXPECTED["Excel テンプレート"]);
  });

  it("Excel テンプレートで描けない時は、既定のレイアウトで描く(以前と同じ)", async () => {
    const broken = { cells: null } as unknown as Awaited<ReturnType<typeof compiledLayout>>;
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        await fingerprint(() =>
          renderReportPdf(
            {
              documentType: "billing_invoice",
              customLayout: { layout: broken, values: {}, items: [] },
              fallback: { kind: "document", data: documentData("INVOICE") },
            },
            { fontBuffer },
          ),
        ),
      ).toEqual(EXPECTED["INVOICE"]);
      expect(errorLog).toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });
});
