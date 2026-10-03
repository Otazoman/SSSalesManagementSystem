import { describe, it, expect } from "vitest";
import {
  DEFAULT_PASSWORD_POLICY,
  describePasswordPolicy,
  findPasswordPolicyViolation,
  generateInitialPassword,
  toPasswordPolicy,
  type PasswordPolicy,
} from "./password-policy";

const strict: PasswordPolicy = {
  minLength: 10,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSymbol: true,
};

describe("toPasswordPolicy(BUG-046)", () => {
  it("未設定の場合は初期値(8文字以上・文字の種類の指定なし)", () => {
    expect(toPasswordPolicy(null)).toEqual(DEFAULT_PASSWORD_POLICY);
    expect(toPasswordPolicy({})).toEqual(DEFAULT_PASSWORD_POLICY);
  });

  it("会社設定の値(文字列・Boolean)から作る", () => {
    expect(
      toPasswordPolicy({
        password_min_length: "12",
        password_require_uppercase: true,
        password_require_lowercase: "true",
        password_require_digit: false,
        password_require_symbol: "false",
      }),
    ).toEqual({ minLength: 12, requireUppercase: true, requireLowercase: true, requireDigit: false, requireSymbol: false });
  });

  it("文字数が範囲外・不正な場合は初期値の8文字", () => {
    expect(toPasswordPolicy({ password_min_length: "4" }).minLength).toBe(8);
    expect(toPasswordPolicy({ password_min_length: "65" }).minLength).toBe(8);
    expect(toPasswordPolicy({ password_min_length: "abc" }).minLength).toBe(8);
  });
});

describe("findPasswordPolicyViolation(BUG-046)", () => {
  it("初期値では8文字以上なら良い", () => {
    expect(findPasswordPolicyViolation("abcdefgh", DEFAULT_PASSWORD_POLICY)).toBeNull();
    expect(findPasswordPolicyViolation("abcdefg", DEFAULT_PASSWORD_POLICY)).toBe("パスワードは8文字以上にしてください");
  });

  it("文字の種類の指定がある場合は、全てを含む必要がある", () => {
    expect(findPasswordPolicyViolation("Abcdefg12!", strict)).toBeNull();
    const message = "パスワードは10文字以上で、英大文字・英小文字・数字・記号を含めてください";
    expect(findPasswordPolicyViolation("abcdefg12!", strict)).toBe(message);
    expect(findPasswordPolicyViolation("ABCDEFG12!", strict)).toBe(message);
    expect(findPasswordPolicyViolation("Abcdefghi!", strict)).toBe(message);
    expect(findPasswordPolicyViolation("Abcdefgh12", strict)).toBe(message);
    expect(findPasswordPolicyViolation("Abcdef12!", strict)).toBe(message);
  });

  it("全角の文字は記号として数えない", () => {
    expect(findPasswordPolicyViolation("Abcdefgh12！", strict)).not.toBeNull();
    expect(findPasswordPolicyViolation("Abcdefgh12!", strict)).toBeNull();
  });
});

describe("describePasswordPolicy(BUG-046)", () => {
  it("指定した文字の種類だけを並べる", () => {
    expect(describePasswordPolicy({ ...DEFAULT_PASSWORD_POLICY, minLength: 12, requireDigit: true })).toBe(
      "12文字以上で、数字を含めてください",
    );
  });
});

describe("generateInitialPassword(BUG-046)", () => {
  it("初期値のルールでも12文字で、英大文字・英小文字・数字を含む", () => {
    for (let i = 0; i < 50; i++) {
      const password = generateInitialPassword(DEFAULT_PASSWORD_POLICY);
      expect(password).toHaveLength(12);
      expect(findPasswordPolicyViolation(password, { ...strict, minLength: 12, requireSymbol: false })).toBeNull();
      expect(password).not.toMatch(/[0O1lI]/);
    }
  });

  it("会社設定のルール(文字数・記号)を満たす", () => {
    const policy = { ...strict, minLength: 20 };
    for (let i = 0; i < 50; i++) {
      const password = generateInitialPassword(policy);
      expect(password).toHaveLength(20);
      expect(findPasswordPolicyViolation(password, policy)).toBeNull();
    }
  });

  it("毎回違うパスワードを作る", () => {
    const passwords = new Set(Array.from({ length: 20 }, () => generateInitialPassword(DEFAULT_PASSWORD_POLICY)));
    expect(passwords.size).toBe(20);
  });
});
