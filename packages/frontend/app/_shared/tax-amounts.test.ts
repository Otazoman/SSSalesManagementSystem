import { describe, it, expect } from "vitest";
import { roundTaxAmount, toTaxRoundingMode } from "./tax-amounts";

// Backend(platform/tax/compute-tax-amounts.test.ts)と同じ例で、同じ結果になることを確かめる
describe("roundTaxAmount", () => {
  it("切り捨て・四捨五入・切り上げ", () => {
    expect(roundTaxAmount(1005, 0.1, "floor")).toBe(100);
    expect(roundTaxAmount(1005, 0.1, "round")).toBe(101);
    expect(roundTaxAmount(1001, 0.1, "ceil")).toBe(101);
  });

  it("浮動小数の誤差で切り上げが1円ずれない", () => {
    expect(roundTaxAmount(1010, 0.1, "ceil")).toBe(101);
  });

  it("マイナス(値引)は絶対値で丸めて符号を戻す", () => {
    expect(roundTaxAmount(-1005, 0.1, "floor")).toBe(-100);
    expect(roundTaxAmount(-1005, 0.1, "round")).toBe(-101);
  });
});

describe("toTaxRoundingMode", () => {
  it("未設定・不正な値は切り捨て", () => {
    expect(toTaxRoundingMode(undefined)).toBe("floor");
    expect(toTaxRoundingMode("x")).toBe("floor");
    expect(toTaxRoundingMode("round")).toBe("round");
  });
});
