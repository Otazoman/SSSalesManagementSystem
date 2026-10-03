import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import ExcelJS from "exceljs";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { compileTemplateLayout } from "./compile-template";
import { resolveBillingPlaceholders } from "./resolve-document-placeholders";
import { tryRenderDocumentPdfFromCustomTemplate } from "./try-render-document-pdf";

const db = drizzle(env.DB, { schema });
const LAYOUT_PATH = "report_templates/billing_invoice.layout.json";

function fontBuffer(): ArrayBuffer {
  const bin = atob((env as unknown as { TEST_FONT_BASE64: string }).TEST_FONT_BASE64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function buildLayout() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("テンプレート");
  sheet.getCell("A1").value = "{{billing_no}}";
  sheet.getCell("A2").value = "{{item.name}}";
  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  return compileTemplateLayout(buffer);
}

async function saveTemplate(status: "PENDING" | "READY" | "FAILED", withLayoutFile: boolean) {
  await db.delete(schema.mailTemplateSettings);
  await db.insert(schema.mailTemplateSettings).values({
    id: "billing_invoice",
    name: "請求書",
    subjectTemplate: "件名",
    bodyTemplate: "本文",
    reportLayoutPath: LAYOUT_PATH,
    reportLayoutStatus: status,
    updatedAt: new Date(),
  });
  if (withLayoutFile) {
    await env.SYSTEM_BUCKET.put(LAYOUT_PATH, JSON.stringify(await buildLayout()));
  } else {
    await env.SYSTEM_BUCKET.delete(LAYOUT_PATH);
  }
}

const resolve = () =>
  resolveBillingPlaceholders({
    billingNo: "BL-0001",
    billingDate: new Date("2026-09-01T00:00:00Z"),
    periodStart: null,
    periodEnd: null,
    partnerName: "サンプル取引先",
    title: null,
    memo: null,
    paymentTerms: null,
    totalAmount: 11000,
    taxAmount: 1000,
    items: [
      { itemName: "製品X", quantity: 1, unitPrice: 10000, amount: 10000, taxCategoryCode: "TAX_10" },
    ],
    staffName: "",
    company: { name: "", zip: "", address: "", tel: "", invoiceNo: "" },
    taxCategoryRates: new Map([["TAX_10", 0.1]]),
    unitNames: new Map(),
  });

beforeEach(async () => {
  await db.delete(schema.mailTemplateSettings);
});

describe("tryRenderDocumentPdfFromCustomTemplate", () => {
  it("テンプレートが登録・コンパイル済み(READY)ならPDFを生成する", async () => {
    await saveTemplate("READY", true);
    const pdf = await tryRenderDocumentPdfFromCustomTemplate(env, "billing_invoice", resolve, fontBuffer());
    expect(pdf).not.toBeNull();
    expect(new TextDecoder().decode(pdf!.slice(0, 5))).toBe("%PDF-");
  });

  it("テンプレート未登録ならnull(既定のレイアウトへ戻る)", async () => {
    const pdf = await tryRenderDocumentPdfFromCustomTemplate(env, "billing_invoice", resolve, fontBuffer());
    expect(pdf).toBeNull();
  });

  it("コンパイル中・失敗(READYでない)ならnull", async () => {
    await saveTemplate("PENDING", true);
    expect(await tryRenderDocumentPdfFromCustomTemplate(env, "billing_invoice", resolve, fontBuffer())).toBeNull();
    await saveTemplate("FAILED", true);
    expect(await tryRenderDocumentPdfFromCustomTemplate(env, "billing_invoice", resolve, fontBuffer())).toBeNull();
  });

  it("レイアウトのファイルが無い、または描画に失敗したらnull", async () => {
    await saveTemplate("READY", false);
    expect(await tryRenderDocumentPdfFromCustomTemplate(env, "billing_invoice", resolve, fontBuffer())).toBeNull();

    await saveTemplate("READY", true);
    const broken = () => {
      throw new Error("差し込み失敗");
    };
    expect(await tryRenderDocumentPdfFromCustomTemplate(env, "billing_invoice", broken, fontBuffer())).toBeNull();
  });
});

describe("resolve-document-placeholders", () => {
  it("請求書: 請求番号・請求日・税率別内訳・金額を差し込み値にする", () => {
    const { values, items } = resolve();
    expect(values.billing_no).toBe("BL-0001");
    expect(values.billing_date).toBe("2026-09-01");
    expect(values.period_start).toBe("");
    expect(values.total_amount).toBe("¥11,000");
    expect(values.subtotal).toBe("¥10,000");
    expect(values["tax_breakdown.rate10.excl"]).toBe("¥10,000");
    expect(values["tax_breakdown.rate10.tax"]).toBe("¥1,000");
    expect(items).toEqual([
      { no: "1", name: "製品X", qty: "1", unit: "", unit_price: "¥10,000", tax_rate: "10%", amount: "¥10,000" },
    ]);
  });
});
