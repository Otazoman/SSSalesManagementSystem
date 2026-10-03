import { Context } from "hono";
import { BillingRepository } from "./billing.repository";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { OtpRepository } from "../../../platform/otp/otp-repository";
import { generateOtpCode } from "../../../platform/otp/generate-otp-code";
import { enqueueNotification } from "../../../platform/notifications/enqueue-notification";

// 追加要望: sales-invoice-download.service.tsと同じ方針(外部の取引先がメールのリンクから
// 直接アクセスするOTPダウンロード)。請求(billing_headers)はsales_invoicesと異なり
// 添付ファイルテーブルを持たず、PDFは1件につき常に1本(invoicePdfR2Path)のため、
// attachmentIdは持たずbillingHeaderIdのみで完結させる(OtpRepositoryのattachmentId列には
// 固定文字列"invoice"を渡す。将来CSV等の形式を追加する場合はこの値を分ければ流用できる)
const OTP_DOCUMENT_TYPE = "billing_invoice";
const OTP_ATTACHMENT_ID = "invoice";
const OTP_REQUEST_RATE_LIMIT_WINDOW_MINUTES = 60;
const MAX_OTP_REQUESTS_PER_WINDOW = 5;

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class BillingDownloadService {
  private repo: BillingRepository;

  constructor(repo: BillingRepository) {
    this.repo = repo;
  }

  async requestDownloadOtp(c: Context, billingHeaderId: string, email: string) {
    const header = await this.repo.findHeaderById(billingHeaderId);
    if (!header) throw new NotFoundError("指定された請求データが見つかりません");
    if (!header.invoicePdfR2Path) {
      throw new NotFoundError("請求書PDFが未発行です");
    }

    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const restrictToContacts = systemConfig.is_otp_download_restricted_to_contacts !== false;

    let shouldSend = true;
    if (restrictToContacts) {
      const contacts = await this.repo.findActiveContactsByPartnerId(header.partnerId);
      shouldSend = contacts.some(
        (contact) => contact.email?.trim().toLowerCase() === email.trim().toLowerCase(),
      );
    }

    if (shouldSend) {
      const otpRepo = new OtpRepository(c.env.DB_OTP);
      const now = new Date();
      const normalizedEmail = email.trim().toLowerCase();

      const windowStart = new Date(
        now.getTime() - OTP_REQUEST_RATE_LIMIT_WINDOW_MINUTES * 60_000,
      );
      const recentCount = await otpRepo.countRecentChallenges(
        OTP_DOCUMENT_TYPE,
        billingHeaderId,
        OTP_ATTACHMENT_ID,
        normalizedEmail,
        windowStart,
      );

      if (recentCount < MAX_OTP_REQUESTS_PER_WINDOW) {
        const otpDigitCount = toPositiveInt(systemConfig.otp_digit_count, 4);
        const otpExpiryMinutes = toPositiveInt(systemConfig.otp_expiry_minutes, 10);
        const otpCode = generateOtpCode(otpDigitCount);
        const expiresAt = new Date(now.getTime() + otpExpiryMinutes * 60_000);

        await otpRepo.insertChallenge({
          id: crypto.randomUUID(),
          documentType: OTP_DOCUMENT_TYPE,
          documentId: billingHeaderId,
          attachmentId: OTP_ATTACHMENT_ID,
          email: normalizedEmail,
          otpCode,
          expiresAt,
          createdAt: now,
        });

        await enqueueNotification({
          dbLog: c.env.DB_LOG,
          category: "billing_download_otp",
          documentId: billingHeaderId,
          recipientTo: email,
          subject: "【請求書ダウンロード】確認コードのご案内",
          body: [
            "請求書ダウンロードの確認コードは以下の通りです。",
            "",
            otpCode,
            "",
            `このコードは発行から${otpExpiryMinutes}分間有効です。`,
            "心当たりのない場合は、このメールを破棄してください。",
          ].join("\n"),
        });
      }
    }

    return {
      success: true,
      message:
        "入力されたメールアドレスが有効な場合、確認コードを送信しました。メールをご確認ください。",
    };
  }

  async verifyDownloadOtp(c: Context, billingHeaderId: string, email: string, otp: string) {
    const otpRepo = new OtpRepository(c.env.DB_OTP);
    const now = new Date();
    const normalizedEmail = email.trim().toLowerCase();
    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const maxAttempts = toPositiveInt(systemConfig.otp_max_attempts, 5);

    const challenge = await otpRepo.findLatestActiveChallenge(
      OTP_DOCUMENT_TYPE,
      billingHeaderId,
      OTP_ATTACHMENT_ID,
      normalizedEmail,
      now,
    );
    if (!challenge) {
      throw new BadRequestError(
        "確認コードが無効か期限切れです。お手数ですが再度メールアドレスをご入力ください。",
      );
    }

    if (challenge.attemptCount >= maxAttempts) {
      throw new BadRequestError(
        "試行回数の上限に達しました。お手数ですが再度メールアドレスをご入力ください。",
      );
    }

    if (challenge.otpCode !== otp.trim()) {
      await otpRepo.incrementAttempt(challenge.id, challenge.attemptCount + 1);
      const remaining = maxAttempts - challenge.attemptCount - 1;
      throw new BadRequestError(
        `確認コードが正しくありません。(残り試行可能回数: ${remaining}回)`,
      );
    }

    await otpRepo.markVerified(challenge.id, now);

    const header = await this.repo.findHeaderById(billingHeaderId);
    if (!header || !header.invoicePdfR2Path) {
      throw new NotFoundError("請求書PDFが未発行です");
    }

    return { header };
  }
}
