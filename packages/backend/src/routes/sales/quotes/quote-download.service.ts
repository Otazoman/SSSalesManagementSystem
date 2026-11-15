import { Context } from "hono";
import { QuoteRepository } from "./quote.repository";
import { toRecipientEmails, sendDocumentOtpToRecipients, verifyDocumentOtp } from "../../../platform/otp/document-otp";
import { NotFoundError } from "../../../platform/http/http-error";

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
    _email?: string,
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

    // REQ-007: メールアドレスの入力をやめ、登録済みの宛先の全員に同じ確認コードを送る(入荷指示書と同じ)。照合・回数制限は帳票の単位
    const emails = toRecipientEmails(await this.repo.findActiveContactsByPartnerId(quote.partnerId));
    return sendDocumentOtpToRecipients(c, {
      documentType: "sales_quote",
      documentId: quoteId,
      attachmentId: attachmentId,
      emails,
      category: "quote_download_otp",
      label: "見積書",
    });
  }

  // REQ-007: 確認コードの照合は帳票の単位(メールアドレスは使わない。送られてきても無視する)
  async verifyDownloadOtp(
    c: Context,
    quoteId: string,
    attachmentId: string,
    _email: string | undefined,
    otp: string,
  ) {
    await verifyDocumentOtp(c, { documentType: "sales_quote", documentId: quoteId, attachmentId: attachmentId, otp });

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
