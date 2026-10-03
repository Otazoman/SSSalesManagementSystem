import { Context } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { DisposalsRepository } from "./disposals.repository";
import { CreateDisposalInput, GetDisposalsQuery, createDisposalSchema } from "./disposals.schema";
import { StocksService } from "../stocks/stocks.service";
import { ProductsRepository } from "../../master/products/products.repository";
import { WarehousesRepository } from "../../master/warehouses/warehouses.repository";
import { LocationsRepository } from "../../master/locations/locations.repository";
import { AccountsRepository } from "../../master/accounts/accounts.repository";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { getSession } from "../../../platform/auth/get-session";
import { createDb } from "../../../platform/db/create-db";
import { WorkflowEngine } from "../../../workflow-engine/engine";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { notifyApprovalRequestSubmitted } from "../../../workflow-engine/notifier";
import { isDisposalWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { SortQuery } from "../../../platform/http/sort";

// targetTypeは入出庫と同じ"inventory_stock"を共有する(inventory-stock.adapter.tsのprobe対象に
// disposalsを追加済み)。新しい承認フロー設定を管理者に追加させないための設計判断。
const TARGET_TYPE = "inventory_stock";
const RESOURCE_KEY = "inventory_stock";

export class DisposalsService {
  constructor(private repo: DisposalsRepository) {}

  async getDetail(id: string) {
    const record = await this.repo.findById(id);
    if (!record) throw new NotFoundError("対象の廃棄が見つかりません");
    return record;
  }

  async listDisposals(searchParams: GetDisposalsQuery, params: PaginationParams, sort?: SortQuery) {
    const [data, total] = await Promise.all([
      this.repo.findPage(searchParams, params, sort),
      this.repo.countAll(searchParams),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  // 廃棄履歴のCSV出力(検索条件に一致する全件)。bulkImportCsv()が読み取る列(itemId〜memo)を
  // 先頭に同じ順序で並べ、そのまま再インポート可能な形にする(audits.service.tsと同型)
  async generateCsv(searchParams: GetDisposalsQuery) {
    const rows = await this.repo.findAllForCsv(searchParams);
    const headers = [
      "itemId",
      "warehouseId",
      "locationId",
      "lotNumber",
      "accountCode",
      "qualityStatus",
      "quantity",
      "memo",
      "id",
      "status",
      "createdBy",
      "createdAt",
    ];
    const csvRows = rows.map((r: any) =>
      [
        csvField(r.itemId),
        csvField(r.warehouseId),
        csvField(r.locationId),
        csvField(r.lotNumber),
        csvField(r.accountCode),
        csvField(r.qualityStatus),
        csvField(r.quantity),
        csvField(r.memo),
        csvField(r.id),
        csvField(r.status),
        csvField(r.createdBy),
        csvField(r.createdAt ? new Date(r.createdAt).toISOString() : ""),
      ].join(","),
    );
    return withBom(buildCsvContent(headers, csvRows));
  }

  // CSV一括登録: generateCsv()が出力した形式をそのまま再取込できる。1行=1廃棄として
  // createDisposal()をループ呼び出しすることで、品目/倉庫/ロケーション検証・承認要否判定・
  // 在庫反映等のロジックを再利用する
  async bulkImportCsv(c: Context<{ Bindings: Env }>, csvData: string) {
    const allRows = parseCsv(csvData);
    if (allRows.length <= 1) {
      throw new BadRequestError("CSVにデータ行が含まれていません");
    }

    const header = allRows[0].map((h) => h.trim());
    const idxItemId = header.indexOf("itemId");
    const idxWarehouseId = header.indexOf("warehouseId");
    const idxLocationId = header.indexOf("locationId");
    const idxLotNumber = header.indexOf("lotNumber");
    const idxAccountCode = header.indexOf("accountCode");
    const idxQualityStatus = header.indexOf("qualityStatus");
    const idxQuantity = header.indexOf("quantity");
    const idxMemo = header.indexOf("memo");

    if (idxItemId === -1 || idxWarehouseId === -1 || idxLocationId === -1 || idxQuantity === -1) {
      throw new BadRequestError(
        "CSVに必要な列(itemId, warehouseId, locationId, quantity)がありません",
      );
    }

    const dataRows = allRows.slice(1);
    let importedCount = 0;
    let lastDisposalId = "";
    for (const cols of dataRows) {
      const input = v.parse(createDisposalSchema, {
        itemId: cols[idxItemId],
        warehouseId: cols[idxWarehouseId],
        locationId: cols[idxLocationId],
        lotNumber: idxLotNumber !== -1 ? cols[idxLotNumber] || "NONE" : "NONE",
        accountCode: idxAccountCode !== -1 ? cols[idxAccountCode] || null : null,
        qualityStatus: idxQualityStatus !== -1 ? cols[idxQualityStatus] || "NORMAL" : "NORMAL",
        quantity: Number(cols[idxQuantity]),
        memo: idxMemo !== -1 ? cols[idxMemo] || null : null,
      });

      const result = await this.createDisposal(c, input);
      importedCount += 1;
      lastDisposalId = result.disposalId;
    }

    return {
      success: true,
      message: `CSVから ${importedCount} 件の廃棄を登録しました`,
      disposalId: lastDisposalId,
    };
  }

  // createDisposal/resubmitDisposalの両方から呼ぶ共通の対象解決ロジック
  private async resolveDisposalRecord(
    c: Context<{ Bindings: Env }>,
    input: CreateDisposalInput,
  ) {
    const productsRepo = new ProductsRepository(c.env.DB);
    const warehousesRepo = new WarehousesRepository(c.env.DB);
    const locationsRepo = new LocationsRepository(c.env.DB);
    const accountsRepo = new AccountsRepository(c.env.DB);

    const product = await productsRepo.findProductById(input.itemId);
    if (!product) throw new NotFoundError(`品目が見つかりません: ${input.itemId}`);

    const warehouse = await warehousesRepo.findById(input.warehouseId);
    if (!warehouse) throw new NotFoundError(`倉庫が見つかりません: ${input.warehouseId}`);
    if (warehouse.warehouseType === "EXTERNAL") {
      throw new BadRequestError(
        "外部倉庫の廃棄は現在このAPIでは扱えません(対応は今後実装予定です)",
      );
    }

    const location = await locationsRepo.findById(input.locationId);
    if (!location) throw new NotFoundError(`ロケーションが見つかりません: ${input.locationId}`);

    const accountCode = input.accountCode || product.accountCode;
    if (!accountCode) {
      throw new BadRequestError(
        `勘定科目コードを解決できません(品目:${input.itemId})。品目マスタに規定の勘定科目が未設定の場合は明示的に指定してください`,
      );
    }
    const account = await accountsRepo.findByCode(accountCode);
    if (!account) throw new NotFoundError(`勘定科目が見つかりません: ${accountCode}`);

    const lotNumber = input.lotNumber || "NONE";
    return {
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      locationId: input.locationId,
      lotNumber,
      accountCode,
      qualityStatus: input.qualityStatus || "NORMAL",
      quantity: input.quantity,
      memo: input.memo || null,
    };
  }

  async createDisposal(c: Context<{ Bindings: Env }>, input: CreateDisposalInput) {
    const db = createDb(c.env.DB);
    const record = await this.resolveDisposalRecord(c, input);

    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const disposalId = await resolveConfiguredDocumentId(
      c,
      "disposal",
      (id) => this.repo.findById(id).then((r) => !!r),
      null,
    );
    const now = new Date();

    await this.repo.createDisposal(disposalId, record, "UNAPPROVED", operatorId, now);

    const wfEnabled = await isDisposalWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.updateStatus(disposalId, "APPROVED");
      const stocksService = StocksService.fromDb(db);
      await stocksService.applyDisposal(record, disposalId, operatorId, now);

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_STOCK_DISPOSAL_DIRECT", RESOURCE_KEY, disposalId, null, {
          status: "APPROVED",
          qualityStatus: record.qualityStatus,
          quantity: record.quantity,
          memo: record.memo,
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、廃棄を確定しました",
        disposalId,
      };
    }

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: TARGET_TYPE,
      targetId: disposalId,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: 0,
      comment: `廃棄[${disposalId}]の承認申請`,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      await this.repo.deleteDisposal(disposalId);
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `廃棄[${disposalId}]の承認申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_STOCK_DISPOSAL_FOR_APPROVAL", RESOURCE_KEY, disposalId, null, {
        status: "UNAPPROVED",
        qualityStatus: record.qualityStatus,
        quantity: record.quantity,
        memo: record.memo,
      }),
    );

    return {
      success: true,
      message: "廃棄の承認を申請しました",
      disposalId,
    };
  }

  // 修正して再提出: 差戻し(REMANDED)された廃棄を、新規レコードを作らず同じidのまま
  // 内容を書き換えて再申請する。WorkflowEngine.startWorkflow()は同一targetIdの既存
  // PENDING/REMANDED申請を自動でSUPERSEDEDにする仕組みを持つため、それをそのまま利用する
  async resubmitDisposal(
    c: Context<{ Bindings: Env }>,
    disposalId: string,
    input: CreateDisposalInput,
  ) {
    const db = createDb(c.env.DB);
    const existing = await this.repo.findById(disposalId);
    if (!existing) throw new NotFoundError("対象の廃棄が見つかりません");
    if (existing.status !== "REMANDED") {
      throw new BadRequestError("差戻し状態の廃棄のみ修正して再申請できます");
    }

    const record = await this.resolveDisposalRecord(c, input);
    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const now = new Date();

    const wfEnabled = await isDisposalWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.updateDisposal(disposalId, record, "APPROVED");
      const stocksService = StocksService.fromDb(db);
      await stocksService.applyDisposal(record, disposalId, operatorId, now);

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_STOCK_DISPOSAL_DIRECT", RESOURCE_KEY, disposalId, null, {
          status: "APPROVED",
          qualityStatus: record.qualityStatus,
          quantity: record.quantity,
          memo: record.memo,
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、廃棄を確定しました",
        disposalId,
      };
    }

    await this.repo.updateDisposal(disposalId, record, "UNAPPROVED");

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: TARGET_TYPE,
      targetId: disposalId,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: 0,
      comment: `廃棄[${disposalId}]の再申請`,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `廃棄[${disposalId}]の再申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "RESUBMIT_STOCK_DISPOSAL_FOR_APPROVAL", RESOURCE_KEY, disposalId, null, {
        status: "UNAPPROVED",
        qualityStatus: record.qualityStatus,
        quantity: record.quantity,
        memo: record.memo,
      }),
    );

    return {
      success: true,
      message: "廃棄の再申請しました",
      disposalId,
    };
  }
}
