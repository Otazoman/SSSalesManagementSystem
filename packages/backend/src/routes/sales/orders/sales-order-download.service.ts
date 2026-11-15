import { Context } from "hono";
import { SalesOrderRepository } from "./sales-order.repository";
import { toRecipientEmails, sendDocumentOtpToRecipients, verifyDocumentOtp } from "../../../platform/otp/document-otp";
import { NotFoundError } from "../../../platform/http/http-error";

// Item7: quote-download.service.tsと同じ方針(OTP発行連打による悪用防止のレート制限含む)

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

  async requestDownloadOtp(c: Context, orderId: string, attachmentId: string, _email?: string) {
    const order = await this.repo.findOrderById(orderId);
    if (!order) throw new NotFoundError("指定された受注が見つかりません");

    const attachment = await this.repo.findAttachmentByIdAndOrderId(attachmentId, orderId);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }

    // REQ-007: メールアドレスの入力をやめ、登録済みの宛先の全員に同じ確認コードを送る(入荷指示書と同じ)。照合・回数制限は帳票の単位
    const emails = toRecipientEmails(await this.repo.findActiveContactsByPartnerId(order.partnerId));
    return sendDocumentOtpToRecipients(c, {
      documentType: "sales_order",
      documentId: orderId,
      attachmentId: attachmentId,
      emails,
      category: "sales_order_download_otp",
      label: "注文請書",
    });
  }

  // REQ-007: 確認コードの照合は帳票の単位(メールアドレスは使わない。送られてきても無視する)
  async verifyDownloadOtp(c: Context, orderId: string, attachmentId: string, _email: string | undefined, otp: string) {
    await verifyDocumentOtp(c, { documentType: "sales_order", documentId: orderId, attachmentId: attachmentId, otp });

    const attachment = await this.repo.findAttachmentByIdAndOrderId(attachmentId, orderId);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }

    return { attachment };
  }
}
