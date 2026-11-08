import { describe, it, expect } from "vitest";
import { readDownloadOtpSettings } from "./download-otp-settings";

// TSK-003: 帳票ダウンロードの OTP の設定の読み取り(各帳票で持っていた処理と同じ結果になること)
describe("readDownloadOtpSettings", () => {
  it("会社設定の値(文字列・数値)を整数にする", () => {
    expect(readDownloadOtpSettings({ otp_digit_count: "6", otp_expiry_minutes: 15, otp_max_attempts: "3" })).toEqual({
      digitCount: 6,
      expiryMinutes: 15,
      maxAttempts: 3,
    });
  });

  it("未設定・0以下・数字でない値は既定値(4桁・10分・5回)にする", () => {
    expect(readDownloadOtpSettings(null)).toEqual({ digitCount: 4, expiryMinutes: 10, maxAttempts: 5 });
    expect(readDownloadOtpSettings({ otp_digit_count: "0", otp_expiry_minutes: "abc", otp_max_attempts: -1 })).toEqual({
      digitCount: 4,
      expiryMinutes: 10,
      maxAttempts: 5,
    });
  });
});
