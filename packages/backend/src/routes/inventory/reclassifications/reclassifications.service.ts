import { Context } from "hono";
import { Env } from "../../../types/env";
import { ReclassificationsRepository } from "./reclassifications.repository";
import { CreateReclassificationInput } from "./reclassifications.schema";
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
import { isDamageWorkflowGloballyEnabled } from "../../../workflow-engine/settings";

// targetTypeは入出庫と同じ"inventory_stock"を共有する(inventory-stock.adapter.tsのprobe対象に
// reclassificationsを追加済み)。新しい承認フロー設定を管理者に追加させないための設計判断。
const TARGET_TYPE = "inventory_stock";
const RESOURCE_KEY = "inventory_stock";

export class ReclassificationsService {
  constructor(private repo: ReclassificationsRepository) {}

  async getDetail(id: string) {
    const record = await this.repo.findById(id);
    if (!record) throw new NotFoundError("対象の品質区分変更が見つかりません");
    return record;
  }

  // createReclassification/resubmitReclassificationの両方から呼ぶ共通の対象解決ロジック
  private async resolveReclassificationRecord(
    c: Context<{ Bindings: Env }>,
    input: CreateReclassificationInput,
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
        "外部倉庫の品質区分変更は現在このAPIでは扱えません(対応は今後実装予定です)",
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
      fromQualityStatus: input.fromQualityStatus,
      toQualityStatus: input.toQualityStatus,
      quantity: input.quantity,
      memo: input.memo || null,
    };
  }

  async createReclassification(c: Context<{ Bindings: Env }>, input: CreateReclassificationInput) {
    const db = createDb(c.env.DB);
    const record = await this.resolveReclassificationRecord(c, input);

    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const reclassificationId = await resolveConfiguredDocumentId(
      c,
      "reclassification",
      (id) => this.repo.findById(id).then((r) => !!r),
      null,
    );
    const now = new Date();

    await this.repo.createReclassification(reclassificationId, record, "UNAPPROVED", operatorId, now);

    const wfEnabled = await isDamageWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.updateStatus(reclassificationId, "APPROVED");
      const stocksService = StocksService.fromDb(db);
      await stocksService.applyReclassification(record, reclassificationId, operatorId, now);

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_STOCK_RECLASSIFICATION_DIRECT", RESOURCE_KEY, reclassificationId, null, {
          status: "APPROVED",
          fromQualityStatus: record.fromQualityStatus,
          toQualityStatus: record.toQualityStatus,
          quantity: record.quantity,
          memo: record.memo,
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、品質区分変更を確定しました",
        reclassificationId,
      };
    }

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: TARGET_TYPE,
      targetId: reclassificationId,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: 0,
      comment: `品質区分変更[${reclassificationId}]の承認申請`,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      await this.repo.deleteReclassification(reclassificationId);
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `品質区分変更[${reclassificationId}]の承認申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_STOCK_RECLASSIFICATION_FOR_APPROVAL", RESOURCE_KEY, reclassificationId, null, {
        status: "UNAPPROVED",
        fromQualityStatus: record.fromQualityStatus,
        toQualityStatus: record.toQualityStatus,
        quantity: record.quantity,
        memo: record.memo,
      }),
    );

    return {
      success: true,
      message: "品質区分変更の承認を申請しました",
      reclassificationId,
    };
  }

  // 修正して再提出: 差戻し(REMANDED)された品質区分変更を、新規レコードを作らず同じidのまま
  // 内容を書き換えて再申請する。WorkflowEngine.startWorkflow()は同一targetIdの既存
  // PENDING/REMANDED申請を自動でSUPERSEDEDにする仕組みを持つため、それをそのまま利用する
  async resubmitReclassification(
    c: Context<{ Bindings: Env }>,
    reclassificationId: string,
    input: CreateReclassificationInput,
  ) {
    const db = createDb(c.env.DB);
    const existing = await this.repo.findById(reclassificationId);
    if (!existing) throw new NotFoundError("対象の品質区分変更が見つかりません");
    if (existing.status !== "REMANDED") {
      throw new BadRequestError("差戻し状態の品質区分変更のみ修正して再申請できます");
    }

    const record = await this.resolveReclassificationRecord(c, input);
    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const now = new Date();

    const wfEnabled = await isDamageWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.updateReclassification(reclassificationId, record, "APPROVED");
      const stocksService = StocksService.fromDb(db);
      await stocksService.applyReclassification(record, reclassificationId, operatorId, now);

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_STOCK_RECLASSIFICATION_DIRECT", RESOURCE_KEY, reclassificationId, null, {
          status: "APPROVED",
          fromQualityStatus: record.fromQualityStatus,
          toQualityStatus: record.toQualityStatus,
          quantity: record.quantity,
          memo: record.memo,
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、品質区分変更を確定しました",
        reclassificationId,
      };
    }

    await this.repo.updateReclassification(reclassificationId, record, "UNAPPROVED");

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: TARGET_TYPE,
      targetId: reclassificationId,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: 0,
      comment: `品質区分変更[${reclassificationId}]の再申請`,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `品質区分変更[${reclassificationId}]の再申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "RESUBMIT_STOCK_RECLASSIFICATION_FOR_APPROVAL", RESOURCE_KEY, reclassificationId, null, {
        status: "UNAPPROVED",
        fromQualityStatus: record.fromQualityStatus,
        toQualityStatus: record.toQualityStatus,
        quantity: record.quantity,
        memo: record.memo,
      }),
    );

    return {
      success: true,
      message: "品質区分変更の再申請しました",
      reclassificationId,
    };
  }
}
