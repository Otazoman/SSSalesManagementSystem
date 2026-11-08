// REQ-004: ログイン時の OTP の共通処理(設定の読み取り・コードのハッシュ・送信)。
// コードの生成は帳票ダウンロードの OTP と同じ generateOtpCode を使う。設定は帳票ダウンロード用(otp_*)とは別の login_otp_*
import { drizzle } from "drizzle-orm/d1";
import * as auditSchema from "../../db/audit-schema";
import { sendEmail } from "../../utils/mailer";
import { sendSlackDirectMessage } from "../../utils/slack";

export interface LoginOtpSettings {
  digitCount: number;
  expiryMinutes: number;
  maxAttempts: number;
  resendIntervalSeconds: number;
}

// 会社設定の値(文字列)を、範囲内の整数にする。未設定・範囲外は既定値
function readInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(String(value ?? "").trim());
  return Number.isInteger(parsed) && parsed >= min && parsed <= max && String(value ?? "").trim() !== ""
    ? parsed
    : fallback;
}

export function readLoginOtpSettings(config: Record<string, unknown>): LoginOtpSettings {
  return {
    digitCount: readInt(config.login_otp_digit_count, 6, 4, 8),
    expiryMinutes: readInt(config.login_otp_expiry_minutes, 10, 1, 60),
    maxAttempts: readInt(config.login_otp_max_attempts, 5, 1, 10),
    resendIntervalSeconds: readInt(config.login_otp_resend_interval_seconds, 60, 0, 3600),
  };
}

// コードは平文で保存しない。チャレンジのIDと合わせた SHA-256 にする(同じコードでもチャレンジごとに値が変わる)
export async function hashLoginOtpCode(challengeId: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${challengeId}:${code.trim()}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 文字列の比較にかかる時間から、一致した位置を推測されないようにする
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** メールで OTP を送れる状態か(ユーザーのメールアドレスと、会社設定の SMTP のユーザー名・パスワードがある) */
export function canSendLoginOtpByEmail(config: Record<string, unknown>, email: string | null | undefined): boolean {
  return Boolean(
    String(email ?? "").trim() && String(config.smtp_user ?? "").trim() && String(config.smtp_pass ?? "").trim(),
  );
}

export class LoginOtpDeliveryError extends Error {}

interface DeliverOptions {
  env: { DB_LOG: D1Database };
  config: Record<string, unknown>;
  user: { id: string; email: string; slackUserId: string | null; notificationChannel: string | null };
  code: string;
  expiryMinutes: number;
}

/**
 * OTP を送る。通知方法が Slack で、Slack のメンバーIDと Bot トークンがあれば Slack に送る。
 * Slack が使えない・送れなかった場合は、メールに切り替える。メールでも送れない場合は LoginOtpDeliveryError。
 * ログインを待たせないため、通知の送信キューを通さずにその場で送り、結果をメール送信ログに残す
 * (ログの本文はコードを伏せる)。送った方法(email / slack)を返す
 */
export async function deliverLoginOtp({ env, config, user, code, expiryMinutes }: DeliverOptions): Promise<"email" | "slack"> {
  const subject = "【ログイン】確認コードのご案内";
  const bodyLines = (shownCode: string) => [
    "ログインの確認コードは以下のとおりです。",
    "",
    shownCode,
    "",
    `このコードは発行から${expiryMinutes}分間有効です。`,
    "心当たりのない場合は、このメッセージを破棄し、管理者に連絡してください。",
  ];
  const maskedBody = bodyLines("(確認コードはログに残しません)").join("\n");
  const botToken = String(config.slack_bot_token ?? "").trim();
  const slackUserId = (user.slackUserId ?? "").trim();

  if (user.notificationChannel === "slack" && slackUserId && botToken) {
    try {
      await sendSlackDirectMessage(botToken, slackUserId, `${subject}\n${bodyLines(code).join("\n")}`);
      await writeDeliveryLog(env, { type: "slack", user, recipientTo: slackUserId, subject, body: maskedBody, error: null });
      return "slack";
    } catch (err) {
      // Slack に送れなかった場合はメールに切り替える(失敗はログに残す)
      await writeDeliveryLog(env, {
        type: "slack",
        user,
        recipientTo: slackUserId,
        subject,
        body: maskedBody,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!canSendLoginOtpByEmail(config, user.email)) {
    throw new LoginOtpDeliveryError("確認コードを送る方法がありません(メールの送信が設定されていません)。管理者に連絡してください");
  }
  try {
    await sendEmail({
      smtpHost: String(config.smtp_host ?? ""),
      smtpPort: String(config.smtp_port ?? ""),
      smtpUser: String(config.smtp_user ?? ""),
      smtpPass: String(config.smtp_pass ?? ""),
      smtpFrom: String(config.smtp_from ?? ""),
      to: user.email,
      subject,
      text: bodyLines(code).join("\n"),
    });
    await writeDeliveryLog(env, { type: "email", user, recipientTo: user.email, subject, body: maskedBody, error: null });
    return "email";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeDeliveryLog(env, { type: "email", user, recipientTo: user.email, subject, body: maskedBody, error: message });
    throw new LoginOtpDeliveryError("確認コードを送れませんでした。しばらくしてからもう一度お試しください");
  }
}

async function writeDeliveryLog(
  env: { DB_LOG: D1Database },
  entry: {
    type: "email" | "slack";
    user: { id: string };
    recipientTo: string;
    subject: string;
    body: string;
    error: string | null;
  },
) {
  try {
    await drizzle(env.DB_LOG, { schema: auditSchema }).insert(auditSchema.mailDeliveryLogs).values({
      id: crypto.randomUUID(),
      type: entry.type,
      category: "login_otp",
      documentId: entry.user.id,
      recipientTo: entry.recipientTo,
      subject: entry.subject,
      body: entry.body,
      status: entry.error ? "FAILED" : "SUCCESS",
      errorMessage: entry.error,
      retryCount: 0,
      performedById: entry.user.id,
      performedAt: new Date(),
    });
  } catch (err) {
    // ログの書き込みの失敗で、ログインを止めない
    console.error("[LoginOtpDeliveryLogError]", err);
  }
}
