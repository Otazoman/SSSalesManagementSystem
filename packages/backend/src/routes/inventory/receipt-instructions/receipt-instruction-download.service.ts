import { Context } from "hono";
import { Env } from "../../../types/env";
import { ReceiptInstructionsRepository } from "./receipt-instructions.repository";
import { ReceiptInstructionsService } from "./receipt-instructions.service";
import { WarehousesRepository } from "../../master/warehouses/warehouses.repository";
import { WarehouseContactsRepository } from "../../master/warehouse-contacts/warehouse-contacts.repository";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { OtpRepository } from "../../../platform/otp/otp-repository";
import { generateOtpCode } from "../../../platform/otp/generate-otp-code";
import { enqueueNotification } from "../../../platform/notifications/enqueue-notification";

const OTP_REQUEST_RATE_LIMIT_WINDOW_MINUTES = 60;
const MAX_OTP_REQUESTS_PER_WINDOW = 5;
const DOCUMENT_TYPE = "receipt_instruction";

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Item6 Phase6-4: 入荷指示書のOTPダウンロード。shipment-instruction-download.service.tsと対称
// (宛先は倉庫の登録済み連絡先、未登録時は倉庫マスタ.emailへフォールバック。複数連絡先へ同じ
// OTPコードを一斉送信するため、チャレンジの検索・レート制限はemailで絞り込まない)
export class ReceiptInstructionDownloadService {
  constructor(private repo: ReceiptInstructionsRepository) {}

  private async resolveRecipientEmails(
    c: Context<{ Bindings: Env }>,
    warehouseId: string,
  ): Promise<string[]> {
    const contactsRepo = new WarehouseContactsRepository(c.env.DB);
    const contacts = await contactsRepo.findActiveContactsForDocument(warehouseId, "receipt_instruction");
    const contactEmails = contacts
      .map((ct) => ct.email?.trim().toLowerCase())
      .filter((email): email is string => !!email);
    if (contactEmails.length > 0) return Array.from(new Set(contactEmails));

    const warehousesRepo = new WarehousesRepository(c.env.DB);
    const warehouse = await warehousesRepo.findById(warehouseId);
    if (!warehouse || !warehouse.email) {
      throw new BadRequestError(
        "この倉庫には連絡先メールアドレスが登録されていないため、OTPダウンロードを利用できません。倉庫マスタに連絡先を登録してください。",
      );
    }
    return [warehouse.email.trim().toLowerCase()];
  }

  async requestDownloadOtp(c: Context<{ Bindings: Env }>, instructionId: string, attachmentId: string) {
    const header = await this.repo.findHeaderById(instructionId);
    if (!header) throw new NotFoundError("指定された入荷指示が見つかりません");

    const attachment = await this.repo.findAttachmentByIdAndInstructionId(attachmentId, instructionId);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }

    const emails = await this.resolveRecipientEmails(c, header.warehouseId);
    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const otpRepo = new OtpRepository(c.env.DB_OTP);
    const now = new Date();

    const windowStart = new Date(now.getTime() - OTP_REQUEST_RATE_LIMIT_WINDOW_MINUTES * 60_000);
    const recentCount = await otpRepo.countRecentChallengesAny(
      DOCUMENT_TYPE,
      instructionId,
      attachmentId,
      windowStart,
    );

    if (recentCount < MAX_OTP_REQUESTS_PER_WINDOW) {
      const otpDigitCount = toPositiveInt((systemConfig as any).otp_digit_count, 4);
      const otpExpiryMinutes = toPositiveInt((systemConfig as any).otp_expiry_minutes, 10);
      const otpCode = generateOtpCode(otpDigitCount);
      const expiresAt = new Date(now.getTime() + otpExpiryMinutes * 60_000);

      for (const email of emails) {
        await otpRepo.insertChallenge({
          id: crypto.randomUUID(),
          documentType: DOCUMENT_TYPE,
          documentId: instructionId,
          attachmentId,
          email,
          otpCode,
          expiresAt,
          createdAt: now,
        });

        await enqueueNotification({
          dbLog: c.env.DB_LOG,
          category: "receipt_instruction_download_otp",
          documentId: instructionId,
          recipientTo: email,
          subject: "【入荷指示書ダウンロード】確認コードのご案内",
          body: [
            "入荷指示書ダウンロードの確認コードは以下の通りです。",
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

  async verifyDownloadOtp(
    c: Context<{ Bindings: Env }>,
    instructionId: string,
    attachmentId: string,
    otp: string,
  ) {
    const header = await this.repo.findHeaderById(instructionId);
    if (!header) throw new NotFoundError("指定された入荷指示が見つかりません");

    const otpRepo = new OtpRepository(c.env.DB_OTP);
    const now = new Date();
    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const maxAttempts = toPositiveInt((systemConfig as any).otp_max_attempts, 5);

    const challenge = await otpRepo.findLatestActiveChallengeAny(
      DOCUMENT_TYPE,
      instructionId,
      attachmentId,
      now,
    );
    if (!challenge) {
      throw new BadRequestError(
        "確認コードが無効か期限切れです。お手数ですが再度コード送信をお試しください。",
      );
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

    const attachment = await this.repo.findAttachmentByIdAndInstructionId(attachmentId, instructionId);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }

    // Item6 Phase6-4: PDFと一緒に指示データCSVもOTPダウンロードページから取得できるようにする
    const csv = await new ReceiptInstructionsService(this.repo).generateCsvForInstruction(
      instructionId,
    );

    return { attachment, csv };
  }
}
