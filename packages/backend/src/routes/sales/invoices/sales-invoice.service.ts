import { Context } from "hono";
import { SalesInvoiceRepository } from "./sales-invoice.repository";
import { SearchSalesInvoicesQuery, SalesInvoicePayload, BulkSendEmailInput } from "./sales-invoice.schema";
import { PaginationParams } from "../../../platform/http/pagination";
import { SalesInvoiceCrudService } from "./sales-invoice-crud.service";
import { SalesInvoiceCsvService } from "./sales-invoice-csv.service";
import { SalesInvoicePdfService } from "./sales-invoice-pdf.service";
import { SalesInvoiceDownloadService } from "./sales-invoice-download.service";
import { SalesInvoiceMailService } from "./sales-invoice-mail.service";
import { SortQuery } from "../../../platform/http/sort";

// Item8: quote.service.tsと同じファサード構成。K-4-1でmail/OTPダウンロードのサブサービスを追加
// (Phase2時点では承認済み実装計画により対象外としていたが、K-4-1で見積・発注と揃える方針に変更)
export class SalesInvoiceService {
  private crud: SalesInvoiceCrudService;
  private csv: SalesInvoiceCsvService;
  private pdf: SalesInvoicePdfService;
  private download: SalesInvoiceDownloadService;
  private mail: SalesInvoiceMailService;

  constructor(repo: SalesInvoiceRepository) {
    this.crud = new SalesInvoiceCrudService(repo);
    this.csv = new SalesInvoiceCsvService(repo);
    this.pdf = new SalesInvoicePdfService(repo);
    this.download = new SalesInvoiceDownloadService(repo);
    this.mail = new SalesInvoiceMailService(repo, this.pdf);
  }

  // --- 検索/CRUD ---
  searchInvoices(c: Context, query: SearchSalesInvoicesQuery, sort?: SortQuery) {
    return this.crud.searchInvoices(c, query, sort);
  }

  searchInvoicesPage(
    c: Context,
    query: SearchSalesInvoicesQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    return this.crud.searchInvoicesPage(c, query, params, sort);
  }

  getInvoiceDetail(c: Context, id: string) {
    return this.crud.getInvoiceDetail(c, id);
  }

  getOrderInvoiceProgress(c: Context, salesOrderId: string) {
    return this.crud.getOrderInvoiceProgress(c, salesOrderId);
  }

  createInvoice(c: Context, formData: FormData, body: SalesInvoicePayload) {
    return this.crud.createInvoice(c, formData, body);
  }

  updateInvoice(c: Context, id: string, formData: FormData, body: SalesInvoicePayload) {
    return this.crud.updateInvoice(c, id, formData, body);
  }

  deleteInvoice(c: Context, id: string) {
    return this.crud.deleteInvoice(c, id);
  }

  performInvoiceDeletion(c: Context, id: string, knownSnapshot?: any) {
    return this.crud.performInvoiceDeletion(c, id, knownSnapshot);
  }

  submitForApproval(c: Context, id: string, applicantDepartmentSurrogateId?: string | null) {
    return this.crud.submitForApproval(c, id, applicantDepartmentSurrogateId);
  }

  requestInvoiceDeletion(c: Context, id: string) {
    return this.crud.requestInvoiceDeletion(c, id);
  }

  // --- CSV入出力 ---
  exportCsv(c: Context) {
    return this.csv.exportCsv(c);
  }

  bulkImportCsv(c: Context, file: File) {
    return this.csv.bulkImportCsv(c, file);
  }

  // --- PDF生成 ---
  generatePdf(c: Context, id: string) {
    return this.pdf.generatePdf(c, id);
  }

  // --- 添付ファイルダウンロード(認証済みルート) ---
  getDownloadStream(id: string, attachmentId: string) {
    return this.download.getDownloadStream(id, attachmentId);
  }

  // --- K-4-1: OTPダウンロード(外部公開ルート) ---
  requestDownloadOtp(c: Context, invoiceId: string, attachmentId: string, email: string) {
    return this.download.requestDownloadOtp(c, invoiceId, attachmentId, email);
  }

  verifyDownloadOtp(
    c: Context,
    invoiceId: string,
    attachmentId: string,
    email: string,
    otp: string,
  ) {
    return this.download.verifyDownloadOtp(c, invoiceId, attachmentId, email, otp);
  }

  // --- K-4-1: メール送信 ---
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
