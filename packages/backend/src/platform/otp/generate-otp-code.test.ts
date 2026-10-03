import { describe, it, expect } from "vitest";
import { generateOtpCode } from "./generate-otp-code";

describe("generateOtpCode", () => {
  it("既定では4桁のゼロ埋め数字文字列を返す", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{4}$/);
    }
  });

  it("桁数を指定すると指定桁数のコードを返す(可変設定への対応)", () => {
    for (const digits of [4, 6, 8]) {
      const code = generateOtpCode(digits);
      expect(code).toMatch(new RegExp(`^\\d{${digits}}$`));
    }
  });

  it("不正な桁数(0以下やNaN)の場合は既定の4桁にフォールバックする", () => {
    expect(generateOtpCode(0)).toMatch(/^\d{4}$/);
    expect(generateOtpCode(-3)).toMatch(/^\d{4}$/);
    expect(generateOtpCode(NaN)).toMatch(/^\d{4}$/);
  });
});
