import { Context } from "hono";
import { getCompanySettings } from "../kv/company-settings-cache";
import { BadRequestError } from "../http/http-error";
import { OtpRepository } from "./otp-repository";
import { generateOtpCode } from "./generate-otp-code";
import {
  OTP_REQUEST_RATE_LIMIT_WINDOW_MINUTES,
  MAX_OTP_REQUESTS_PER_WINDOW,
  readDownloadOtpSettings,
} from "./download-otp-settings";
import { enqueueNotification, sendNotificationNow } from "../notifications/enqueue-notification";

/**
 * REQ-007: 帳票ダウンロードの確認コード(OTP)。受け取った人にメールアドレスを入力させるのをやめ、入荷指示書と同じく
 * 「コードを発行」を押すと、その帳票の登録済みの宛先の全員に同じコードを送る。
 * コードの照合・回数制限は、メールアドレスではなく帳票(documentType・documentId・attachmentId)の単位で行う
 * (receipt-instruction-download.service.ts と同じ考え方)。応答に宛先のアドレスは含めない。
 */
interface DocumentOtpTarget {
  documentType: string;
  documentId: string;
  attachmentId: string;
}

// 登録済みの宛先(連絡先のメールアドレス)を、重複を除いた小文字の一覧にする。1件も無ければ送れないため 400
export function toRecipientEmails(contacts: Array<{ email?: string | null }>): string[] {
  const emails = Array.from(
    new Set(contacts.map((ct) => ct.email?.trim().toLowerCase()).filter((email): email is string => !!email)),
  );
  if (emails.length === 0) {
    throw new BadRequestError(
      "この帳票の送付先として登録されたメールアドレスがありません。送付元の担当者へお問い合わせください。",
    );
  }
  return emails;
}

export async function sendDocumentOtpToRecipients(
  c: Context,
  target: DocumentOtpTarget & { emails: string[]; category: string; label: string },
) {
  const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
  const otpRepo = new OtpRepository(c.env.DB_OTP);
  const now = new Date();
  const windowStart = new Date(now.getTime() - OTP_REQUEST_RATE_LIMIT_WINDOW_MINUTES * 60_000);
  const recentCount = await otpRepo.countRecentChallengesAny(
    target.documentType,
    target.documentId,
    target.attachmentId,
    windowStart,
  );

  // 悪用防止: 短時間の連続の発行はメールを送らない(超えたことは返さず、常に同じ文言を返す)
  if (recentCount < MAX_OTP_REQUESTS_PER_WINDOW) {
    const { digitCount, expiryMinutes } = readDownloadOtpSettings(systemConfig);
    const otpCode = generateOtpCode(digitCount);
    const expiresAt = new Date(now.getTime() + expiryMinutes * 60_000);
    for (const email of target.emails) {
      await otpRepo.insertChallenge({
        id: crypto.randomUUID(),
        documentType: target.documentType,
        documentId: target.documentId,
        attachmentId: target.attachmentId,
        email,
        otpCode,
        expiresAt,
        createdAt: now,
      });
      const notificationId = await enqueueNotification({
        dbLog: c.env.DB_LOG,
        category: target.category,
        documentId: target.documentId,
        recipientTo: email,
        subject: `【${target.label}ダウンロード】確認コードのご案内`,
        body: [
          `${target.label}ダウンロードの確認コードは以下の通りです。`,
          "",
          otpCode,
          "",
          `このコードは発行から${expiryMinutes}分間有効です。`,
          "心当たりのない場合は、このメールを破棄してください。",
        ].join("\n"),
      });
      // PERF-08: 確認コードのメールは、定期処理(1分ごと)を待たずにすぐ送る
      sendNotificationNow(c, notificationId);
    }
  }

  return {
    success: true,
    message: "登録されているメールアドレスに確認コードを送信しました。メールをご確認ください。",
  };
}

// 確認コードを照合する。合わなければ BadRequestError(残りの回数つき)。合えば使用済みにする
export async function verifyDocumentOtp(c: Context, target: DocumentOtpTarget & { otp: string }) {
  const otpRepo = new OtpRepository(c.env.DB_OTP);
  const now = new Date();
  const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
  const maxAttempts = readDownloadOtpSettings(systemConfig).maxAttempts;

  const challenge = await otpRepo.findLatestActiveChallengeAny(
    target.documentType,
    target.documentId,
    target.attachmentId,
    now,
  );
  if (!challenge) {
    throw new BadRequestError("確認コードが無効か期限切れです。お手数ですが再度コード送信をお試しください。");
  }
  if (challenge.attemptCount >= maxAttempts) {
    throw new BadRequestError("試行回数の上限に達しました。お手数ですが再度コード送信をお試しください。");
  }
  if (challenge.otpCode !== target.otp.trim()) {
    await otpRepo.incrementAttempt(challenge.id, challenge.attemptCount + 1);
    const remaining = maxAttempts - challenge.attemptCount - 1;
    throw new BadRequestError(`確認コードが正しくありません。(残り試行可能回数: ${remaining}回)`);
  }
  await otpRepo.markVerified(challenge.id, now);
}
