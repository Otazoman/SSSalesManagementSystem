import { Context } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { AuditsRepository, AuditRecord } from "./audits.repository";
import { CreateAuditInput, GetAuditsQuery, createAuditSchema } from "./audits.schema";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { StockRepository, StockKey } from "../stocks/stocks.repository";
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
import { isInventoryAdjustmentWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "inventory_audit";

export class AuditsService {
  constructor(private repo: AuditsRepository) {}

  async listAudits(searchParams: GetAuditsQuery, params: PaginationParams, sort?: SortQuery) {
    const [data, total] = await Promise.all([
      this.repo.findPage(searchParams, params, sort),
      this.repo.countAll(searchParams),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async getAuditDetail(id: string) {
    const audit = await this.repo.findById(id);
    if (!audit) throw new NotFoundError("対象の棚卸が見つかりません");
    return audit;
  }

  // 棚卸履歴のCSV出力(検索条件に一致する全件)
  // 一括登録CSV(bulkImportCsv)が読み取る列(itemId〜memo)を先頭に同じ順序で並べ、
  // そのまま再インポート可能な形にする。id/status/createdBy/createdAt/理論値/差異は
  // インポートでは使われない参照専用の列として末尾に付け足す
  async generateCsv(searchParams: GetAuditsQuery) {
    const rows = await this.repo.findAllForCsv(searchParams);
    const headers = [
      "itemId",
      "warehouseId",
      "locationId",
      "lotNumber",
      "accountCode",
      "qualityStatus",
      "countedQuantity",
      "memo",
      "id",
      "status",
      "createdBy",
      "createdAt",
      "theoreticalQuantity",
      "differenceQuantity",
    ];
    const csvRows = rows.map((r: any) =>
      [
        csvField(r.itemId),
        csvField(r.warehouseId),
        csvField(r.locationId),
        csvField(r.lotNumber),
        csvField(r.accountCode),
        csvField(r.qualityStatus),
        csvField(r.countedQuantity),
        csvField(r.memo),
        csvField(r.id),
        csvField(r.status),
        csvField(r.createdBy),
        csvField(r.createdAt ? new Date(r.createdAt).toISOString() : ""),
        csvField(r.theoreticalQuantity),
        csvField(r.differenceQuantity),
      ].join(","),
    );
    return withBom(buildCsvContent(headers, csvRows));
  }

  // CSV一括登録: generateCsv()が出力した形式をそのまま再取込できる。1行=1棚卸として
  // createAudit()をループ呼び出しすることで、品目/倉庫/ロケーション検証・承認要否判定・
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
    const idxCountedQuantity = header.indexOf("countedQuantity");
    const idxMemo = header.indexOf("memo");

    if (
      idxItemId === -1 ||
      idxWarehouseId === -1 ||
      idxLocationId === -1 ||
      idxCountedQuantity === -1
    ) {
      throw new BadRequestError(
        "CSVに必要な列(itemId, warehouseId, locationId, countedQuantity)がありません",
      );
    }

    const dataRows = allRows.slice(1);
    let importedCount = 0;
    let lastAuditId = "";
    for (const cols of dataRows) {
      const input = v.parse(createAuditSchema, {
        itemId: cols[idxItemId],
        warehouseId: cols[idxWarehouseId],
        locationId: cols[idxLocationId],
        lotNumber: idxLotNumber !== -1 ? cols[idxLotNumber] || "NONE" : "NONE",
        accountCode: idxAccountCode !== -1 ? cols[idxAccountCode] || null : null,
        qualityStatus: idxQualityStatus !== -1 ? cols[idxQualityStatus] || "NORMAL" : "NORMAL",
        countedQuantity: Number(cols[idxCountedQuantity]),
        memo: idxMemo !== -1 ? cols[idxMemo] || null : null,
      });

      const result = await this.createAudit(c, input);
      importedCount += 1;
      lastAuditId = result.auditId;
    }

    return {
      success: true,
      message: `CSVから ${importedCount} 件の棚卸を登録しました`,
      auditId: lastAuditId,
    };
  }

  // createAudit/resubmitAuditの両方から呼ぶ共通の対象解決ロジック。
  // 商品/倉庫/ロケーション/勘定科目を検証し、既存在庫があれば理論数量を、無ければ0を返す
  private async resolveAuditTarget(
    c: Context<{ Bindings: Env }>,
    input: CreateAuditInput,
  ): Promise<{ record: AuditRecord }> {
    const productsRepo = new ProductsRepository(c.env.DB);
    const warehousesRepo = new WarehousesRepository(c.env.DB);
    const locationsRepo = new LocationsRepository(c.env.DB);
    const accountsRepo = new AccountsRepository(c.env.DB);
    const db = createDb(c.env.DB);
    const stockRepo = StockRepository.fromDb(db);

    const product = await productsRepo.findProductById(input.itemId);
    if (!product) throw new NotFoundError(`品目が見つかりません: ${input.itemId}`);

    const warehouse = await warehousesRepo.findById(input.warehouseId);
    if (!warehouse) throw new NotFoundError(`倉庫が見つかりません: ${input.warehouseId}`);

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
    const qualityStatus = input.qualityStatus || "NORMAL";

    const key: StockKey = {
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      locationId: input.locationId,
      lotNumber,
      accountCode,
      qualityStatus,
    };
    const stockRow = await stockRepo.findStockByKey(key);
    const theoreticalQuantity = stockRow?.quantity ?? 0;

    return {
      record: {
        id: "", // 呼び出し側でセットする
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        locationId: input.locationId,
        lotNumber,
        accountCode,
        qualityStatus,
        theoreticalQuantity,
        countedQuantity: input.countedQuantity,
        differenceQuantity: input.countedQuantity - theoreticalQuantity,
        memo: input.memo || null,
        qrCodeKey: null,
      },
    };
  }

  async createAudit(c: Context<{ Bindings: Env }>, input: CreateAuditInput) {
    const db = createDb(c.env.DB);
    const { record } = await this.resolveAuditTarget(c, input);

    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const auditId = await resolveConfiguredDocumentId(
      c,
      "audit",
      (id) => this.repo.findById(id).then((r) => !!r),
      null,
    );
    const now = new Date();
    record.id = auditId;

    await this.repo.createAudit(auditId, record, "UNAPPROVED", operatorId, now);

    const wfEnabled = await isInventoryAdjustmentWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.updateStatus(auditId, "APPROVED");
      const stocksService = StocksService.fromDb(db);
      await stocksService.applyAdjustment(
        {
          itemId: record.itemId,
          warehouseId: record.warehouseId,
          locationId: record.locationId,
          lotNumber: record.lotNumber,
          accountCode: record.accountCode,
          qualityStatus: record.qualityStatus,
          differenceQuantity: record.differenceQuantity,
        },
        auditId,
        operatorId,
        now,
      );

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_STOCK_AUDIT_DIRECT", RESOURCE_KEY, auditId, null, {
          status: "APPROVED",
          differenceQuantity: record.differenceQuantity,
          memo: record.memo,
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、棚卸を確定しました",
        auditId,
      };
    }

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: "inventory_audit",
      targetId: auditId,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: 0,
      comment: `棚卸[${auditId}]の承認申請`,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      await this.repo.deleteAudit(auditId);
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `棚卸[${auditId}]の承認申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_STOCK_AUDIT_FOR_APPROVAL", RESOURCE_KEY, auditId, null, {
        status: "UNAPPROVED",
        differenceQuantity: record.differenceQuantity,
        memo: record.memo,
      }),
    );

    return {
      success: true,
      message: "棚卸の承認を申請しました",
      auditId,
    };
  }

  // 修正して再提出: 差戻し(REMANDED)された棚卸を、新規レコードを作らず同じidのまま
  // 内容を書き換えて再申請する。WorkflowEngine.startWorkflow()は同一targetIdの既存
  // PENDING/REMANDED申請を自動でSUPERSEDEDにする仕組みを持つため、それをそのまま利用する
  async resubmitAudit(c: Context<{ Bindings: Env }>, auditId: string, input: CreateAuditInput) {
    const db = createDb(c.env.DB);
    const existing = await this.repo.findById(auditId);
    if (!existing) throw new NotFoundError("対象の棚卸が見つかりません");
    if (existing.status !== "REMANDED") {
      throw new BadRequestError("差戻し状態の棚卸のみ修正して再申請できます");
    }

    const { record } = await this.resolveAuditTarget(c, input);
    record.id = auditId;
    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const now = new Date();

    const wfEnabled = await isInventoryAdjustmentWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.updateAudit(auditId, record, "APPROVED");
      const stocksService = StocksService.fromDb(db);
      await stocksService.applyAdjustment(
        {
          itemId: record.itemId,
          warehouseId: record.warehouseId,
          locationId: record.locationId,
          lotNumber: record.lotNumber,
          accountCode: record.accountCode,
          qualityStatus: record.qualityStatus,
          differenceQuantity: record.differenceQuantity,
        },
        auditId,
        operatorId,
        now,
      );

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_STOCK_AUDIT_DIRECT", RESOURCE_KEY, auditId, null, {
          status: "APPROVED",
          differenceQuantity: record.differenceQuantity,
          memo: record.memo,
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、棚卸を確定しました",
        auditId,
      };
    }

    await this.repo.updateAudit(auditId, record, "UNAPPROVED");

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: "inventory_audit",
      targetId: auditId,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: 0,
      comment: `棚卸[${auditId}]の再申請`,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `棚卸[${auditId}]の再申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "RESUBMIT_STOCK_AUDIT_FOR_APPROVAL", RESOURCE_KEY, auditId, null, {
        status: "UNAPPROVED",
        differenceQuantity: record.differenceQuantity,
        memo: record.memo,
      }),
    );

    return {
      success: true,
      message: "棚卸の再申請しました",
      auditId,
    };
  }
}
