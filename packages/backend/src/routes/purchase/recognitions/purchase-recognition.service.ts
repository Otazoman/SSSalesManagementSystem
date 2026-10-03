import { Context } from "hono";
import { PurchaseRecognitionRepository } from "./purchase-recognition.repository";
import {
  SearchPurchaseRecognitionsQuery,
  PurchaseRecognitionPayload,
} from "./purchase-recognition.schema";
import { PaginationParams } from "../../../platform/http/pagination";
import { PurchaseRecognitionCrudService } from "./purchase-recognition-crud.service";
import { PurchaseRecognitionCsvService } from "./purchase-recognition-csv.service";
import { PurchaseRecognitionPdfService } from "./purchase-recognition-pdf.service";
import { NotFoundError } from "../../../platform/http/http-error";
import { SortQuery } from "../../../platform/http/sort";

// Item10: sales-invoice.service.tsと同じファサード構成。mail/OTPダウンロード機能は
// 承認済み実装計画により対象外のため、その2機能に相当するサブサービスは持たない
export class PurchaseRecognitionService {
  private crud: PurchaseRecognitionCrudService;
  private csv: PurchaseRecognitionCsvService;
  private pdf: PurchaseRecognitionPdfService;
  private repo: PurchaseRecognitionRepository;

  constructor(repo: PurchaseRecognitionRepository) {
    this.repo = repo;
    this.crud = new PurchaseRecognitionCrudService(repo);
    this.csv = new PurchaseRecognitionCsvService(repo);
    this.pdf = new PurchaseRecognitionPdfService(repo);
  }

  // --- 検索/CRUD ---
  searchRecognitions(c: Context, query: SearchPurchaseRecognitionsQuery, sort?: SortQuery) {
    return this.crud.searchRecognitions(c, query, sort);
  }

  searchRecognitionsPage(
    c: Context,
    query: SearchPurchaseRecognitionsQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    return this.crud.searchRecognitionsPage(c, query, params, sort);
  }

  getRecognitionDetail(c: Context, id: string) {
    return this.crud.getRecognitionDetail(c, id);
  }

  getOrderRecognitionProgress(c: Context, orderId: string) {
    return this.crud.getOrderRecognitionProgress(c, orderId);
  }

  createRecognition(c: Context, formData: FormData, body: PurchaseRecognitionPayload) {
    return this.crud.createRecognition(c, formData, body);
  }

  updateRecognition(c: Context, id: string, formData: FormData, body: PurchaseRecognitionPayload) {
    return this.crud.updateRecognition(c, id, formData, body);
  }

  deleteRecognition(c: Context, id: string) {
    return this.crud.deleteRecognition(c, id);
  }

  performRecognitionDeletion(c: Context, id: string, knownSnapshot?: any) {
    return this.crud.performRecognitionDeletion(c, id, knownSnapshot);
  }

  submitForApproval(c: Context, id: string, applicantDepartmentSurrogateId?: string | null) {
    return this.crud.submitForApproval(c, id, applicantDepartmentSurrogateId);
  }

  requestRecognitionDeletion(c: Context, id: string) {
    return this.crud.requestRecognitionDeletion(c, id);
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

  // --- 添付ファイルダウンロード(認証済みルートのみ。OTP公開ダウンロードは対象外) ---
  async getDownloadStream(id: string, attachmentId: string) {
    const attachment = await this.repo.findAttachmentByIdAndRecognitionId(attachmentId, id);
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("指定されたファイルレコードが見つかりません");
    }
    return { attachment };
  }
}
