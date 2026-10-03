import { Context } from "hono";
import { Env } from "../../../types/env";
import { ShipmentsRepository } from "./shipments.repository";
import { ShipmentsService } from "./shipments.service";
import { PartnerContactsRepository } from "../../master/partner-contacts/partner-contacts.repository";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { OtpRepository } from "../../../platform/otp/otp-repository";
import { generateOtpCode } from "../../../platform/otp/generate-otp-code";
import { enqueueNotification } from "../../../platform/notifications/enqueue-notification";
import { resolveDocumentFileName } from "../../../platform/documents/document-file-name";

const OTP_REQUEST_RATE_LIMIT_WINDOW_MINUTES = 60;
const MAX_OTP_REQUESTS_PER_WINDOW = 5;
const DOCUMENT_TYPE = "delivery_note";

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Item7残課題7: 納品書PDF/納品予定データCSVのOTPダウンロード。shipment-instruction-download.service.ts
// と同じOTPコア(OtpRepository/generateOtpCode/enqueueNotification)・同じ「複数連絡先へ同一OTPを
// 一斉送信しemailで絞り込まない」方針を踏襲する。納品書には出荷指示書のような複数バージョン管理の
// 概念が無く(1出庫=1納品書PDF、パスはitemShipmentHeaders.deliveryNoteR2Pathに直接保存)専用の
// 添付テーブルが存在しないため、shipmentHeaderId自体をdocumentId/attachmentIdの両方に使い回す
export class DeliveryNoteDownloadService {
  constructor(private repo: ShipmentsRepository) {}

  private async resolveRecipientEmails(c: Context<{ Bindings: Env }>, partnerId: string): Promise<string[]> {
    const contactsRepo = new PartnerContactsRepository(c.env.DB);
    const contacts = await contactsRepo.findActiveContactsForDocument(partnerId, "delivery_note");
    const emails = contacts
      .map((ct) => ct.email?.trim().toLowerCase())
      .filter((email): email is string => !!email);
    if (emails.length === 0) {
      throw new BadRequestError(
        "この得意先には連絡先メールアドレスが登録されていないため、OTPダウンロードを利用できません。取引先担当者マスタに登録してください。",
      );
    }
    return Array.from(new Set(emails));
  }

  async requestDownloadOtp(c: Context<{ Bindings: Env }>, headerId: string, attachmentId: string) {
    const header = await this.repo.findHeaderById(headerId);
    if (!header || !header.partnerId) throw new NotFoundError("指定された出庫が見つかりません");
    if (!header.deliveryNoteR2Path) throw new NotFoundError("納品書PDFがまだ生成されていません");

    const emails = await this.resolveRecipientEmails(c, header.partnerId);
    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const otpRepo = new OtpRepository(c.env.DB_OTP);
    const now = new Date();

    const windowStart = new Date(now.getTime() - OTP_REQUEST_RATE_LIMIT_WINDOW_MINUTES * 60_000);
    const recentCount = await otpRepo.countRecentChallengesAny(DOCUMENT_TYPE, headerId, attachmentId, windowStart);

    if (recentCount < MAX_OTP_REQUESTS_PER_WINDOW) {
      const otpDigitCount = toPositiveInt((systemConfig as any).otp_digit_count, 4);
      const otpExpiryMinutes = toPositiveInt((systemConfig as any).otp_expiry_minutes, 10);
      const otpCode = generateOtpCode(otpDigitCount);
      const expiresAt = new Date(now.getTime() + otpExpiryMinutes * 60_000);

      for (const email of emails) {
        await otpRepo.insertChallenge({
          id: crypto.randomUUID(),
          documentType: DOCUMENT_TYPE,
          documentId: headerId,
          attachmentId,
          email,
          otpCode,
          expiresAt,
          createdAt: now,
        });

        await enqueueNotification({
          dbLog: c.env.DB_LOG,
          category: "delivery_note_download_otp",
          documentId: headerId,
          recipientTo: email,
          subject: "【納品書ダウンロード】確認コードのご案内",
          body: [
            "納品書ダウンロードの確認コードは以下の通りです。",
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
      message: "登録済みの連絡先宛に確認コードを送信しました。メールをご確認ください。",
    };
  }

  async verifyDownloadOtp(c: Context<{ Bindings: Env }>, headerId: string, attachmentId: string, otp: string) {
    const header = await this.repo.findHeaderById(headerId);
    if (!header || !header.deliveryNoteR2Path) throw new NotFoundError("指定された出庫が見つかりません");

    const otpRepo = new OtpRepository(c.env.DB_OTP);
    const now = new Date();
    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const maxAttempts = toPositiveInt((systemConfig as any).otp_max_attempts, 5);

    const challenge = await otpRepo.findLatestActiveChallengeAny(DOCUMENT_TYPE, headerId, attachmentId, now);
    if (!challenge) {
      throw new BadRequestError("確認コードが無効か期限切れです。お手数ですが再度コード送信をお試しください。");
    }
    if (challenge.attemptCount >= maxAttempts) {
      throw new BadRequestError("試行回数の上限に達しました。お手数ですが再度コード送信をお試しください。");
    }
    if (challenge.otpCode !== otp.trim()) {
      await otpRepo.incrementAttempt(challenge.id, challenge.attemptCount + 1);
      const remaining = maxAttempts - challenge.attemptCount - 1;
      throw new BadRequestError(`確認コードが正しくありません。(残り試行可能回数: ${remaining}回)`);
    }

    await otpRepo.markVerified(challenge.id, now);

    // Item7残課題7: PDFと一緒に納品予定データCSVもOTPダウンロードページから取得できるようにする
    // (CSVはR2に保存せず、出荷指示書と同じくverify時点のDB状態からその場で生成する)
    const csv = await new ShipmentsService(this.repo).generateDeliveryScheduleCsv(c, headerId);

    return {
      r2Path: header.deliveryNoteR2Path as string,
      fileName: await resolveDocumentFileName(c.env.DB, "sales_invoice", headerId),
      csv,
    };
  }
}
