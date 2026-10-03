import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { PDFDocument } from "pdf-lib";
import { compileTemplateLayout } from "../src/platform/report-templates/compile-template";
import { renderLayoutToPdf } from "../src/platform/report-templates/render-layout-pdf";
import { computeRenderPages } from "../src/platform/report-templates/compute-render-pages";
import type { CompiledLayout } from "../src/platform/report-templates/types";
import { resolveQuotePlaceholders } from "../src/platform/report-templates/resolve-quote-placeholders";
import { resolveOrderPlaceholders } from "../src/platform/report-templates/resolve-order-placeholders";
import { resolvePurchaseOrderPlaceholders } from "../src/platform/report-templates/resolve-purchase-order-placeholders";
import { resolveAcceptanceInspectionPlaceholders } from "../src/platform/report-templates/resolve-acceptance-inspection-placeholders";
import { resolveInstructionPlaceholders } from "../src/platform/report-templates/resolve-instruction-placeholders";
import {
  resolveBillingPlaceholders,
  resolveSalesRecognitionPlaceholders,
  resolvePurchaseRecognitionPlaceholders,
} from "../src/platform/report-templates/resolve-document-placeholders";
import type { InstructionPdfData } from "../src/platform/report-templates/generate-instruction-pdf";

// リポジトリ直下の samplereport/*.xlsx(帳票テンプレートのサンプル)が、
//   ① システムのコンパイル処理でレイアウトに変換でき
//   ② 使っているプレースホルダーが、その帳票の実際の解決処理(resolve-*)が値を返すものだけで
//   ③ 実際のデータを差し込んでPDFを描画でき、未解決の {{ }} が残らない
// ことを確認する。あわせて、印影・住所など特定につながる情報が残っていないことも確認する。
// 10ファイルすべてがテンプレートとして使える形(請求書・売上計上書・仕入計上書も同様)。

const reports = (env as unknown as { TEST_SAMPLE_REPORTS: Record<string, string> }).TEST_SAMPLE_REPORTS;
const bytesOf = (name: string): ArrayBuffer => {
  const bin = atob(reports[name]);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
};
const fontBuffer = (): ArrayBuffer => {
  const bin = atob((env as unknown as { TEST_FONT_BASE64: string }).TEST_FONT_BASE64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
};
const sha256 = async (base64: string) => {
  const bin = atob(base64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const systemConfig = {
  company_name: "サンプル株式会社",
  company_zip: "000-0000",
  company_address: "東京都サンプル区サンプル町1-1-1",
  company_tel: "03-0000-0000",
  company_invoice_registration_no: "T0000000000001",
};
const taxCategoryRates = new Map([["TAX_10", 0.1], ["TAX_8_REDUCED", 0.08]]);
const unitNames = new Map([["PCS", "個"], ["SET", "セット"]]);
const lines = [
  { itemName: "製品X(標準型)", quantity: 3, unitPrice: 12000, unitCode: "PCS", taxCategoryCode: "TAX_10" },
  { itemName: "オプション部品セット", quantity: 2, unitPrice: 3500, unitCode: "SET", taxCategoryCode: "TAX_10" },
  { itemName: "仕入商品Q(飲料水)", quantity: 5, unitPrice: 2400, unitCode: "PCS", taxCategoryCode: "TAX_8_REDUCED" },
];
const withAmount = lines.map((l) => ({ ...l, amount: l.quantity * l.unitPrice }));
const total = withAmount.reduce((s, l) => s + l.amount, 0);
const tax = Math.floor(43000 * 0.1) + Math.floor(12000 * 0.08);
const date = new Date("2026-09-01T00:00:00Z");
const company = {
  name: systemConfig.company_name,
  zip: systemConfig.company_zip,
  address: systemConfig.company_address,
  tel: systemConfig.company_tel,
  invoiceNo: systemConfig.company_invoice_registration_no,
};
// 請求書・売上計上書・仕入計上書に共通の入力
const documentCommon = {
  partnerName: "サンプル得意先A株式会社",
  title: "サンプル案件",
  memo: "備考の例",
  paymentTerms: "月末締翌月末払",
  totalAmount: total + tax,
  taxAmount: tax,
  items: withAmount,
  staffName: "山田 太郎",
  company,
  taxCategoryRates,
  unitNames,
};
const instruction = (over: Partial<InstructionPdfData>): InstructionPdfData => ({
  documentTitle: "サンプル",
  code: "DOC-0001",
  date: "2026-09-01",
  recipientLabel: "サンプル宛先",
  recipientName: "サンプル得意先A株式会社",
  recipientAddress: "東京都サンプル区サンプル町10-1",
  recipientTel: "03-0000-1001",
  partnerLabel: "得意先",
  partnerName: "サンプル得意先A株式会社",
  scheduledDateLabel: "出荷予定日",
  scheduledDate: "2026-09-05",
  companyName: systemConfig.company_name,
  companyZip: systemConfig.company_zip,
  companyAddress: systemConfig.company_address,
  companyTel: systemConfig.company_tel,
  companyFax: "03-0000-0009",
  memo: "備考の例",
  staffName: "山田 太郎",
  deliveryAddressee: "サンプル得意先A 第二倉庫",
  deliveryLocation: "東京都サンプル区サンプル町10-2",
  deliveryPhone: "03-0000-1002",
  salesOrderId: "SO-2026-0001",
  showPriceColumns: true,
  items: lines.map((l, i) => ({
    itemId: `ITEM-${i + 1}`, itemName: l.itemName, lotNumber: "LOT-260810", quantity: l.quantity, unit: unitNames.get(l.unitCode) ?? "",
    remark: "", unitPrice: l.unitPrice, amount: l.quantity * l.unitPrice,
  })),
  ...over,
});

interface Resolved {
  values: Record<string, string>;
  items: Record<string, string>[];
}
// システムが実際にその帳票へ差し込む値(プレースホルダーの解決結果)
const TEMPLATES: { file: string; name: string; resolve: () => Resolved }[] = [
  {
    file: "001_Quotation.xlsx",
    name: "見積書",
    resolve: () =>
      resolveQuotePlaceholders({
        quote: { id: "QT-2026-0001", title: "サンプル案件", quoteDate: date, validUntil: date, totalAmount: total + tax, taxAmount: tax, deliveryDate: "2026-09-30", paymentTerms: "月末締翌月末払", companyName: null, memo: "備考の例" },
        partnerName: "サンプル得意先A株式会社", items: withAmount, staffName: "山田 太郎", systemConfig, taxCategoryRates, unitNames,
      }),
  },
  {
    file: "002_Confirmation.xlsx",
    name: "注文請書",
    resolve: () =>
      resolveOrderPlaceholders({
        order: { id: "SO-2026-0001", title: "サンプル案件", orderDate: date, totalAmount: total + tax, taxAmount: tax, deliveryDate: "2026-09-30", deliveryPlace: "サンプル得意先A 本社", paymentTerms: "月末締翌月末払", companyName: null, memo: "備考の例", sourceQuoteId: null },
        partnerName: "サンプル得意先A株式会社", items: withAmount, staffName: "山田 太郎", systemConfig, taxCategoryRates, unitNames,
      }),
  },
  {
    file: "005_Invoice.xlsx",
    name: "請求書",
    resolve: () =>
      resolveBillingPlaceholders({ ...documentCommon, billingNo: "BL-2026-0001", billingDate: date, periodStart: date, periodEnd: date }),
  },
  { file: "003_Shipping.xlsx", name: "出荷指示書", resolve: () => resolveInstructionPlaceholders(instruction({ documentTitle: "出荷指示書", recipientLabel: "出荷先(外部倉庫)", showPriceColumns: false })) },
  { file: "004_delivery.xlsx", name: "納品書", resolve: () => resolveInstructionPlaceholders(instruction({ documentTitle: "納品書", recipientLabel: "納品先(得意先)", partnerLabel: "出荷元倉庫", partnerName: "第一倉庫(自社・常温)", scheduledDateLabel: "出荷日" })) },
  {
    file: "006_purchase.xlsx",
    name: "発注書",
    resolve: () =>
      resolvePurchaseOrderPlaceholders({
        order: { id: "PO-2026-0001", title: "サンプル発注", orderDate: date, totalAmount: total + tax, taxAmount: tax, deliveryDate: "2026-09-15", deliveryPlace: "第二倉庫(自社・冷蔵)", paymentTerms: "月末締翌月末払", companyName: null, memo: "備考の例", requestId: null },
        partnerName: "サンプル仕入先A材料株式会社", items: lines, staffName: "田中 健太", systemConfig, taxCategoryRates, unitNames,
      }),
  },
  { file: "007_Receiving.xlsx", name: "入荷指示書", resolve: () => resolveInstructionPlaceholders(instruction({ documentTitle: "入荷指示書", recipientLabel: "入荷先(外部倉庫)", partnerLabel: "仕入先", scheduledDateLabel: "入荷予定日", showPriceColumns: false })) },
  {
    file: "008_inspection.xlsx",
    name: "検収書",
    resolve: () =>
      resolveAcceptanceInspectionPlaceholders({
        header: { id: "RCPT-0001", orderId: "PO-2026-0001", receivedDate: date, memo: "備考の例" },
        partnerName: "サンプル仕入先A材料株式会社", items: lines.map((l) => ({ ...l })), staffName: "田中 健太", systemConfig, taxCategoryRates, unitNames,
      }),
  },
  {
    file: "009_SalesRecognition.xlsx",
    name: "売上計上書",
    resolve: () => resolveSalesRecognitionPlaceholders({ ...documentCommon, salesNo: "SI-2026-0001", salesDate: date }),
  },
  {
    file: "010_PurchaseRecognition.xlsx",
    name: "仕入計上書",
    resolve: () =>
      resolvePurchaseRecognitionPlaceholders({
        ...documentCommon,
        partnerName: "サンプル仕入先A材料株式会社",
        staffName: "田中 健太",
        purchaseNo: "PR-2026-0001",
        purchaseDate: date,
        purchaseOrderNo: "PO-2026-0001",
      }),
  },
];

// 実在の会社・場所を特定できる情報。加工前のサンプルに含まれていた値
const FORBIDDEN_TEXT = ["千代田", "100-0001", "T1234567890123", "エージェンシー"];
// 加工前の印影画像(実在の社名入り)のSHA-256。埋め込まれていてはならない
const REAL_SEAL_SHA256 = "045a1cb481bf514ec176e4348ad2c8548f6e489559ad7b348fe1d292547dfe51";

describe("samplereport/ の帳票テンプレート(xlsx)", () => {
  it("想定の10ファイルが揃っている(見積〜検収書の8種+売上計上書・仕入計上書)", () => {
    expect(Object.keys(reports).sort()).toEqual([
      "001_Quotation.xlsx", "002_Confirmation.xlsx", "003_Shipping.xlsx", "004_delivery.xlsx", "005_Invoice.xlsx",
      "006_purchase.xlsx", "007_Receiving.xlsx", "008_inspection.xlsx", "009_SalesRecognition.xlsx", "010_PurchaseRecognition.xlsx",
    ]);
  });

  for (const t of TEMPLATES) {
    describe(`${t.file}(${t.name})`, () => {
      let layout: CompiledLayout;
      const resolved = t.resolve();

      it("システムのコンパイル処理でレイアウトに変換でき、明細のひな形行がある", async () => {
        layout = await compileTemplateLayout(bytesOf(t.file));
        expect(layout.cells.length).toBeGreaterThan(10);
        expect(layout.itemTemplateRow).not.toBeNull();
      });

      it("使っているプレースホルダーは、この帳票の解決処理が値を返すものだけ", async () => {
        layout = layout ?? (await compileTemplateLayout(bytesOf(t.file)));
        const allowed = new Set([...Object.keys(resolved.values), ...Object.keys(resolved.items[0]).map((k) => `item.${k}`)]);
        const used = [...new Set(layout.cells.flatMap((c) => c.placeholders))];
        expect(used.length).toBeGreaterThan(5);
        expect(used.filter((p) => !allowed.has(p))).toEqual([]);
      });

      it("実際のデータを差し込むと、未解決の {{ }} が残らず、明細が3行分描画されてPDFを生成できる", async () => {
        layout = layout ?? (await compileTemplateLayout(bytesOf(t.file)));
        const pages = computeRenderPages(layout, resolved.values, resolved.items);
        const texts = pages.flatMap((p) => p.cells.map((c) => c.text));
        expect(texts.filter((x) => x.includes("{{"))).toEqual([]);
        // 3件の明細が、それぞれ1行ずつ描画される(ひな形行が3回複製される)
        const itemName = resolved.items[0].name ?? resolved.items[0].item_name;
        expect(texts.filter((x) => x.includes(itemName)).length).toBeGreaterThanOrEqual(1);

        const pdf = await renderLayoutToPdf(layout, resolved.values, resolved.items, fontBuffer());
        expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
        expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(1);
      });

      it("特定につながる情報(実在の社名の印影・住所・番号)が含まれていない", async () => {
        layout = layout ?? (await compileTemplateLayout(bytesOf(t.file)));
        const text = layout.cells.map((c) => c.text).join("\n");
        for (const word of FORBIDDEN_TEXT) expect(text).not.toContain(word);
        for (const image of layout.images) expect(await sha256(image.base64)).not.toBe(REAL_SEAL_SHA256);
      });
    });
  }
});
