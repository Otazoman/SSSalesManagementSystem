import { Context } from "hono";
import { QuoteRepository } from "./quote.repository";
import { SearchQuotesQuery, QuotePayload, BulkSendEmailInput } from "./quote.schema";
import { PaginationParams } from "../../../platform/http/pagination";
import { QuoteCrudService } from "./quote-crud.service";
import { QuoteCsvService } from "./quote-csv.service";
import { QuotePdfService } from "./quote-pdf.service";
import { QuoteDownloadService } from "./quote-download.service";
import { QuoteMailService } from "./quote-mail.service";
import { SortQuery } from "../../../platform/http/sort";

// Item4-f: 元々このファイル1つ(1454行)に検索/CRUD・CSV入出力・PDF生成・OTPダウンロード・
// メール送信という5つの関心事が同居していたため、用途別のサブサービスへ分割した。
// このクラス自体は薄いファサードとして残し、routes/sales/quotes/index.ts と
// workflow-engine/target-adapters/quotes.adapter.ts からの呼び出し方(publicメソッドのシグネチャ)を
// 一切変更しないことで、両ファイル・既存テストへの影響を無くしている。
export class QuoteService {
  private crud: QuoteCrudService;
  private csv: QuoteCsvService;
  private pdf: QuotePdfService;
  private download: QuoteDownloadService;
  private mail: QuoteMailService;

  constructor(repo: QuoteRepository) {
    this.crud = new QuoteCrudService(repo);
    this.csv = new QuoteCsvService(repo);
    this.pdf = new QuotePdfService(repo);
    this.download = new QuoteDownloadService(repo);
    this.mail = new QuoteMailService(repo, this.pdf);
  }

  // --- 検索/CRUD (quote-crud.service.ts) ---
  searchQuotes(c: Context, query: SearchQuotesQuery, sort?: SortQuery) {
    return this.crud.searchQuotes(c, query, sort);
  }

  searchQuotesPage(
    c: Context,
    query: SearchQuotesQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    return this.crud.searchQuotesPage(c, query, params, sort);
  }

  getQuoteDetail(c: Context, id: string) {
    return this.crud.getQuoteDetail(c, id);
  }

  createQuote(c: Context, formData: FormData, body: QuotePayload) {
    return this.crud.createQuote(c, formData, body);
  }

  updateQuote(c: Context, id: string, formData: FormData, body: QuotePayload) {
    return this.crud.updateQuote(c, id, formData, body);
  }

  deleteQuote(c: Context, id: string) {
    return this.crud.deleteQuote(c, id);
  }

  performQuoteDeletion(c: Context, id: string, knownSnapshot?: any) {
    return this.crud.performQuoteDeletion(c, id, knownSnapshot);
  }

  submitForApproval(
    c: Context,
    id: string,
    applicantDepartmentSurrogateId?: string | null,
  ) {
    return this.crud.submitForApproval(c, id, applicantDepartmentSurrogateId);
  }

  requestQuoteDeletion(c: Context, id: string) {
    return this.crud.requestQuoteDeletion(c, id);
  }

  // --- CSV入出力 (quote-csv.service.ts) ---
  exportCsv(c: Context) {
    return this.csv.exportCsv(c);
  }

  bulkImportCsv(c: Context, file: File) {
    return this.csv.bulkImportCsv(c, file);
  }

  // --- PDF生成 (quote-pdf.service.ts) ---
  generatePdf(c: Context, id: string) {
    return this.pdf.generatePdf(c, id);
  }

  // --- ダウンロード/OTP (quote-download.service.ts) ---
  getDownloadStream(id: string, attachmentId: string) {
    return this.download.getDownloadStream(id, attachmentId);
  }

  requestDownloadOtp(c: Context, quoteId: string, attachmentId: string, email: string) {
    return this.download.requestDownloadOtp(c, quoteId, attachmentId, email);
  }

  verifyDownloadOtp(
    c: Context,
    quoteId: string,
    attachmentId: string,
    email: string,
    otp: string,
  ) {
    return this.download.verifyDownloadOtp(c, quoteId, attachmentId, email, otp);
  }

  // --- メール送信 (quote-mail.service.ts) ---
  bulkSendEmail(c: Context, payload: BulkSendEmailInput) {
    return this.mail.bulkSendEmail(c, payload);
  }

  singleSendEmail(
    c: Context,
    id: string,
    payload: { recipientEmail: string; fallbackOperatorId?: string },
  ) {
    return this.mail.singleSendEmail(c, id, payload);
  }
}
