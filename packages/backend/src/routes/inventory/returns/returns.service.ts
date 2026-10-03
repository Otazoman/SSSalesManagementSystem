import { Context } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { ReturnsRepository, ReturnRecord } from "./returns.repository";
import { CreateReturnInput, GetReturnsQuery, createReturnSchema } from "./returns.schema";
import { parseCsv } from "../../../platform/csv/csv-parser";
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
import { isReturnWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { SortQuery } from "../../../platform/http/sort";

// targetTypeは入出庫と同じ"inventory_stock"を共有する(inventory-stock.adapter.tsのprobe対象に
// returnsを追加済み)。新しい承認フロー設定を管理者に追加させないための設計判断。
const TARGET_TYPE = "inventory_stock";
const RESOURCE_KEY = "inventory_stock";

export class ReturnsService {
  constructor(private repo: ReturnsRepository) {}

  async listReturns(searchParams: GetReturnsQuery, params: PaginationParams, sort?: SortQuery) {
    const [data, total] = await Promise.all([
      this.repo.findPage(searchParams, params, sort),
      this.repo.countAll(searchParams),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async getDetail(id: string) {
    const record = await this.repo.findById(id);
    if (!record) throw new NotFoundError("対象の返品が見つかりません");
    return record;
  }

  // 返品履歴のCSV出力(検索条件に一致する全件)。bulkImportCsv()が読み取る列(itemId〜returnDate)を
  // 先頭に同じ順序で並べ、そのまま再インポート可能な形にする(audits.service.tsと同型)
  async generateCsv(searchParams: GetReturnsQuery) {
    const rows = await this.repo.findAllForCsv(searchParams);
    const headers = [
      "itemId",
      "warehouseId",
      "locationId",
      "lotNumber",
      "accountCode",
      "qualityStatus",
      "direction",
      "quantity",
      "returnReason",
      "returnDate",
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
        csvField(r.direction),
        csvField(r.quantity),
        csvField(r.returnReason),
        csvField(r.returnDate ? new Date(r.returnDate).toISOString() : ""),
        csvField(r.memo),
        csvField(r.id),
        csvField(r.status),
        csvField(r.createdBy),
        csvField(r.createdAt ? new Date(r.createdAt).toISOString() : ""),
      ].join(","),
    );
    return withBom(buildCsvContent(headers, csvRows));
  }

  // CSV一括登録: generateCsv()が出力した形式をそのまま再取込できる。1行=1返品として
  // createReturn()をループ呼び出しすることで、品目/倉庫/ロケーション検証・承認要否判定・
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
    const idxDirection = header.indexOf("direction");
    const idxQuantity = header.indexOf("quantity");
    const idxReturnReason = header.indexOf("returnReason");
    const idxReturnDate = header.indexOf("returnDate");
    const idxMemo = header.indexOf("memo");

    if (
      idxItemId === -1 ||
      idxWarehouseId === -1 ||
      idxLocationId === -1 ||
      idxDirection === -1 ||
      idxQuantity === -1 ||
      idxReturnDate === -1
    ) {
      throw new BadRequestError(
        "CSVに必要な列(itemId, warehouseId, locationId, direction, quantity, returnDate)がありません",
      );
    }

    const dataRows = allRows.slice(1);
    let importedCount = 0;
    let lastReturnId = "";
    for (const cols of dataRows) {
      const input = v.parse(createReturnSchema, {
        itemId: cols[idxItemId],
        warehouseId: cols[idxWarehouseId],
        locationId: cols[idxLocationId],
        lotNumber: idxLotNumber !== -1 ? cols[idxLotNumber] || "NONE" : "NONE",
        accountCode: idxAccountCode !== -1 ? cols[idxAccountCode] || null : null,
        qualityStatus: idxQualityStatus !== -1 ? cols[idxQualityStatus] || "NORMAL" : "NORMAL",
        direction: cols[idxDirection],
        quantity: Number(cols[idxQuantity]),
        returnReason: idxReturnReason !== -1 ? cols[idxReturnReason] || null : null,
        returnDate: cols[idxReturnDate],
        memo: idxMemo !== -1 ? cols[idxMemo] || null : null,
      });

      const result = await this.createReturn(c, input);
      importedCount += 1;
      lastReturnId = result.returnId;
    }

    return {
      success: true,
      message: `CSVから ${importedCount} 件の返品を登録しました`,
      returnId: lastReturnId,
    };
  }

  // createReturn/resubmitReturnの両方から呼ぶ共通の対象解決ロジック
  private async resolveReturnRecord(
    c: Context<{ Bindings: Env }>,
    input: CreateReturnInput,
  ): Promise<ReturnRecord> {
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
        "外部倉庫の返品は現在このAPIでは扱えません(対応は今後実装予定です)",
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

    const returnDate = new Date(input.returnDate);
    if (Number.isNaN(returnDate.getTime())) {
      throw new BadRequestError("返品日の形式が不正です");
    }

    const lotNumber = input.lotNumber || "NONE";
    return {
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      locationId: input.locationId,
      lotNumber,
      accountCode,
      qualityStatus: input.qualityStatus || "NORMAL",
      direction: input.direction,
      quantity: input.quantity,
      returnReason: input.returnReason || null,
      returnDate,
      memo: input.memo || null,
    };
  }

  async createReturn(c: Context<{ Bindings: Env }>, input: CreateReturnInput) {
    const db = createDb(c.env.DB);
    const record = await this.resolveReturnRecord(c, input);

    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const returnId = await resolveConfiguredDocumentId(
      c,
      "return",
      (id) => this.repo.findById(id).then((r) => !!r),
      null,
    );
    const now = new Date();

    await this.repo.createReturn(returnId, record, "UNAPPROVED", operatorId, now);

    const wfEnabled = await isReturnWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.updateStatus(returnId, "APPROVED");
      const stocksService = StocksService.fromDb(db);
      await stocksService.applyReturn(record, returnId, operatorId, now);

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_STOCK_RETURN_DIRECT", RESOURCE_KEY, returnId, null, {
          status: "APPROVED",
          direction: record.direction,
          quantity: record.quantity,
          memo: record.memo,
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、返品を確定しました",
        returnId,
      };
    }

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: TARGET_TYPE,
      targetId: returnId,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: 0,
      comment: `返品[${returnId}]の承認申請`,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      await this.repo.deleteReturn(returnId);
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `返品[${returnId}]の承認申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_STOCK_RETURN_FOR_APPROVAL", RESOURCE_KEY, returnId, null, {
        status: "UNAPPROVED",
        direction: record.direction,
        quantity: record.quantity,
        memo: record.memo,
      }),
    );

    return {
      success: true,
      message: "返品の承認を申請しました",
      returnId,
    };
  }

  // 修正して再提出: 差戻し(REMANDED)された返品を、新規レコードを作らず同じidのまま
  // 内容を書き換えて再申請する。WorkflowEngine.startWorkflow()は同一targetIdの既存
  // PENDING/REMANDED申請を自動でSUPERSEDEDにする仕組みを持つため、それをそのまま利用する
  async resubmitReturn(c: Context<{ Bindings: Env }>, returnId: string, input: CreateReturnInput) {
    const db = createDb(c.env.DB);
    const existing = await this.repo.findById(returnId);
    if (!existing) throw new NotFoundError("対象の返品が見つかりません");
    if (existing.status !== "REMANDED") {
      throw new BadRequestError("差戻し状態の返品のみ修正して再申請できます");
    }

    const record = await this.resolveReturnRecord(c, input);
    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const now = new Date();

    const wfEnabled = await isReturnWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.updateReturn(returnId, record, "APPROVED");
      const stocksService = StocksService.fromDb(db);
      await stocksService.applyReturn(record, returnId, operatorId, now);

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_STOCK_RETURN_DIRECT", RESOURCE_KEY, returnId, null, {
          status: "APPROVED",
          direction: record.direction,
          quantity: record.quantity,
          memo: record.memo,
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、返品を確定しました",
        returnId,
      };
    }

    await this.repo.updateReturn(returnId, record, "UNAPPROVED");

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: TARGET_TYPE,
      targetId: returnId,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: 0,
      comment: `返品[${returnId}]の再申請`,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `返品[${returnId}]の再申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "RESUBMIT_STOCK_RETURN_FOR_APPROVAL", RESOURCE_KEY, returnId, null, {
        status: "UNAPPROVED",
        direction: record.direction,
        quantity: record.quantity,
        memo: record.memo,
      }),
    );

    return {
      success: true,
      message: "返品の再申請しました",
      returnId,
    };
  }
}
