import { Context } from "hono";
import { Env } from "../../../types/env";
import {
  ReceiptInstructionsRepository,
  ResolvedReceiptInstructionItem,
} from "./receipt-instructions.repository";
import {
  CreateReceiptInstructionInput,
  GetReceiptInstructionsQuery,
} from "./receipt-instructions.schema";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { ProductsRepository } from "../../master/products/products.repository";
import { WarehousesRepository } from "../../master/warehouses/warehouses.repository";
import { AccountsRepository } from "../../master/accounts/accounts.repository";
import { PartnersRepository } from "../../master/partners/partners.repository";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { getSession } from "../../../platform/auth/get-session";
import { createDb } from "../../../platform/db/create-db";
import { WorkflowEngine } from "../../../workflow-engine/engine";
import { notifyApprovalRequestSubmitted } from "../../../workflow-engine/notifier";
import { isReceivingInstructionWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "inventory_instructions";
const TARGET_TYPE = "inventory_instructions";

export class ReceiptInstructionsService {
  constructor(private repo: ReceiptInstructionsRepository) {}

  async listInstructions(
    searchParams: GetReceiptInstructionsQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [data, total] = await Promise.all([
      this.repo.findHeadersPage(searchParams, params, sort),
      this.repo.countHeaders(searchParams),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async getInstructionDetail(id: string) {
    const header = await this.repo.findHeaderById(id);
    if (!header) throw new NotFoundError("対象の入荷指示が見つかりません");
    const items = await this.repo.findItemsByHeaderId(id);
    const itemsWithFulfillment = await this.attachFulfillment(id, items);
    return { header, items: itemsWithFulfillment };
  }

  // 消込状況の可視化用: 明細(品目×ロット)ごとに消込済み数量・残数量を付与する
  private async attachFulfillment<
    T extends { itemId: string; lotNumber: string; instructedQuantity: number },
  >(id: string, items: T[]) {
    const fulfilled = await this.repo.getFulfilledQuantitiesByItem(id);
    const fulfilledMap = new Map(
      fulfilled.map((f) => [`${f.itemId}__${f.lotNumber}`, Number(f.fulfilledQuantity || 0)]),
    );
    return items.map((item) => {
      const fulfilledQuantity = fulfilledMap.get(`${item.itemId}__${item.lotNumber}`) || 0;
      return {
        ...item,
        fulfilledQuantity,
        remainingQuantity: Math.max(item.instructedQuantity - fulfilledQuantity, 0),
      };
    });
  }

  // Item6 Phase6-4: OTPダウンロードページでPDFと一緒に提供する指示データCSV(1指示分のみ)。
  // 一覧CSV(generateCsv)と列構成は同じだが、検索条件ではなくIDで1件に絞る
  async generateCsvForInstruction(id: string) {
    const header = await this.repo.findHeaderById(id);
    if (!header) throw new NotFoundError("対象の入荷指示が見つかりません");
    const items = await this.repo.findItemsByHeaderId(id);

    const headers = [
      "headerId",
      "partnerId",
      "warehouseId",
      "instructedReceiveDate",
      "status",
      "memo",
      "createdBy",
      "createdAt",
      "itemId",
      "lotNumber",
      "instructedQuantity",
      "accountCode",
    ];
    const csvRows = items.map((item: any) =>
      [
        csvField(id),
        csvField(header.partnerId),
        csvField(header.warehouseId),
        csvField(new Date(header.instructedReceiveDate).toISOString().slice(0, 10)),
        csvField(header.status),
        csvField(header.memo),
        csvField(header.createdBy),
        csvField(new Date(header.createdAt).toISOString()),
        csvField(item.itemId),
        csvField(item.lotNumber),
        csvField(item.instructedQuantity),
        csvField(item.accountCode),
      ].join(","),
    );
    return withBom(buildCsvContent(headers, csvRows));
  }

  async generateCsv(searchParams: GetReceiptInstructionsQuery) {
    const rows = await this.repo.findAllForCsv(searchParams);
    const headers = [
      "headerId",
      "partnerId",
      "warehouseId",
      "instructedReceiveDate",
      "status",
      "memo",
      "createdBy",
      "createdAt",
      "itemId",
      "lotNumber",
      "instructedQuantity",
      "accountCode",
    ];
    const csvRows = rows.map((r: any) =>
      [
        csvField(r.headerId),
        csvField(r.partnerId),
        csvField(r.warehouseId),
        csvField(
          r.instructedReceiveDate ? new Date(r.instructedReceiveDate).toISOString().slice(0, 10) : "",
        ),
        csvField(r.status),
        csvField(r.headerMemo),
        csvField(r.createdBy),
        csvField(r.createdAt ? new Date(r.createdAt).toISOString() : ""),
        csvField(r.itemId),
        csvField(r.lotNumber),
        csvField(r.instructedQuantity),
        csvField(r.accountCode),
      ].join(","),
    );
    return withBom(buildCsvContent(headers, csvRows));
  }

  private async validateAndResolveItems(
    c: Context<{ Bindings: Env }>,
    input: CreateReceiptInstructionInput,
  ): Promise<ResolvedReceiptInstructionItem[]> {
    const productsRepo = new ProductsRepository(c.env.DB);
    const warehousesRepo = new WarehousesRepository(c.env.DB);
    const accountsRepo = new AccountsRepository(c.env.DB);
    const partnersRepo = new PartnersRepository(c.env.DB);

    const partner = await partnersRepo.findById(input.partnerId);
    if (!partner) throw new NotFoundError(`取引先が見つかりません: ${input.partnerId}`);

    const warehouse = await warehousesRepo.findById(input.warehouseId);
    if (!warehouse) throw new NotFoundError(`倉庫が見つかりません: ${input.warehouseId}`);
    if (warehouse.warehouseType !== "EXTERNAL") {
      throw new BadRequestError("入荷指示は外部倉庫向けのみ作成できます");
    }

    const resolvedItems: ResolvedReceiptInstructionItem[] = [];
    for (const item of input.items) {
      const product = await productsRepo.findProductById(item.itemId);
      if (!product) throw new NotFoundError(`品目が見つかりません: ${item.itemId}`);

      const accountCode = item.accountCode || product.accountCode;
      if (!accountCode) {
        throw new BadRequestError(
          `勘定科目コードを解決できません(品目:${item.itemId})。品目マスタに規定の勘定科目が未設定の場合は明示的に指定してください`,
        );
      }
      const account = await accountsRepo.findByCode(accountCode);
      if (!account) throw new NotFoundError(`勘定科目が見つかりません: ${accountCode}`);

      resolvedItems.push({
        id: crypto.randomUUID(),
        itemId: item.itemId,
        lotNumber: item.lotNumber || "NONE",
        instructedQuantity: item.instructedQuantity,
        accountCode,
        memo: item.memo || null,
      });
    }
    return resolvedItems;
  }

  async createInstruction(c: Context<{ Bindings: Env }>, input: CreateReceiptInstructionInput) {
    const db = createDb(c.env.DB);
    const resolvedItems = await this.validateAndResolveItems(c, input);

    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const headerId = await resolveConfiguredDocumentId(
      c,
      "receipt_instruction",
      (id) => this.repo.findHeaderById(id).then((row) => !!row),
      input.id,
    );
    const now = new Date();

    await this.repo.createInstruction(
      headerId,
      input.partnerId,
      input.warehouseId,
      new Date(input.instructedReceiveDate),
      input.memo || null,
      resolvedItems,
      "UNAPPROVED",
      operatorId,
      now,
    );

    const wfEnabled = await isReceivingInstructionWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.updateHeaderStatus(headerId, "APPROVED");

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_RECEIPT_INSTRUCTION_DIRECT", RESOURCE_KEY, headerId, null, {
          status: "APPROVED",
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、入荷指示を発行しました",
        headerId,
      };
    }

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: TARGET_TYPE,
      targetId: headerId,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: 0,
      comment: `入荷指示[${headerId}]の承認申請`,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      await this.repo.deleteInstruction(headerId);
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `入荷指示[${headerId}]の承認申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_RECEIPT_INSTRUCTION_FOR_APPROVAL", RESOURCE_KEY, headerId, null, {
        status: "UNAPPROVED",
      }),
    );

    return {
      success: true,
      message: "入荷指示の承認を申請しました",
      headerId,
    };
  }

  async resubmitInstruction(
    c: Context<{ Bindings: Env }>,
    headerId: string,
    input: CreateReceiptInstructionInput,
  ) {
    const db = createDb(c.env.DB);
    const header = await this.repo.findHeaderById(headerId);
    if (!header) throw new NotFoundError("対象の入荷指示が見つかりません");
    if (header.status !== "REMANDED") {
      throw new BadRequestError("差戻し状態の入荷指示のみ修正して再申請できます");
    }

    const resolvedItems = await this.validateAndResolveItems(c, input);
    const operatorId = await resolveOperatorEmployeeNumber(c, db);

    const wfEnabled = await isReceivingInstructionWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.replaceInstructionItems(
        headerId,
        input.partnerId,
        input.warehouseId,
        new Date(input.instructedReceiveDate),
        input.memo || null,
        resolvedItems,
        "APPROVED",
      );

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_RECEIPT_INSTRUCTION_DIRECT", RESOURCE_KEY, headerId, null, {
          status: "APPROVED",
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、入荷指示を発行しました",
        headerId,
      };
    }

    await this.repo.replaceInstructionItems(
      headerId,
      input.partnerId,
      input.warehouseId,
      new Date(input.instructedReceiveDate),
      input.memo || null,
      resolvedItems,
      "UNAPPROVED",
    );

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: TARGET_TYPE,
      targetId: headerId,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: 0,
      comment: `入荷指示[${headerId}]の再申請`,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `入荷指示[${headerId}]の再申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "RESUBMIT_RECEIPT_INSTRUCTION_FOR_APPROVAL", RESOURCE_KEY, headerId, null, {
        status: "UNAPPROVED",
      }),
    );

    return {
      success: true,
      message: "入荷指示の再申請しました",
      headerId,
    };
  }

  // Item6 Phase6-4追加: shipment-instructions.service.tsのcancelInstructionと対称
  async cancelInstruction(c: Context<{ Bindings: Env }>, headerId: string) {
    const header = await this.repo.findHeaderById(headerId);
    if (!header) throw new NotFoundError("対象の入荷指示が見つかりません");
    if (!["APPROVED", "PARTIALLY_FULFILLED", "REMANDED"].includes(header.status)) {
      throw new BadRequestError(
        `この状態の入荷指示は取消できません(現在の状態: ${header.status})。承認申請中の場合は「申請履歴・進捗一覧」画面の「取下げ」をご利用ください。`,
      );
    }

    await this.repo.updateHeaderStatus(headerId, "CANCELED");

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CANCEL_RECEIPT_INSTRUCTION", RESOURCE_KEY, headerId, header, {
        status: "CANCELED",
      }),
    );

    return { success: true, message: "入荷指示を取消しました", headerId };
  }
}
