import { Context } from "hono";
import { ReceiptsRepository } from "./receipts.repository";
import { toRecipientEmails, sendDocumentOtpToRecipients, verifyDocumentOtp } from "../../../platform/otp/document-otp";
import { PartnerContactsRepository } from "../../master/partner-contacts/partner-contacts.repository";
import { NotFoundError } from "../../../platform/http/http-error";

// purchase-order-download.service.tsと同じ方針(OTP発行連打による悪用防止のレート制限含む)
const DOCUMENT_TYPE = "acceptance_inspection";

export class AcceptanceInspectionDownloadService {
  constructor(private repo: ReceiptsRepository) {}

  async getDownloadStream(id: string, attachmentId: string) {
    const attachment = await this.repo.findAttachmentByIdAndReceiptId(attachmentId, id);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }
    return { attachment };
  }

  async requestDownloadOtp(c: Context, receiptId: string, attachmentId: string, _email?: string) {
    const receipt = await this.repo.findHeaderById(receiptId);
    if (!receipt) throw new NotFoundError("指定された入庫が見つかりません");

    const attachment = await this.repo.findAttachmentByIdAndReceiptId(attachmentId, receiptId);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }

    // REQ-007: メールアドレスの入力をやめ、登録済みの宛先の全員に同じ確認コードを送る(入荷指示書と同じ)。照合・回数制限は帳票の単位
    const emails = toRecipientEmails(receipt.partnerId ? await new PartnerContactsRepository(c.env.DB).findActiveContactsForDocument(receipt.partnerId, "acceptance_inspection") : []);
    return sendDocumentOtpToRecipients(c, {
      documentType: DOCUMENT_TYPE,
      documentId: receiptId,
      attachmentId: attachmentId,
      emails,
      category: "acceptance_inspection_download_otp",
      label: "検収書",
    });
  }

  // REQ-007: 確認コードの照合は帳票の単位(メールアドレスは使わない。送られてきても無視する)
  async verifyDownloadOtp(c: Context, receiptId: string, attachmentId: string, _email: string | undefined, otp: string) {
    await verifyDocumentOtp(c, { documentType: DOCUMENT_TYPE, documentId: receiptId, attachmentId: attachmentId, otp });

    const attachment = await this.repo.findAttachmentByIdAndReceiptId(attachmentId, receiptId);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }

    return { attachment };
  }
}
