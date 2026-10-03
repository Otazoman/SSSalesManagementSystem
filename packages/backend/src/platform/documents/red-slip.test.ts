import { describe, it, expect } from "vitest";
import { isRedSlip, signedAmount, ORIGINAL_REQUIRED_DOCUMENT_TYPES } from "./red-slip";

describe("red-slip(追加要望L-2-a)", () => {
  it("SALE/PURCHASE以外の区分が赤伝で、集計では減算(マイナス)として扱う", () => {
    for (const t of ["RETURN", "DISCOUNT", "CORRECTION"]) {
      expect(isRedSlip(t)).toBe(true);
      expect(signedAmount(t, 1000)).toBe(-1000);
    }
    for (const t of ["SALE", "PURCHASE", null, undefined, ""]) {
      expect(isRedSlip(t)).toBe(false);
      expect(signedAmount(t, 1000)).toBe(1000);
    }
  });

  it("元伝票が必須なのは返品/値引のみ(赤伝(訂正)は元伝票なしの自由入力も可)", () => {
    expect([...ORIGINAL_REQUIRED_DOCUMENT_TYPES]).toEqual(["RETURN", "DISCOUNT"]);
  });
});
