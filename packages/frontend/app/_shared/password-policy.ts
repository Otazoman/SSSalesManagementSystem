// BUG-046: 会社設定のパスワードのルールの説明。Backend(platform/auth/password-policy.ts)と同じ内容。
// 確かめるのは Backend で、画面ではパスワードを入力する前に説明を表示するだけに使う
export type PasswordPolicy = {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
};

const isTrue = (value: unknown) => value === true || value === "true";

export function toPasswordPolicy(settings: Record<string, unknown> | null | undefined): PasswordPolicy {
  const minLength = Number(settings?.password_min_length);
  return {
    minLength: Number.isInteger(minLength) && minLength >= 8 && minLength <= 64 ? minLength : 8,
    requireUppercase: isTrue(settings?.password_require_uppercase),
    requireLowercase: isTrue(settings?.password_require_lowercase),
    requireDigit: isTrue(settings?.password_require_digit),
    requireSymbol: isTrue(settings?.password_require_symbol),
  };
}

// 例: 「12文字以上で、英大文字・数字を含めてください」
export function describePasswordPolicy(policy: PasswordPolicy): string {
  const kinds = [
    policy.requireUppercase && "英大文字",
    policy.requireLowercase && "英小文字",
    policy.requireDigit && "数字",
    policy.requireSymbol && "記号",
  ].filter((kind): kind is string => !!kind);
  return kinds.length > 0
    ? `${policy.minLength}文字以上で、${kinds.join("・")}を含めてください`
    : `${policy.minLength}文字以上にしてください`;
}
