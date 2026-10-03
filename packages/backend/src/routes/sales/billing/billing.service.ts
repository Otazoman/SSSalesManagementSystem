import { Context } from "hono";
import { BillingRepository } from "./billing.repository";
import {
  SearchBillingQuery,
  CreateBillingPayload,
  PaymentReceiptPayload,
  BulkSendEmailInput,
} from "./billing.schema";
import { PaginationParams } from "../../../platform/http/pagination";
import { BillingCrudService } from "./billing-crud.service";
import { BillingCsvService } from "./billing-csv.service";
import { BillingPdfService } from "./billing-pdf.service";
import { BillingReconciliationService } from "./billing-reconciliation.service";
import { BillingMailService } from "./billing-mail.service";
import { BillingDownloadService } from "./billing-download.service";
import { SortQuery } from "../../../platform/http/sort";

// Item8 Phase4: quote.service.ts等と同じファサード構成。K-4-4でメール送信サブサービスを追加。
// 追加要望: OTPダウンロードサブサービスを追加
export class BillingService {
  private crud: BillingCrudService;
  private csv: BillingCsvService;
  private pdf: BillingPdfService;
  private reconciliation: BillingReconciliationService;
  private mail: BillingMailService;
  private download: BillingDownloadService;

  constructor(repo: BillingRepository) {
    this.crud = new BillingCrudService(repo);
    this.csv = new BillingCsvService(repo);
    this.pdf = new BillingPdfService(repo);
    this.reconciliation = new BillingReconciliationService(repo);
    this.mail = new BillingMailService(repo, this.pdf);
    this.download = new BillingDownloadService(repo);
  }

  // --- 検索/CRUD ---
  searchHeaders(c: Context, query: SearchBillingQuery, sort?: SortQuery) {
    return this.crud.searchHeaders(c, query, sort);
  }

  searchHeadersPage(c: Context, query: SearchBillingQuery, params: PaginationParams, sort?: SortQuery) {
    return this.crud.searchHeadersPage(c, query, params, sort);
  }

  getBillingDetail(c: Context, id: string) {
    return this.crud.getBillingDetail(c, id);
  }

  createBilling(c: Context, body: CreateBillingPayload) {
    return this.crud.createBilling(c, body);
  }

  deleteBilling(c: Context, id: string) {
    return this.crud.deleteBilling(c, id);
  }

  // --- 消込 ---
  recordPaymentReceipt(c: Context, billingHeaderId: string, body: PaymentReceiptPayload) {
    return this.reconciliation.recordPaymentReceipt(c, billingHeaderId, body);
  }

  // --- CSV入出力 ---
  exportCsv(c: Context) {
    return this.csv.exportCsv(c);
  }

  bulkImportCsv(c: Context, file: File) {
    return this.csv.bulkImportCsv(c, file);
  }

  exportPaymentReceiptsCsv(c: Context) {
    return this.csv.exportPaymentReceiptsCsv(c);
  }

  bulkImportPaymentReceiptsCsv(c: Context, file: File) {
    return this.csv.bulkImportPaymentReceiptsCsv(c, file);
  }

  // --- PDF発行 ---
  generatePdf(c: Context, id: string) {
    return this.pdf.generatePdf(c, id);
  }

  // --- K-4-4: 再発行(保存済みPDFの再ダウンロード・再送付) ---
  getDownloadStream(id: string) {
    return this.pdf.getDownloadStream(id);
  }

  sendEmail(
    c: Context,
    id: string,
    payload: { recipientEmail: string; fallbackOperatorId?: string },
  ) {
    return this.mail.singleSendEmail(c, id, payload);
  }

  // --- 追加要望: 一覧からの一括メール送信 ---
  sendBulkEmail(c: Context, payload: BulkSendEmailInput) {
    return this.mail.bulkSendEmail(c, payload);
  }

  // --- 追加要望: OTPダウンロード(外部公開) ---
  requestDownloadOtp(c: Context, id: string, email: string) {
    return this.download.requestDownloadOtp(c, id, email);
  }

  verifyDownloadOtp(c: Context, id: string, email: string, otp: string) {
    return this.download.verifyDownloadOtp(c, id, email, otp);
  }
}
