import { Context } from "hono";
import { SalesInvoiceRepository } from "./sales-invoice.repository";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { OtpRepository } from "../../../platform/otp/otp-repository";
import { generateOtpCode } from "../../../platform/otp/generate-otp-code";
import {
  OTP_REQUEST_RATE_LIMIT_WINDOW_MINUTES,
  MAX_OTP_REQUESTS_PER_WINDOW,
  readDownloadOtpSettings,
} from "../../../platform/otp/download-otp-settings";
import { enqueueNotification, sendNotificationNow } from "../../../platform/notifications/enqueue-notification";

// K-4-1: quote-download.service.tsと同じ方針(OTPダウンロード用documentTypeは
// "sales_invoice"で新規、既存の納品書メール機能が使うmail_template_settingsのid
// "sales_invoice"とは別名前空間のため衝突しない)

export class SalesInvoiceDownloadService {
  private repo: SalesInvoiceRepository;

  constructor(repo: SalesInvoiceRepository) {
    this.repo = repo;
  }

  async getDownloadStream(id: string, attachmentId: string) {
    const attachment = await this.repo.findAttachmentByIdAndInvoiceId(attachmentId, id);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }
    return { attachment };
  }

  // K-4-1: OTPダウンロード用リクエスト(外部公開ルートから呼ばれる。quote-download.service.tsと同型)
  async requestDownloadOtp(
    c: Context,
    invoiceId: string,
    attachmentId: string,
    email: string,
  ) {
    const invoice = await this.repo.findInvoiceById(invoiceId);
    if (!invoice) throw new NotFoundError("指定された売上データが見つかりません");

    const attachment = await this.repo.findAttachmentByIdAndInvoiceId(attachmentId, invoiceId);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }

    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const restrictToContacts = systemConfig.is_otp_download_restricted_to_contacts !== false;

    let shouldSend = true;
    if (restrictToContacts) {
      const contacts = await this.repo.findActiveContactsByPartnerId(invoice.partnerId, invoice.documentType);
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
        "sales_invoice",
        invoiceId,
        attachmentId,
        normalizedEmail,
        windowStart,
      );

      if (recentCount < MAX_OTP_REQUESTS_PER_WINDOW) {
        const otpDigitCount = readDownloadOtpSettings(systemConfig).digitCount;
        const otpExpiryMinutes = readDownloadOtpSettings(systemConfig).expiryMinutes;
        const otpCode = generateOtpCode(otpDigitCount);
        const expiresAt = new Date(now.getTime() + otpExpiryMinutes * 60_000);

        await otpRepo.insertChallenge({
          id: crypto.randomUUID(),
          documentType: "sales_invoice",
          documentId: invoiceId,
          attachmentId,
          email: normalizedEmail,
          otpCode,
          expiresAt,
          createdAt: now,
        });

        const notificationId = await enqueueNotification({
          dbLog: c.env.DB_LOG,
          category: "sales_invoice_download_otp",
          documentId: invoiceId,
          recipientTo: email,
          subject: "【売上関連書類ダウンロード】確認コードのご案内",
          body: [
            "書類ダウンロードの確認コードは以下の通りです。",
            "",
            otpCode,
            "",
            `このコードは発行から${otpExpiryMinutes}分間有効です。`,
            "心当たりのない場合は、このメールを破棄してください。",
          ].join("\n"),
        });
        // PERF-08: 確認コードのメールは、定期処理(1分ごと)を待たずにすぐ送る
        sendNotificationNow(c, notificationId);
      }
    }

    return {
      success: true,
      message:
        "入力されたメールアドレスが有効な場合、確認コードを送信しました。メールをご確認ください。",
    };
  }

  async verifyDownloadOtp(
    c: Context,
    invoiceId: string,
    attachmentId: string,
    email: string,
    otp: string,
  ) {
    const otpRepo = new OtpRepository(c.env.DB_OTP);
    const now = new Date();
    const normalizedEmail = email.trim().toLowerCase();
    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const maxAttempts = readDownloadOtpSettings(systemConfig).maxAttempts;

    const challenge = await otpRepo.findLatestActiveChallenge(
      "sales_invoice",
      invoiceId,
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

    const attachment = await this.repo.findAttachmentByIdAndInvoiceId(attachmentId, invoiceId);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }

    return { attachment };
  }
}
