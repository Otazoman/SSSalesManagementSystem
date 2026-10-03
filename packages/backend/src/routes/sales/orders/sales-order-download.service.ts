import { Context } from "hono";
import { SalesOrderRepository } from "./sales-order.repository";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { OtpRepository } from "../../../platform/otp/otp-repository";
import { generateOtpCode } from "../../../platform/otp/generate-otp-code";
import { enqueueNotification } from "../../../platform/notifications/enqueue-notification";

// Item7: quote-download.service.tsと同じ方針(OTP発行連打による悪用防止のレート制限含む)
const OTP_REQUEST_RATE_LIMIT_WINDOW_MINUTES = 60;
const MAX_OTP_REQUESTS_PER_WINDOW = 5;

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class SalesOrderDownloadService {
  private repo: SalesOrderRepository;

  constructor(repo: SalesOrderRepository) {
    this.repo = repo;
  }

  async getDownloadStream(id: string, attachmentId: string) {
    const attachment = await this.repo.findAttachmentByIdAndOrderId(attachmentId, id);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }
    return { attachment };
  }

  async requestDownloadOtp(c: Context, orderId: string, attachmentId: string, email: string) {
    const order = await this.repo.findOrderById(orderId);
    if (!order) throw new NotFoundError("指定された受注が見つかりません");

    const attachment = await this.repo.findAttachmentByIdAndOrderId(attachmentId, orderId);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }

    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const restrictToContacts = systemConfig.is_otp_download_restricted_to_contacts !== false;

    let shouldSend = true;
    if (restrictToContacts) {
      const contacts = await this.repo.findActiveContactsByPartnerId(order.partnerId);
      shouldSend = contacts.some(
        (contact) => contact.email?.trim().toLowerCase() === email.trim().toLowerCase(),
      );
    }

    if (shouldSend) {
      const otpRepo = new OtpRepository(c.env.DB_OTP);
      const now = new Date();
      const normalizedEmail = email.trim().toLowerCase();

      const windowStart = new Date(now.getTime() - OTP_REQUEST_RATE_LIMIT_WINDOW_MINUTES * 60_000);
      const recentCount = await otpRepo.countRecentChallenges(
        "sales_order",
        orderId,
        attachmentId,
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
          documentType: "sales_order",
          documentId: orderId,
          attachmentId,
          email: normalizedEmail,
          otpCode,
          expiresAt,
          createdAt: now,
        });

        await enqueueNotification({
          dbLog: c.env.DB_LOG,
          category: "sales_order_download_otp",
          documentId: orderId,
          recipientTo: email,
          subject: "【注文請書ダウンロード】確認コードのご案内",
          body: [
            "注文請書ダウンロードの確認コードは以下の通りです。",
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
      message: "入力されたメールアドレスが有効な場合、確認コードを送信しました。メールをご確認ください。",
    };
  }

  async verifyDownloadOtp(c: Context, orderId: string, attachmentId: string, email: string, otp: string) {
    const otpRepo = new OtpRepository(c.env.DB_OTP);
    const now = new Date();
    const normalizedEmail = email.trim().toLowerCase();
    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const maxAttempts = toPositiveInt(systemConfig.otp_max_attempts, 5);

    const challenge = await otpRepo.findLatestActiveChallenge(
      "sales_order",
      orderId,
      attachmentId,
      normalizedEmail,
      now,
    );
    if (!challenge) {
      throw new BadRequestError(
        "確認コードが無効か期限切れです。お手数ですが再度メールアドレスをご入力ください。",
      );
    }

    if (challenge.attemptCount >= maxAttempts) {
      throw new BadRequestError("試行回数の上限に達しました。お手数ですが再度メールアドレスをご入力ください。");
    }

    if (challenge.otpCode !== otp.trim()) {
      await otpRepo.incrementAttempt(challenge.id, challenge.attemptCount + 1);
      const remaining = maxAttempts - challenge.attemptCount - 1;
      throw new BadRequestError(`確認コードが正しくありません。(残り試行可能回数: ${remaining}回)`);
    }

    await otpRepo.markVerified(challenge.id, now);

    const attachment = await this.repo.findAttachmentByIdAndOrderId(attachmentId, orderId);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }

    return { attachment };
  }
}
