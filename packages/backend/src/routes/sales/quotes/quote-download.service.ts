import { Context } from "hono";
import { QuoteRepository } from "./quote.repository";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { OtpRepository } from "../../../platform/otp/otp-repository";
import { generateOtpCode } from "../../../platform/otp/generate-otp-code";
import { enqueueNotification } from "../../../platform/notifications/enqueue-notification";

// Item4-c: OTP発行連打による悪用(実在の取引先メールアドレスへのメール爆撃等)を防ぐための
// レート制限。桁数・有効期限・試行回数とは異なりユーザー向けの設定項目ではないため固定値とする。
const OTP_REQUEST_RATE_LIMIT_WINDOW_MINUTES = 60;
const MAX_OTP_REQUESTS_PER_WINDOW = 5;

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Item4-f: quote.service.tsから分割。添付ファイルダウンロード・OTP付きダウンロードリンクを担当
export class QuoteDownloadService {
  private repo: QuoteRepository;

  constructor(repo: QuoteRepository) {
    this.repo = repo;
  }

  // 9. ファイルダウンロード
  async getDownloadStream(id: string, attachmentId: string) {
    const attachment = await this.repo.findAttachmentByIdAndQuoteId(
      attachmentId,
      id,
    );
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }

    return { attachment };
  }

  // Item4-c: OTPダウンロード用リクエスト(社外の受信者がリンクを開いた際、
  // 入力したメールアドレス宛にOTPコードを送信する。API_KEY非搭載の外部公開ルートから呼ばれる)。
  async requestDownloadOtp(
    c: Context,
    quoteId: string,
    attachmentId: string,
    email: string,
  ) {
    const quote = await this.repo.findQuoteById(quoteId);
    if (!quote) throw new NotFoundError("指定された見積が見つかりません");

    const attachment = await this.repo.findAttachmentByIdAndQuoteId(
      attachmentId,
      quoteId,
    );
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }

    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const restrictToContacts =
      systemConfig.is_otp_download_restricted_to_contacts !== false;

    let shouldSend = true;
    if (restrictToContacts) {
      const contacts = await this.repo.findActiveContactsByPartnerId(
        quote.partnerId,
      );
      shouldSend = contacts.some(
        (contact) =>
          contact.email?.trim().toLowerCase() === email.trim().toLowerCase(),
      );
    }

    if (shouldSend) {
      const otpRepo = new OtpRepository(c.env.DB_OTP);
      const now = new Date();
      const normalizedEmail = email.trim().toLowerCase();

      // 悪用防止: 同一組み合わせへの短時間の連続リクエストはメール送信をスキップする
      // (レート制限を超えたことは呼び出し元へ返さず、常に同じ成功文言を返す)
      const windowStart = new Date(
        now.getTime() - OTP_REQUEST_RATE_LIMIT_WINDOW_MINUTES * 60_000,
      );
      const recentCount = await otpRepo.countRecentChallenges(
        "sales_quote",
        quoteId,
        attachmentId,
        normalizedEmail,
        windowStart,
      );

      if (recentCount < MAX_OTP_REQUESTS_PER_WINDOW) {
        const otpDigitCount = toPositiveInt(systemConfig.otp_digit_count, 4);
        const otpExpiryMinutes = toPositiveInt(
          systemConfig.otp_expiry_minutes,
          10,
        );
        const otpCode = generateOtpCode(otpDigitCount);
        const expiresAt = new Date(now.getTime() + otpExpiryMinutes * 60_000);

        await otpRepo.insertChallenge({
          id: crypto.randomUUID(),
          documentType: "sales_quote",
          documentId: quoteId,
          attachmentId,
          email: normalizedEmail,
          otpCode,
          expiresAt,
          createdAt: now,
        });

        await enqueueNotification({
          dbLog: c.env.DB_LOG,
          category: "quote_download_otp",
          documentId: quoteId,
          recipientTo: email,
          subject: "【見積書ダウンロード】確認コードのご案内",
          body: [
            "見積書ダウンロードの確認コードは以下の通りです。",
            "",
            otpCode,
            "",
            `このコードは発行から${otpExpiryMinutes}分間有効です。`,
            "心当たりのない場合は、このメールを破棄してください。",
          ].join("\n"),
        });
      }
    }

    // セキュリティのため、メールアドレスが登録済みかどうかに関わらず同じ文言を返す(登録有無を外部に漏らさない)
    return {
      success: true,
      message:
        "入力されたメールアドレスが有効な場合、確認コードを送信しました。メールをご確認ください。",
    };
  }

  // Item4-c: OTP検証。成功時のみダウンロード対象の添付ファイル情報を返す。
  async verifyDownloadOtp(
    c: Context,
    quoteId: string,
    attachmentId: string,
    email: string,
    otp: string,
  ) {
    const otpRepo = new OtpRepository(c.env.DB_OTP);
    const now = new Date();
    const normalizedEmail = email.trim().toLowerCase();
    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const maxAttempts = toPositiveInt(systemConfig.otp_max_attempts, 5);

    const challenge = await otpRepo.findLatestActiveChallenge(
      "sales_quote",
      quoteId,
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

    const attachment = await this.repo.findAttachmentByIdAndQuoteId(
      attachmentId,
      quoteId,
    );
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }

    return { attachment };
  }
}
