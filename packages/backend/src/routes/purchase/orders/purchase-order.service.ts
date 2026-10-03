import { Context } from "hono";
import { PurchaseOrderRepository } from "./purchase-order.repository";
import { SearchOrdersQuery, PurchaseOrderPayload, BulkSendEmailInput } from "./purchase-order.schema";
import { PaginationParams } from "../../../platform/http/pagination";
import { PurchaseOrderCrudService } from "./purchase-order-crud.service";
import { PurchaseOrderCsvService } from "./purchase-order-csv.service";
import { PurchaseOrderPdfService } from "./purchase-order-pdf.service";
import { PurchaseOrderDownloadService } from "./purchase-order-download.service";
import { PurchaseOrderMailService } from "./purchase-order-mail.service";
import { PurchaseOrderReceiptService } from "./purchase-order-receipt.service";
import { ReceiptsRepository } from "../../inventory/receipts/receipts.repository";
import { SortQuery } from "../../../platform/http/sort";

// quote.service.ts/purchase-requisition.service.tsと同じ方針。薄いファサードとして残し、
// index.ts・workflow-engine/target-adapters/purchase-orders.adapter.tsからの呼び出し方を
// 一切変更しないことで、両ファイル・既存テストへの影響を無くしている
export class PurchaseOrderService {
  private crud: PurchaseOrderCrudService;
  private csv: PurchaseOrderCsvService;
  private pdf: PurchaseOrderPdfService;
  private download: PurchaseOrderDownloadService;
  private mail: PurchaseOrderMailService;
  private receipt: PurchaseOrderReceiptService;
  private repo: PurchaseOrderRepository;

  constructor(repo: PurchaseOrderRepository, d1: D1Database) {
    this.repo = repo;
    this.crud = new PurchaseOrderCrudService(repo);
    this.csv = new PurchaseOrderCsvService(repo);
    this.pdf = new PurchaseOrderPdfService(repo);
    this.download = new PurchaseOrderDownloadService(repo);
    this.mail = new PurchaseOrderMailService(repo, this.pdf);
    // Item9: 発注→入荷の消込連携(receipts側のReceiptsRepositoryと合成)
    this.receipt = new PurchaseOrderReceiptService(repo, new ReceiptsRepository(d1));
  }

  // --- 検索/CRUD ---
  searchOrders(c: Context, query: SearchOrdersQuery, sort?: SortQuery) {
    return this.crud.searchOrders(c, query, sort);
  }

  searchOrdersPage(
    c: Context,
    query: SearchOrdersQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    return this.crud.searchOrdersPage(c, query, params, sort);
  }

  getOrderDetail(c: Context, id: string) {
    return this.crud.getOrderDetail(c, id);
  }

  createOrder(c: Context, formData: FormData, body: PurchaseOrderPayload) {
    return this.crud.createOrder(c, formData, body);
  }

  updateOrder(c: Context, id: string, formData: FormData, body: PurchaseOrderPayload) {
    return this.crud.updateOrder(c, id, formData, body);
  }

  deleteOrder(c: Context, id: string) {
    return this.crud.deleteOrder(c, id);
  }

  performOrderDeletion(c: Context, id: string, knownSnapshot?: any) {
    return this.crud.performOrderDeletion(c, id, knownSnapshot);
  }

  submitForApproval(c: Context, id: string, applicantDepartmentSurrogateId?: string | null) {
    return this.crud.submitForApproval(c, id, applicantDepartmentSurrogateId);
  }

  requestOrderDeletion(c: Context, id: string) {
    return this.crud.requestOrderDeletion(c, id);
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

  // --- ダウンロード/OTP ---
  getDownloadStream(id: string, attachmentId: string) {
    return this.download.getDownloadStream(id, attachmentId);
  }

  requestDownloadOtp(c: Context, orderId: string, attachmentId: string, email: string) {
    return this.download.requestDownloadOtp(c, orderId, attachmentId, email);
  }

  verifyDownloadOtp(c: Context, orderId: string, attachmentId: string, email: string, otp: string) {
    return this.download.verifyDownloadOtp(c, orderId, attachmentId, email, otp);
  }

  // --- メール送信 ---
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

  // --- 発注→入荷の消込連携 ---
  getReceiptProgress(orderId: string) {
    return this.receipt.getReceiptProgress(orderId);
  }
}
