// TSK-003: 帳票ダウンロード(見積・注文請書・納品書・発注書・検収書・入荷指示書・出荷指示書・売上関連書類・請求書)の
// OTP の設定の読み取りとレート制限の値。以前は各帳票の *-download.service.ts に同じ処理を持っていた(動きは変えていない)。
// ログインの OTP は別の設定(login_otp_*。platform/auth/login-otp.ts)

// Item4-c: OTP発行連打による悪用(実在の取引先メールアドレスへのメール爆撃等)を防ぐための
// レート制限。桁数・有効期限・試行回数とは異なりユーザー向けの設定項目ではないため固定値とする。
export const OTP_REQUEST_RATE_LIMIT_WINDOW_MINUTES = 60;
export const MAX_OTP_REQUESTS_PER_WINDOW = 5;

export interface DownloadOtpSettings {
  digitCount: number;
  expiryMinutes: number;
  maxAttempts: number;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** 会社設定の otp_digit_count・otp_expiry_minutes・otp_max_attempts。未設定・不正な値は既定値(4桁・10分・5回) */
export function readDownloadOtpSettings(config: object | null | undefined): DownloadOtpSettings {
  const values = (config ?? {}) as Record<string, unknown>;
  return {
    digitCount: toPositiveInt(values.otp_digit_count, 4),
    expiryMinutes: toPositiveInt(values.otp_expiry_minutes, 10),
    maxAttempts: toPositiveInt(values.otp_max_attempts, 5),
  };
}
