import { describe, it, expect } from "vitest";
import { resolveQuotePlaceholders } from "./resolve-quote-placeholders";

describe("resolveQuotePlaceholders", () => {
  const baseQuote = {
    id: "QT-0001",
    title: "テスト件名",
    quoteDate: new Date("2026-06-01T00:00:00Z"),
    validUntil: new Date("2026-06-15T00:00:00Z"),
    totalAmount: 22000,
    taxAmount: 2000,
    deliveryDate: "2週間後",
    paymentTerms: "月末締翌月末払",
    companyName: "テスト取引先",
  };

  it("税率別内訳を明細から正しく集計する(10%/8%/0%)", () => {
    const items = [
      { itemName: "品目A", quantity: 1, unitPrice: 10000, amount: 10000, unitCode: "式", taxCategoryCode: "TAX_10" },
      { itemName: "品目B", quantity: 1, unitPrice: 5000, amount: 5000, unitCode: "個", taxCategoryCode: "TAX_8_REDUCED" },
      { itemName: "品目C", quantity: 1, unitPrice: 3000, amount: 3000, unitCode: "個", taxCategoryCode: "TAX_EXEMPT" },
    ];
    const taxCategoryRates = new Map([
      ["TAX_10", 0.1],
      ["TAX_8_REDUCED", 0.08],
      ["TAX_EXEMPT", 0],
    ]);

    const result = resolveQuotePlaceholders({
      quote: baseQuote,
      partnerName: "テスト取引先",
      items,
      staffName: "山田太郎",
      systemConfig: { company_name: "自社株式会社" },
      taxCategoryRates,
      unitNames: new Map(),
    });

    expect(result.values["tax_breakdown.rate10.excl"]).toBe("¥10,000");
    expect(result.values["tax_breakdown.rate10.tax"]).toBe("¥1,000");
    expect(result.values["tax_breakdown.rate8.excl"]).toBe("¥5,000");
    expect(result.values["tax_breakdown.rate8.tax"]).toBe("¥400");
    expect(result.values["tax_breakdown.rate0.excl"]).toBe("¥3,000");
    expect(result.values["tax_breakdown.rate0.tax"]).toBe("¥0");
  });

  it("マイナス金額の明細(値引き行)を値引き合計として集計する", () => {
    const items = [
      { itemName: "品目A", quantity: 1, unitPrice: 10000, amount: 10000, unitCode: "式", taxCategoryCode: "TAX_10" },
      { itemName: "値引き", quantity: 1, unitPrice: -3000, amount: -3000, unitCode: "式", taxCategoryCode: "TAX_10" },
    ];
    const result = resolveQuotePlaceholders({
      quote: baseQuote,
      partnerName: "テスト取引先",
      items,
      staffName: "山田太郎",
      systemConfig: {},
      taxCategoryRates: new Map([["TAX_10", 0.1]]),
      unitNames: new Map(),
    });

    expect(result.values.subtotal_before_discount).toBe("¥10,000");
    expect(result.values.discount_total).toBe("-¥3,000");
    expect(result.items[1].amount).toBe("-¥3,000");
  });

  it("taxCategoryCodeがnullの明細はデフォルト10%として扱う", () => {
    const items = [
      { itemName: "品目A", quantity: 1, unitPrice: 10000, amount: 10000, unitCode: null, taxCategoryCode: null },
    ];
    const result = resolveQuotePlaceholders({
      quote: baseQuote,
      partnerName: "テスト取引先",
      items,
      staffName: "山田太郎",
      systemConfig: {},
      taxCategoryRates: new Map(),
      unitNames: new Map(),
    });

    expect(result.values["tax_breakdown.rate10.excl"]).toBe("¥10,000");
    expect(result.items[0].tax_rate).toBe("10%");
    expect(result.items[0].unit).toBe("");
  });

  it("unitCodeを単位マスタの日本語名称に変換する(マスタに無いコードはそのまま表示)", () => {
    const items = [
      { itemName: "品目A", quantity: 1, unitPrice: 1000, amount: 1000, unitCode: "KG", taxCategoryCode: "TAX_10" },
      { itemName: "品目B", quantity: 1, unitPrice: 1000, amount: 1000, unitCode: "UNKNOWN_CODE", taxCategoryCode: "TAX_10" },
    ];
    const unitNames = new Map([["KG", "キログラム"]]);
    const result = resolveQuotePlaceholders({
      quote: baseQuote,
      partnerName: "テスト取引先",
      items,
      staffName: "山田太郎",
      systemConfig: {},
      taxCategoryRates: new Map([["TAX_10", 0.1]]),
      unitNames,
    });

    expect(result.items[0].unit).toBe("キログラム");
    expect(result.items[1].unit).toBe("UNKNOWN_CODE");
  });

  it("見出し系のプレースホルダー値を正しく変換する", () => {
    const result = resolveQuotePlaceholders({
      quote: baseQuote,
      partnerName: "テスト取引先",
      items: [],
      staffName: "山田太郎",
      systemConfig: {
        company_name: "自社株式会社",
        company_invoice_registration_no: "T1234567890123",
      },
      taxCategoryRates: new Map(),
      unitNames: new Map(),
    });

    expect(result.values.quote_no).toBe("QT-0001");
    expect(result.values.quote_date).toBe("2026-06-01");
    expect(result.values.valid_until).toBe("2026-06-15");
    expect(result.values.partner_name).toBe("テスト取引先");
    expect(result.values.title).toBe("テスト件名");
    expect(result.values.subtotal).toBe("¥20,000");
    expect(result.values.tax_amount).toBe("¥2,000");
    expect(result.values.total_amount).toBe("¥22,000");
    expect(result.values.company_name).toBe("自社株式会社");
    expect(result.values.company_invoice_no).toBe("T1234567890123");
    expect(result.values.sales_person_name).toBe("山田太郎");
  });
});
