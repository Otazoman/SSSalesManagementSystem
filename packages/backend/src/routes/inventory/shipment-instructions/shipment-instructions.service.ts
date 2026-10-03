import { Context } from "hono";
import { Env } from "../../../types/env";
import {
  ShipmentInstructionsRepository,
  ResolvedShipmentInstructionItem,
} from "./shipment-instructions.repository";
import {
  CreateShipmentInstructionInput,
  GetShipmentInstructionsQuery,
} from "./shipment-instructions.schema";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { ProductsRepository } from "../../master/products/products.repository";
import { WarehousesRepository } from "../../master/warehouses/warehouses.repository";
import { AccountsRepository } from "../../master/accounts/accounts.repository";
import { PartnersRepository } from "../../master/partners/partners.repository";
import { SalesOrderRepository } from "../../sales/orders/sales-order.repository";
import { SalesOrderShipmentService } from "../../sales/orders/sales-order-shipment.service";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { getSession } from "../../../platform/auth/get-session";
import { createDb } from "../../../platform/db/create-db";
import { WorkflowEngine } from "../../../workflow-engine/engine";
import { notifyApprovalRequestSubmitted } from "../../../workflow-engine/notifier";
import { isShippingInstructionWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "inventory_instructions";
const TARGET_TYPE = "inventory_instructions";

export class ShipmentInstructionsService {
  constructor(private repo: ShipmentInstructionsRepository) {}

  async listInstructions(
    searchParams: GetShipmentInstructionsQuery,
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
    if (!header) throw new NotFoundError("対象の出荷指示が見つかりません");
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
    if (!header) throw new NotFoundError("対象の出荷指示が見つかりません");
    const items = await this.repo.findItemsByHeaderId(id);

    const headers = [
      "headerId",
      "partnerId",
      "warehouseId",
      "instructedShipDate",
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
        csvField(new Date(header.instructedShipDate).toISOString().slice(0, 10)),
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

  async generateCsv(searchParams: GetShipmentInstructionsQuery) {
    const rows = await this.repo.findAllForCsv(searchParams);
    const headers = [
      "headerId",
      "partnerId",
      "warehouseId",
      "instructedShipDate",
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
          r.instructedShipDate ? new Date(r.instructedShipDate).toISOString().slice(0, 10) : "",
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

  // createInstruction/resubmitInstructionの両方から呼ぶ共通の検証+勘定科目解決ロジック。
  // Item7残課題6: 明細にsalesOrderItemIdが指定されていれば、対応する受注明細の残数量
  // (受注数量-既出荷数量)を超えていないか検証し、超過時はエラーでブロックする。また、
  // 1件でも受注紐付けがあれば、そのヘッダー全体をその受注の出荷指示として記録する
  // (異なる複数受注のitemが混在する場合はエラーとする、スキーマがヘッダー単位で1受注までの想定のため)
  private async validateAndResolveItems(
    c: Context<{ Bindings: Env }>,
    input: CreateShipmentInstructionInput,
  ): Promise<{ resolvedItems: ResolvedShipmentInstructionItem[]; salesOrderId: string | null }> {
    const productsRepo = new ProductsRepository(c.env.DB);
    const warehousesRepo = new WarehousesRepository(c.env.DB);
    const accountsRepo = new AccountsRepository(c.env.DB);
    const partnersRepo = new PartnersRepository(c.env.DB);
    const salesOrderRepo = new SalesOrderRepository(c.env.DB);
    const salesOrderShipmentService = new SalesOrderShipmentService(salesOrderRepo);

    const partner = await partnersRepo.findById(input.partnerId);
    if (!partner) throw new NotFoundError(`取引先が見つかりません: ${input.partnerId}`);

    const warehouse = await warehousesRepo.findById(input.warehouseId);
    if (!warehouse) throw new NotFoundError(`倉庫が見つかりません: ${input.warehouseId}`);

    const resolvedItems: ResolvedShipmentInstructionItem[] = [];
    let salesOrderId: string | null = null;
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

      if (item.salesOrderItemId) {
        await salesOrderShipmentService.validateRemainingQuantity(
          item.salesOrderItemId,
          item.instructedQuantity,
        );
        const orderItem = await salesOrderRepo.findOrderItemById(item.salesOrderItemId);
        if (orderItem && salesOrderId && salesOrderId !== orderItem.salesOrderId) {
          throw new BadRequestError("1件の出荷指示内に異なる受注の明細を混在させることはできません");
        }
        if (orderItem) salesOrderId = orderItem.salesOrderId;
      }

      resolvedItems.push({
        id: crypto.randomUUID(),
        itemId: item.itemId,
        lotNumber: item.lotNumber || "NONE",
        instructedQuantity: item.instructedQuantity,
        accountCode,
        memo: item.memo || null,
        salesOrderItemId: item.salesOrderItemId || null,
      });
    }
    return { resolvedItems, salesOrderId };
  }

  async createInstruction(c: Context<{ Bindings: Env }>, input: CreateShipmentInstructionInput) {
    const db = createDb(c.env.DB);
    const { resolvedItems, salesOrderId } = await this.validateAndResolveItems(c, input);

    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const headerId = await resolveConfiguredDocumentId(
      c,
      "shipment_instruction",
      (id) => this.repo.findHeaderById(id).then((row) => !!row),
      input.id,
    );
    const now = new Date();

    await this.repo.createInstruction(
      headerId,
      input.partnerId,
      input.warehouseId,
      new Date(input.instructedShipDate),
      input.memo || null,
      resolvedItems,
      "UNAPPROVED",
      operatorId,
      now,
      salesOrderId,
    );

    const wfEnabled = await isShippingInstructionWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.updateHeaderStatus(headerId, "APPROVED");

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_SHIPMENT_INSTRUCTION_DIRECT", RESOURCE_KEY, headerId, null, {
          status: "APPROVED",
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、出荷指示を発行しました",
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
      comment: `出荷指示[${headerId}]の承認申請`,
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
      comment: `出荷指示[${headerId}]の承認申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_SHIPMENT_INSTRUCTION_FOR_APPROVAL", RESOURCE_KEY, headerId, null, {
        status: "UNAPPROVED",
      }),
    );

    return {
      success: true,
      message: "出荷指示の承認を申請しました",
      headerId,
    };
  }

  // 修正して再提出: 差戻し(REMANDED)された出荷指示を、新規レコードを作らず同じheaderIdのまま
  // 内容を書き換えて再申請する
  async resubmitInstruction(
    c: Context<{ Bindings: Env }>,
    headerId: string,
    input: CreateShipmentInstructionInput,
  ) {
    const db = createDb(c.env.DB);
    const header = await this.repo.findHeaderById(headerId);
    if (!header) throw new NotFoundError("対象の出荷指示が見つかりません");
    if (header.status !== "REMANDED") {
      throw new BadRequestError("差戻し状態の出荷指示のみ修正して再申請できます");
    }

    const { resolvedItems, salesOrderId } = await this.validateAndResolveItems(c, input);
    const operatorId = await resolveOperatorEmployeeNumber(c, db);

    const wfEnabled = await isShippingInstructionWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.replaceInstructionItems(
        headerId,
        input.partnerId,
        input.warehouseId,
        new Date(input.instructedShipDate),
        input.memo || null,
        resolvedItems,
        "APPROVED",
        salesOrderId,
      );

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_SHIPMENT_INSTRUCTION_DIRECT", RESOURCE_KEY, headerId, null, {
          status: "APPROVED",
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、出荷指示を発行しました",
        headerId,
      };
    }

    await this.repo.replaceInstructionItems(
      headerId,
      input.partnerId,
      input.warehouseId,
      new Date(input.instructedShipDate),
      input.memo || null,
      resolvedItems,
      "UNAPPROVED",
      salesOrderId,
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
      comment: `出荷指示[${headerId}]の再申請`,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `出荷指示[${headerId}]の再申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "RESUBMIT_SHIPMENT_INSTRUCTION_FOR_APPROVAL", RESOURCE_KEY, headerId, null, {
        status: "UNAPPROVED",
      }),
    );

    return {
      success: true,
      message: "出荷指示の再申請しました",
      headerId,
    };
  }

  // Item6 Phase6-4追加: 発行済み(APPROVED/PARTIALLY_FULFILLED)・差戻し(REMANDED)の出荷指示を取消す。
  // UNAPPROVED(承認待ち)は対象外(/workflow/histories の既存「取り下げ」機能を使う。ここで直接
  // CANCELEDにしてしまうと、承認待ちのmaster_approval_requestsが残ったままとなり、後日承認者が
  // 決裁した際にapplyApproved()がAPPROVEDへ書き戻してしまう不整合が起きるため)。
  // FULFILLED(全量消化済み)・CANCELED(取消済み)も対象外
  async cancelInstruction(c: Context<{ Bindings: Env }>, headerId: string) {
    const header = await this.repo.findHeaderById(headerId);
    if (!header) throw new NotFoundError("対象の出荷指示が見つかりません");
    if (!["APPROVED", "PARTIALLY_FULFILLED", "REMANDED"].includes(header.status)) {
      throw new BadRequestError(
        `この状態の出荷指示は取消できません(現在の状態: ${header.status})。承認申請中の場合は「申請履歴・進捗一覧」画面の「取下げ」をご利用ください。`,
      );
    }

    await this.repo.updateHeaderStatus(headerId, "CANCELED");

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CANCEL_SHIPMENT_INSTRUCTION", RESOURCE_KEY, headerId, header, {
        status: "CANCELED",
      }),
    );

    return { success: true, message: "出荷指示を取消しました", headerId };
  }
}
