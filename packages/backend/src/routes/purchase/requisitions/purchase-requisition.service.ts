import { Context } from "hono";
import { PurchaseRequisitionRepository } from "./purchase-requisition.repository";
import {
  SearchPurchaseRequisitionsQuery,
  PurchaseRequisitionPayload,
} from "./purchase-requisition.schema";
import { PaginationParams } from "../../../platform/http/pagination";
import { PurchaseRequisitionCrudService } from "./purchase-requisition-crud.service";
import { PurchaseRequisitionCsvService } from "./purchase-requisition-csv.service";
import { NotFoundError } from "../../../platform/http/http-error";
import { SortQuery } from "../../../platform/http/sort";

// quote.service.tsと同じ方針。薄いファサードとして残し、index.ts・
// workflow-engine/target-adapters/purchase-requisitions.adapter.tsからの呼び出し方を一切変更しない
export class PurchaseRequisitionService {
  private crud: PurchaseRequisitionCrudService;
  private csv: PurchaseRequisitionCsvService;
  private repo: PurchaseRequisitionRepository;

  constructor(repo: PurchaseRequisitionRepository) {
    this.repo = repo;
    this.crud = new PurchaseRequisitionCrudService(repo);
    this.csv = new PurchaseRequisitionCsvService(repo);
  }

  searchRequisitions(c: Context, query: SearchPurchaseRequisitionsQuery, sort?: SortQuery) {
    return this.crud.searchRequisitions(c, query, sort);
  }

  searchRequisitionsPage(
    c: Context,
    query: SearchPurchaseRequisitionsQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    return this.crud.searchRequisitionsPage(c, query, params, sort);
  }

  getRequisitionDetail(c: Context, id: string) {
    return this.crud.getRequisitionDetail(c, id);
  }

  createRequisition(c: Context, formData: FormData, body: PurchaseRequisitionPayload) {
    return this.crud.createRequisition(c, formData, body);
  }

  updateRequisition(
    c: Context,
    id: string,
    formData: FormData,
    body: PurchaseRequisitionPayload,
  ) {
    return this.crud.updateRequisition(c, id, formData, body);
  }

  deleteRequisition(c: Context, id: string) {
    return this.crud.deleteRequisition(c, id);
  }

  performRequisitionDeletion(c: Context, id: string, knownSnapshot?: any) {
    return this.crud.performRequisitionDeletion(c, id, knownSnapshot);
  }

  submitForApproval(
    c: Context,
    id: string,
    applicantDepartmentSurrogateId?: string | null,
  ) {
    return this.crud.submitForApproval(c, id, applicantDepartmentSurrogateId);
  }

  requestRequisitionDeletion(c: Context, id: string) {
    return this.crud.requestRequisitionDeletion(c, id);
  }

  exportCsv(c: Context) {
    return this.csv.exportCsv(c);
  }

  bulkImportCsv(c: Context, file: File) {
    return this.csv.bulkImportCsv(c, file);
  }

  async getDownloadStream(id: string, attachmentId: string) {
    const attachment = await this.repo.findAttachmentByIdAndRequisitionId(
      attachmentId,
      id,
    );
    if (!attachment || !attachment.attachmentR2Path) {
      throw new NotFoundError("対象の添付ファイルが見つかりません");
    }
    return { attachment };
  }
}
