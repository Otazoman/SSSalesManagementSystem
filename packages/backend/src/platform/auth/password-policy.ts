import { getCompanySettings } from "../kv/company-settings-cache";

// BUG-046: パスワードのルール(会社設定)。本人が設定する時(パスワードの変更・忘れた時の再設定)に確かめる。
// 管理者がユーザー管理で設定する時(登録・更新・CSV 取込)は確かめない。
// 自動で作る初期パスワードは、このルールを満たすように暗号用の乱数で作る。
export type PasswordPolicy = {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
};

export const PASSWORD_MIN_LENGTH_LOWER_BOUND = 8;
export const PASSWORD_MIN_LENGTH_UPPER_BOUND = 64;

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: PASSWORD_MIN_LENGTH_LOWER_BOUND,
  requireUppercase: false,
  requireLowercase: false,
  requireDigit: false,
  requireSymbol: false,
};

const UPPERCASE = /[A-Z]/;
const LOWERCASE = /[a-z]/;
const DIGIT = /[0-9]/;
// 記号は、英数字以外の半角の文字(空白を除く)
const SYMBOL = /[!-/:-@[-`{-~]/;

const isTrue = (value: unknown) => value === true || value === "true";

// 会社設定の値からルールを作る。未設定・不正な値は初期値(8文字以上・文字の種類の指定なし)
export function toPasswordPolicy(settings: Record<string, unknown> | null | undefined): PasswordPolicy {
  const minLength = Number(settings?.password_min_length);
  return {
    minLength:
      Number.isInteger(minLength) &&
      minLength >= PASSWORD_MIN_LENGTH_LOWER_BOUND &&
      minLength <= PASSWORD_MIN_LENGTH_UPPER_BOUND
        ? minLength
        : DEFAULT_PASSWORD_POLICY.minLength,
    requireUppercase: isTrue(settings?.password_require_uppercase),
    requireLowercase: isTrue(settings?.password_require_lowercase),
    requireDigit: isTrue(settings?.password_require_digit),
    requireSymbol: isTrue(settings?.password_require_symbol),
  };
}

export async function getPasswordPolicy(kv: KVNamespace): Promise<PasswordPolicy> {
  return toPasswordPolicy(await getCompanySettings(kv));
}

function requiredKinds(policy: PasswordPolicy): string[] {
  return [
    policy.requireUppercase && "英大文字",
    policy.requireLowercase && "英小文字",
    policy.requireDigit && "数字",
    policy.requireSymbol && "記号",
  ].filter((kind): kind is string => !!kind);
}

// 例: 「12文字以上で、英大文字・数字を含めてください」
export function describePasswordPolicy(policy: PasswordPolicy): string {
  const kinds = requiredKinds(policy);
  return kinds.length > 0
    ? `${policy.minLength}文字以上で、${kinds.join("・")}を含めてください`
    : `${policy.minLength}文字以上にしてください`;
}

// ルールを満たさない場合は、ルールの説明を含むエラーの文を返す。満たす場合は null
export function findPasswordPolicyViolation(password: string, policy: PasswordPolicy): string | null {
  const satisfied =
    [...password].length >= policy.minLength &&
    (!policy.requireUppercase || UPPERCASE.test(password)) &&
    (!policy.requireLowercase || LOWERCASE.test(password)) &&
    (!policy.requireDigit || DIGIT.test(password)) &&
    (!policy.requireSymbol || SYMBOL.test(password));
  return satisfied ? null : `パスワードは${describePasswordPolicy(policy)}`;
}

// 見間違えやすい文字(0・O・o・1・l・I)は使わない(メールで知らせて、手で入力するため)
const GENERATED_UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const GENERATED_LOWERCASE = "abcdefghijkmnpqrstuvwxyz";
const GENERATED_DIGITS = "23456789";
const GENERATED_SYMBOLS = "!#$%&*+-=?@_";
const GENERATED_MIN_LENGTH = 12;

// 0 以上 max 未満の整数(暗号用の乱数。偏りが出ないよう、端数の範囲の値は引き直す)
function randomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) return buffer[0] % max;
  }
}

const pick = (chars: string) => chars[randomInt(chars.length)];

export function generateInitialPassword(policy: PasswordPolicy): string {
  const length = Math.max(policy.minLength, GENERATED_MIN_LENGTH);
  // 英大文字・英小文字・数字は、指定が無くても必ず1文字以上入れる。記号は指定がある時だけ使う
  const groups = [GENERATED_UPPERCASE, GENERATED_LOWERCASE, GENERATED_DIGITS];
  if (policy.requireSymbol) groups.push(GENERATED_SYMBOLS);
  const all = groups.join("");

  const chars = groups.map(pick);
  while (chars.length < length) chars.push(pick(all));
  // 必ず入れた文字が先頭に固まらないよう、並べ替える
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
