import { Context } from "hono";
import { BillingRepository } from "./billing.repository";
import { toRecipientEmails, sendDocumentOtpToRecipients, verifyDocumentOtp } from "../../../platform/otp/document-otp";
import { NotFoundError } from "../../../platform/http/http-error";

// 追加要望: sales-invoice-download.service.tsと同じ方針(外部の取引先がメールのリンクから
// 直接アクセスするOTPダウンロード)。請求(billing_headers)はsales_invoicesと異なり
// 添付ファイルテーブルを持たず、PDFは1件につき常に1本(invoicePdfR2Path)のため、
// attachmentIdは持たずbillingHeaderIdのみで完結させる(OtpRepositoryのattachmentId列には
// 固定文字列"invoice"を渡す。将来CSV等の形式を追加する場合はこの値を分ければ流用できる)
const OTP_DOCUMENT_TYPE = "billing_invoice";
const OTP_ATTACHMENT_ID = "invoice";

export class BillingDownloadService {
  private repo: BillingRepository;

  constructor(repo: BillingRepository) {
    this.repo = repo;
  }

  async requestDownloadOtp(c: Context, billingHeaderId: string, _email?: string) {
    const header = await this.repo.findHeaderById(billingHeaderId);
    if (!header) throw new NotFoundError("指定された請求データが見つかりません");
    if (!header.invoicePdfR2Path) {
      throw new NotFoundError("請求書PDFが未発行です");
    }

    // REQ-007: メールアドレスの入力をやめ、登録済みの宛先の全員に同じ確認コードを送る(入荷指示書と同じ)。照合・回数制限は帳票の単位
    const emails = toRecipientEmails(await this.repo.findActiveContactsByPartnerId(header.partnerId));
    return sendDocumentOtpToRecipients(c, {
      documentType: OTP_DOCUMENT_TYPE,
      documentId: billingHeaderId,
      attachmentId: OTP_ATTACHMENT_ID,
      emails,
      category: "billing_download_otp",
      label: "請求書",
    });
  }

  // REQ-007: 確認コードの照合は帳票の単位(メールアドレスは使わない。送られてきても無視する)
  async verifyDownloadOtp(c: Context, billingHeaderId: string, _email: string | undefined, otp: string) {
    await verifyDocumentOtp(c, { documentType: OTP_DOCUMENT_TYPE, documentId: billingHeaderId, attachmentId: OTP_ATTACHMENT_ID, otp });

    const header = await this.repo.findHeaderById(billingHeaderId);
    if (!header || !header.invoicePdfR2Path) {
      throw new NotFoundError("請求書PDFが未発行です");
    }

    return { header };
  }
}
