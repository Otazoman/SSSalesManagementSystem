import { describe, it, expect } from "vitest";
import { describePasswordPolicy, toPasswordPolicy } from "./password-policy";

describe("password-policy(BUG-046)", () => {
  it("未設定の場合は8文字以上", () => {
    expect(describePasswordPolicy(toPasswordPolicy({}))).toBe("8文字以上にしてください");
  });

  it("会社設定の文字数・文字の種類を説明する", () => {
    expect(
      describePasswordPolicy(
        toPasswordPolicy({
          password_min_length: "12",
          password_require_uppercase: true,
          password_require_digit: true,
        }),
      ),
    ).toBe("12文字以上で、英大文字・数字を含めてください");
  });

  it("文字数が範囲外の場合は8文字", () => {
    expect(toPasswordPolicy({ password_min_length: "100" }).minLength).toBe(8);
  });
});
