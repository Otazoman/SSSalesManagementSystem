import { describe, it, expect } from "vitest";
import { hasValidJanCheckDigit, labelBarcodeFormat } from "./barcode-format";

describe("labelBarcodeFormat", () => {
  it("チェックデジットが正しい13桁は EAN13(JAN)", () => {
    expect(labelBarcodeFormat("4901234567894")).toBe("EAN13");
    // インストアコード(20 で始まる。サンプルデータの商品バーコード)
    expect(labelBarcodeFormat("2000000010014")).toBe("EAN13");
  });

  it("チェックデジットが正しい8桁は EAN8", () => {
    expect(labelBarcodeFormat("49123456")).toBe("EAN8");
  });

  it("チェックデジットが合わない数字・英字を含む値・その他の桁数は CODE128", () => {
    expect(labelBarcodeFormat("2000000001001")).toBe("CODE128");
    expect(labelBarcodeFormat("SMP-PRT-C001")).toBe("CODE128");
    expect(labelBarcodeFormat("ITEM-9001")).toBe("CODE128");
    expect(labelBarcodeFormat("123456789012")).toBe("CODE128");
  });
});

describe("hasValidJanCheckDigit", () => {
  it("13桁・8桁以外や数字以外は false", () => {
    expect(hasValidJanCheckDigit("")).toBe(false);
    expect(hasValidJanCheckDigit("490123456789A")).toBe(false);
    expect(hasValidJanCheckDigit("12345")).toBe(false);
  });
});
