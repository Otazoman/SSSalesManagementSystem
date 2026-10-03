// Item4-c: 見積書OTPダウンロード用の数字コード生成(crypto.getRandomValuesによる暗号学的乱数)。
// 桁数は会社設定(otp_digit_count)から可変で渡される(既定4桁)。
const DEFAULT_OTP_DIGITS = 4;

export function generateOtpCode(digitCount: number = DEFAULT_OTP_DIGITS): string {
  const digits = Number.isFinite(digitCount) && digitCount > 0 ? digitCount : DEFAULT_OTP_DIGITS;
  const max = 10 ** digits;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const code = buf[0] % max;
  return String(code).padStart(digits, "0");
}
