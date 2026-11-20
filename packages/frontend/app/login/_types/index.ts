export interface UserData {
  id: string;
  name: string;
  role: string;
  departmentName?: string;
  companyName?: string;
  mustChangePassword?: boolean;
}

export interface LoginResponse {
  // OTP を使うユーザーは、パスワードの確認の時点では user を返さず、otpRequired を返す(REQ-004)
  user?: UserData;
  message?: string;
  otpRequired?: boolean;
  challengeId?: string;
  channel?: "email" | "slack";
  digitCount?: number;
  expiresInMinutes?: number;
  resendIntervalSeconds?: number;
  // OTP の確認・再送で、ログインからやり直す必要がある場合(期限切れ・回数の上限など)
  restart?: boolean;
  retryAfterSeconds?: number;
}

// REQ-004: OTP の入力を待っている状態
export interface OtpChallenge {
  challengeId: string;
  channel: "email" | "slack";
  digitCount: number;
  expiresInMinutes: number;
  resendIntervalSeconds: number;
}
