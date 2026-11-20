import { Context } from "hono";
import { SalesInvoiceRepository } from "./sales-invoice.repository";
import { toRecipientEmails, sendDocumentOtpToRecipients, verifyDocumentOtp } from "../../../platform/otp/document-otp";
import { NotFoundError } from "../../../platform/http/http-error";

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
    _email?: string,
  ) {
    const invoice = await this.repo.findInvoiceById(invoiceId);
    if (!invoice) throw new NotFoundError("指定された売上データが見つかりません");

    const attachment = await this.repo.findAttachmentByIdAndInvoiceId(attachmentId, invoiceId);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }

    // REQ-007: メールアドレスの入力をやめ、登録済みの宛先の全員に同じ確認コードを送る(入荷指示書と同じ)。照合・回数制限は帳票の単位
    const emails = toRecipientEmails(await this.repo.findActiveContactsByPartnerId(invoice.partnerId, invoice.documentType));
    return sendDocumentOtpToRecipients(c, {
      documentType: "sales_invoice",
      documentId: invoiceId,
      attachmentId: attachmentId,
      emails,
      category: "sales_invoice_download_otp",
      label: "売上関連書類",
    });
  }

  // REQ-007: 確認コードの照合は帳票の単位(メールアドレスは使わない。送られてきても無視する)
  async verifyDownloadOtp(
    c: Context,
    invoiceId: string,
    attachmentId: string,
    _email: string | undefined,
    otp: string,
  ) {
    await verifyDocumentOtp(c, { documentType: "sales_invoice", documentId: invoiceId, attachmentId: attachmentId, otp });

    const attachment = await this.repo.findAttachmentByIdAndInvoiceId(attachmentId, invoiceId);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }

    return { attachment };
  }
}
