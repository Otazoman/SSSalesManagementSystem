import { Context } from "hono";
import { SalesOrderRepository } from "./sales-order.repository";
import { SearchOrdersQuery, SalesOrderPayload, BulkSendEmailInput } from "./sales-order.schema";
import { PaginationParams } from "../../../platform/http/pagination";
import { SalesOrderCrudService } from "./sales-order-crud.service";
import { SalesOrderCsvService } from "./sales-order-csv.service";
import { SalesOrderPdfService } from "./sales-order-pdf.service";
import { SalesOrderDownloadService } from "./sales-order-download.service";
import { SalesOrderMailService } from "./sales-order-mail.service";
import { SalesOrderShipmentService } from "./sales-order-shipment.service";
import { SalesOrderBulkShipmentService } from "./sales-order-bulk-shipment.service";
import { WarehouseStockReservationRepository } from "../../../platform/inventory/warehouse-stock-reservation.repository";
import { SortQuery } from "../../../platform/http/sort";

// Item7: quote.service.tsと同じ薄いファサード方針
export class SalesOrderService {
  private crud: SalesOrderCrudService;
  private csv: SalesOrderCsvService;
  private pdf: SalesOrderPdfService;
  private download: SalesOrderDownloadService;
  private mail: SalesOrderMailService;
  private shipment: SalesOrderShipmentService;
  private bulkShipment: SalesOrderBulkShipmentService;

  constructor(repo: SalesOrderRepository) {
    this.crud = new SalesOrderCrudService(repo);
    this.csv = new SalesOrderCsvService(repo);
    this.pdf = new SalesOrderPdfService(repo);
    this.download = new SalesOrderDownloadService(repo);
    this.mail = new SalesOrderMailService(repo, this.pdf);
    this.shipment = new SalesOrderShipmentService(repo);
    this.bulkShipment = new SalesOrderBulkShipmentService(repo);
  }

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

  getBackorderedItems(c: Context) {
    return this.crud.getBackorderedItems(c);
  }

  getOrderDetail(c: Context, id: string) {
    return this.crud.getOrderDetail(c, id);
  }

  createOrder(c: Context, formData: FormData, body: SalesOrderPayload) {
    return this.crud.createOrder(c, formData, body);
  }

  updateOrder(c: Context, id: string, formData: FormData, body: SalesOrderPayload) {
    return this.crud.updateOrder(c, id, formData, body);
  }

  deleteOrder(c: Context, id: string) {
    return this.crud.deleteOrder(c, id);
  }

  performOrderDeletion(c: Context, id: string, knownSnapshot?: any) {
    return this.crud.performOrderDeletion(c, id, knownSnapshot);
  }

  submitForApproval(
    c: Context,
    id: string,
    applicantDepartmentSurrogateId?: string | null,
  ) {
    return this.crud.submitForApproval(c, id, applicantDepartmentSurrogateId);
  }

  requestOrderDeletion(c: Context, id: string) {
    return this.crud.requestOrderDeletion(c, id);
  }

  retryBackorder(c: Context, id: string) {
    return this.crud.retryBackorder(c, id);
  }

  submitUpdateForApproval(
    c: Context,
    id: string,
    body: {
      header: Record<string, any>;
      items: any[];
      comment?: string;
      applicantDepartmentSurrogateId?: string | null;
    },
  ) {
    return this.crud.submitUpdateForApproval(c, id, body);
  }

  // Item7残課題2-5(#2): 品目の倉庫別在庫参照(FIFO自動割当の提案・受注フォームでの参照表示の両方に使う)
  getWarehouseStock(c: Context, itemId: string) {
    const repo = new WarehouseStockReservationRepository(c.env.DB);
    return repo.getAvailableByWarehouse(itemId);
  }

  // Item7残課題2-5(#4): 在庫一覧画面から、品目の引当元受注をトレースする
  getOrderReservationsForItem(itemId: string) {
    return this.crud.getOrderReservationsForItem(itemId);
  }

  // Item7残課題6: 受注明細ごとの出荷済/残数量・倉庫別引当内訳(出荷指示/出庫の作成導線用)
  getShipmentProgress(c: Context, orderId: string) {
    return this.shipment.getShipmentProgress(orderId, c.env.DB);
  }

  // --- 受注一覧からの一括出荷指示/出庫作成 (sales-order-bulk-shipment.service.ts) ---
  computeBulkShipmentPlan(c: Context, orderIds: string[]) {
    return this.bulkShipment.computeBulkShipmentPlan(c, orderIds);
  }

  executeBulkShipmentPlan(c: Context, orderIds: string[]) {
    return this.bulkShipment.executeBulkShipmentPlan(c, orderIds);
  }

  // --- CSV入出力 (sales-order-csv.service.ts) ---
  exportCsv(c: Context) {
    return this.csv.exportCsv(c);
  }

  bulkImportCsv(c: Context, file: File) {
    return this.csv.bulkImportCsv(c, file);
  }

  // --- PDF生成 (sales-order-pdf.service.ts) ---
  generatePdf(c: Context, id: string) {
    return this.pdf.generatePdf(c, id);
  }

  // --- ダウンロード/OTP (sales-order-download.service.ts) ---
  getDownloadStream(id: string, attachmentId: string) {
    return this.download.getDownloadStream(id, attachmentId);
  }

  requestDownloadOtp(c: Context, orderId: string, attachmentId: string, email: string) {
    return this.download.requestDownloadOtp(c, orderId, attachmentId, email);
  }

  verifyDownloadOtp(c: Context, orderId: string, attachmentId: string, email: string, otp: string) {
    return this.download.verifyDownloadOtp(c, orderId, attachmentId, email, otp);
  }

  // --- メール送信 (sales-order-mail.service.ts) ---
  bulkSendEmail(c: Context, payload: BulkSendEmailInput) {
    return this.mail.bulkSendEmail(c, payload);
  }

  singleSendEmail(c: Context, id: string, payload: { recipientEmail: string; fallbackOperatorId?: string }) {
    return this.mail.singleSendEmail(c, id, payload);
  }
}
