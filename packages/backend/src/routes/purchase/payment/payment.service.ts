import { Context } from "hono";
import { PaymentRepository } from "./payment.repository";
import { SearchPaymentQuery, CreatePaymentPayload, PaymentDisbursementPayload } from "./payment.schema";
import { PaginationParams } from "../../../platform/http/pagination";
import { PaymentCrudService } from "./payment-crud.service";
import { PaymentCsvService } from "./payment-csv.service";
import { PaymentReconciliationService } from "./payment-reconciliation.service";
import { PaymentFirmBankingService } from "./payment-firm-banking.service";
import { SortQuery } from "../../../platform/http/sort";

// Item10 Phase5: billing.service.tsと同じファサード構成。PDF発行は対象外(仕入側に発行書類なし)
export class PaymentService {
  private crud: PaymentCrudService;
  private csv: PaymentCsvService;
  private reconciliation: PaymentReconciliationService;
  private firmBanking: PaymentFirmBankingService;

  constructor(repo: PaymentRepository) {
    this.crud = new PaymentCrudService(repo);
    this.csv = new PaymentCsvService(repo);
    this.reconciliation = new PaymentReconciliationService(repo);
    this.firmBanking = new PaymentFirmBankingService(repo);
  }

  // --- 検索/CRUD ---
  searchHeaders(c: Context, query: SearchPaymentQuery, sort?: SortQuery) {
    return this.crud.searchHeaders(c, query, sort);
  }

  searchHeadersPage(c: Context, query: SearchPaymentQuery, params: PaginationParams, sort?: SortQuery) {
    return this.crud.searchHeadersPage(c, query, params, sort);
  }

  getPaymentDetail(c: Context, id: string) {
    return this.crud.getPaymentDetail(c, id);
  }

  createPayment(c: Context, body: CreatePaymentPayload) {
    return this.crud.createPayment(c, body);
  }

  // K-5-1: 支払作成モーダルの「検収から選択」タブ用候補一覧
  listCandidateItemReceipts(c: Context, partnerId: string) {
    return this.crud.listCandidateItemReceipts(c, partnerId);
  }

  // K-5-2: 支払作成モーダルの「仕入から選択」タブ用候補一覧(前払実績込み)
  listCandidateRecognitions(c: Context, partnerId: string) {
    return this.crud.listCandidateRecognitions(c, partnerId);
  }

  // --- 消込 ---
  recordDisbursement(c: Context, paymentHeaderId: string, body: PaymentDisbursementPayload) {
    return this.reconciliation.recordDisbursement(c, paymentHeaderId, body);
  }

  // --- CSV入出力 ---
  exportCsv(c: Context) {
    return this.csv.exportCsv(c);
  }

  bulkImportCsv(c: Context, file: File) {
    return this.csv.bulkImportCsv(c, file);
  }

  exportDisbursementsCsv(c: Context) {
    return this.csv.exportDisbursementsCsv(c);
  }

  bulkImportDisbursementsCsv(c: Context, file: File) {
    return this.csv.bulkImportDisbursementsCsv(c, file);
  }

  // --- ファームバンキング ---
  previewFirmBankingFile(c: Context, paymentHeaderIds: string[], transferDate: string) {
    return this.firmBanking.previewTransferFile(c, paymentHeaderIds, transferDate);
  }

  exportFirmBankingFile(c: Context, paymentHeaderIds: string[], transferDate: string) {
    return this.firmBanking.exportTransferFile(c, paymentHeaderIds, transferDate);
  }
}
