import { describe, it, expect } from "vitest";
import {
  allocateDocumentTaxToLines,
  allocateTaxToLines,
  roundTaxAmount,
  toTaxRoundingMode,
} from "./compute-tax-amounts";

describe("roundTaxAmount", () => {
  it("切り捨て・四捨五入・切り上げ", () => {
    expect(roundTaxAmount(1005, 0.1, "floor")).toBe(100);
    expect(roundTaxAmount(1005, 0.1, "round")).toBe(101);
    expect(roundTaxAmount(1001, 0.1, "ceil")).toBe(101);
    expect(roundTaxAmount(1250, 0.08, "floor")).toBe(100);
  });

  it("浮動小数の誤差で切り上げが1円ずれない(1010 * 0.1 = 101.00000000000001)", () => {
    expect(roundTaxAmount(1010, 0.1, "ceil")).toBe(101);
    expect(roundTaxAmount(1010, 0.1, "floor")).toBe(101);
  });

  it("マイナス(値引・返品)は絶対値で丸めて符号を戻す", () => {
    expect(roundTaxAmount(-1005, 0.1, "floor")).toBe(-100);
    expect(roundTaxAmount(-1005, 0.1, "round")).toBe(-101);
    expect(roundTaxAmount(-1001, 0.1, "ceil")).toBe(-101);
    expect(Object.is(roundTaxAmount(-3, 0.1, "floor"), -0)).toBe(false);
  });
});

describe("toTaxRoundingMode", () => {
  it("未設定・不正な値は初期値(切り捨て)", () => {
    expect(toTaxRoundingMode(undefined)).toBe("floor");
    expect(toTaxRoundingMode("half")).toBe("floor");
    expect(toTaxRoundingMode("ceil")).toBe("ceil");
  });
});

describe("allocateTaxToLines", () => {
  it("明細の消費税の合計が、税率ごとに1回端数処理した消費税と一致する", () => {
    const lines = [
      { amount: 333, rate: 0.1 },
      { amount: 333, rate: 0.1 },
      { amount: 334, rate: 0.1 },
      { amount: 125, rate: 0.08 },
    ];
    const taxes = allocateTaxToLines(lines, "round");
    expect(taxes[0] + taxes[1] + taxes[2]).toBe(roundTaxAmount(1000, 0.1, "round"));
    expect(taxes[3]).toBe(10);
  });

  it("明細ごとに丸めた合計と、税率ごとの合計が違う場合も一致させる", () => {
    // 明細ごとの切り捨ては 0+0+0 = 0円、合計(15円 * 0.1 = 1.5)の四捨五入は 2円
    const taxes = allocateTaxToLines(
      [
        { amount: 5, rate: 0.1 },
        { amount: 5, rate: 0.1 },
        { amount: 5, rate: 0.1 },
      ],
      "round",
    );
    expect(taxes.reduce((s, t) => s + t, 0)).toBe(2);
  });

  it("値引(マイナスの明細)を含んでも合計が一致する", () => {
    const lines = [
      { amount: 1005, rate: 0.1 },
      { amount: -3, rate: 0.1 },
    ];
    const taxes = allocateTaxToLines(lines, "floor");
    expect(taxes[0] + taxes[1]).toBe(100);
  });
});

describe("allocateDocumentTaxToLines", () => {
  it("伝票に保存された消費税と違う場合は、金額の最も大きい明細で合わせる", () => {
    const lines = [
      { amount: 1005, rate: 0.1 },
      { amount: 100, rate: 0.1 },
    ];
    // 切り捨てでは 110円。伝票(四捨五入で保存された古い伝票)は 111円
    const taxes = allocateDocumentTaxToLines(lines, "floor", 111);
    expect(taxes[0] + taxes[1]).toBe(111);
    expect(taxes[1]).toBe(10);
  });
});
