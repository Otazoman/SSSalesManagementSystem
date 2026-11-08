import { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { Env } from "../../../types/env";
import * as schema from "../../../db/schema";
import { createDb, type AppDb } from "../../../platform/db/create-db";
import { PurchaseOrderRepository } from "./purchase-order.repository";
import { PurchaseOrderReceiptService } from "./purchase-order-receipt.service";
import { ReceiptsRepository } from "../../inventory/receipts/receipts.repository";
import { ShipmentsRepository, ResolvedShipmentItem } from "../../inventory/shipments/shipments.repository";
import { StocksService } from "../../inventory/stocks/stocks.service";
import { SalesOrderRepository } from "../../sales/orders/sales-order.repository";
import { SalesOrderShipmentService } from "../../sales/orders/sales-order-shipment.service";
import { ensureDirectShipmentWarehouse } from "../../../platform/inventory/direct-shipment-warehouse";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { getSession } from "../../../platform/auth/get-session";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { WorkflowEngine } from "../../../workflow-engine/engine";
import { notifyApprovalRequestSubmitted } from "../../../workflow-engine/notifier";
import { isReceivingWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import type { DirectShipmentCompletionInput } from "./purchase-order.schema";
import { confirmDirectShipmentOfReceipt } from "./purchase-order-direct-shipment-confirm";

const RESOURCE_KEY = "inventory_stock";

// REQ-005 第2段階: 直送の発注の「直送完了」。発注明細とつながる入庫(直送用の倉庫へ)と、受注明細とつながる
// 出庫(直送用の倉庫から得意先へ)を作り、入庫の承認(承認機能が無効なら即時)で両方を確定する。
// 入荷済数量・出荷済数量・仕入計上・売上・納品書は、今の入庫・出庫の仕組みのまま動く。
// 承認は「入出庫の承認」(inventory_stock、対象は入庫)を1回だけ通す。出庫は入庫に合わせて確定・差戻し・取下げする
export class PurchaseOrderDirectShipmentService {
  async completeDirectShipment(
    c: Context<{ Bindings: Env }>,
    orderId: string,
    input: DirectShipmentCompletionInput,
  ) {
    const db = createDb(c.env.DB);
    const poRepo = PurchaseOrderRepository.fromDb(db);
    const receiptsRepo = ReceiptsRepository.fromDb(db);
    const shipmentsRepo = ShipmentsRepository.fromDb(db);
    const salesOrderRepo = SalesOrderRepository.fromDb(db);

    const order = await poRepo.findOrderById(orderId);
    if (!order) throw new NotFoundError(`発注が見つかりません: ${orderId}`);
    if (!order.isDirectShipment || !order.directSalesOrderId) {
      throw new BadRequestError(`発注[${orderId}]は直送の発注ではありません`);
    }
    if (order.status !== "APPROVED") {
      throw new BadRequestError(`発注[${orderId}]が確定(承認済み)ではないため、直送完了にできません`);
    }
    const salesOrder = await salesOrderRepo.findOrderById(order.directSalesOrderId);
    if (!salesOrder) throw new NotFoundError(`直送する受注が見つかりません: ${order.directSalesOrderId}`);
    if (salesOrder.status !== "APPROVED") {
      throw new BadRequestError(`直送する受注[${salesOrder.id}]が承認済みではないため、直送完了にできません`);
    }
    if (await hasPendingDirectCompletion(db, orderId)) {
      throw new BadRequestError(`発注[${orderId}]には承認待ちの直送完了があります。承認・差戻しの後に操作してください`);
    }

    const lines = input.items.filter((line) => line.quantity > 0);
    if (lines.length === 0) throw new BadRequestError("直送完了にする明細を1件以上指定してください");

    const poItems = await poRepo.findOrderItems(orderId);
    const poItemById = new Map(poItems.map((item) => [item.id, item]));
    const receiptService = new PurchaseOrderReceiptService(poRepo, receiptsRepo);
    const shipmentService = new SalesOrderShipmentService(salesOrderRepo);
    const resolved: Array<{ poItemId: string; salesOrderItemId: string; itemId: string; quantity: number; accountCode: string }> = [];
    for (const line of lines) {
      const poItem = poItemById.get(line.orderItemId);
      if (!poItem) throw new BadRequestError(`発注[${orderId}]に明細[${line.orderItemId}]がありません`);
      if (!poItem.itemId || !poItem.salesOrderItemId) {
        throw new BadRequestError(`発注明細[${line.orderItemId}]は受注明細とつながっていないため、直送完了にできません`);
      }
      const salesOrderItem = await salesOrderRepo.findOrderItemById(poItem.salesOrderItemId);
      if (!salesOrderItem || salesOrderItem.salesOrderId !== salesOrder.id) {
        throw new BadRequestError(`発注明細[${line.orderItemId}]は直送する受注[${salesOrder.id}]の明細とつながっていません`);
      }
      // 発注の残数量(入荷済数量を除く)・受注の残数量(出荷済数量を除く)を超えないこと
      await receiptService.validateRemainingQuantity(poItem.id, line.quantity);
      await shipmentService.validateRemainingQuantity(salesOrderItem.id, line.quantity);
      const [product] = await db
        .select({ accountCode: schema.items.accountCode })
        .from(schema.items)
        .where(eq(schema.items.id, poItem.itemId))
        .limit(1);
      if (!product) throw new NotFoundError(`品目が見つかりません: ${poItem.itemId}`);
      if (!product.accountCode) {
        throw new BadRequestError(`品目[${poItem.itemId}]に勘定科目が設定されていないため、直送完了にできません`);
      }
      resolved.push({
        poItemId: poItem.id,
        salesOrderItemId: salesOrderItem.id,
        itemId: poItem.itemId,
        quantity: line.quantity,
        accountCode: product.accountCode,
      });
    }

    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const now = new Date();
    const { warehouseId, locationId } = await ensureDirectShipmentWarehouse(db, operatorId, now);
    const memo = input.memo || `直送完了(発注 ${orderId} → 受注 ${salesOrder.id})`;

    const receiptId = await resolveConfiguredDocumentId(
      c,
      "receipt",
      (id) => receiptsRepo.findHeaderById(id).then((row) => !!row),
      null,
    );
    const receiptItems = resolved.map(() => ({ id: crypto.randomUUID() }));
    await receiptsRepo.createReceipt(
      receiptId,
      {
        orderId,
        partnerId: order.partnerId,
        receivedDate: input.completedDate,
        memo,
        items: resolved.map((line) => ({
          orderItemId: line.poItemId,
          itemId: line.itemId,
          warehouseId,
          locationId,
          lotNumber: "NONE",
          quantity: line.quantity,
          inspectionStatus: "PASSED",
        })),
      } as any,
      resolved.map((line, i) => ({ id: receiptItems[i].id, accountCode: line.accountCode })),
      "UNAPPROVED",
      operatorId,
      now,
    );

    const shipmentId = await resolveConfiguredDocumentId(
      c,
      "shipment",
      (id) => shipmentsRepo.findHeaderById(id).then((row) => !!row),
      null,
    );
    const shipmentItems: ResolvedShipmentItem[] = resolved.map((line) => ({
      id: crypto.randomUUID(),
      itemId: line.itemId,
      warehouseId,
      locationId,
      lotNumber: "NONE",
      qualityStatus: "NORMAL",
      accountCode: line.accountCode,
      shippedQuantity: line.quantity,
      salesOrderItemId: line.salesOrderItemId,
    }));
    await shipmentsRepo.createShipment(
      shipmentId,
      new Date(input.completedDate),
      memo,
      shipmentItems,
      "UNAPPROVED",
      operatorId,
      now,
      salesOrder.partnerId,
      null,
      salesOrder.id,
      null,
      receiptId,
    );

    if (!(await isReceivingWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS))) {
      await confirmDirectShipmentReceipt(db, receiptId, operatorId, now);
      await confirmDirectShipmentOfReceipt(db, receiptId, operatorId, now, c);
      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_DIRECT_SHIPMENT", RESOURCE_KEY, receiptId, null, {
          status: "APPROVED",
          orderId,
          salesOrderId: salesOrder.id,
          shipmentId,
        }),
      );
      return {
        success: true,
        message: "承認機能が無効のため、直送完了(入庫・出庫)を確定しました",
        receiptId,
        shipmentId,
      };
    }

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) throw new BadRequestError("認証情報が確認できません");
    const comment = `直送完了[入庫 ${receiptId} / 出庫 ${shipmentId}](発注 ${orderId} → 受注 ${salesOrder.id})の承認申請`;
    const wfResult = await WorkflowEngine.startWorkflow(
      db,
      {
        targetType: "inventory_stock",
        targetId: receiptId,
        applicantId: applicantUserId,
        requestType: "REGISTER",
        amount: 0,
        comment,
        applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
      },
      c,
    );
    if (!wfResult.success) {
      // 申請できなければ、作った出庫・入庫を消す(出庫が入庫を参照するため出庫から)
      await deleteDirectShipmentRecords(db, receiptId, shipmentId);
      throw new BadRequestError(wfResult.message);
    }
    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment,
      performedById: applicantUserId,
    });
    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_DIRECT_SHIPMENT_FOR_APPROVAL", RESOURCE_KEY, receiptId, null, {
        status: "UNAPPROVED",
        orderId,
        salesOrderId: salesOrder.id,
        shipmentId,
      }),
    );
    return { success: true, message: "直送完了の承認を申請しました", receiptId, shipmentId };
  }
}

/** 承認待ち(UNAPPROVED)の直送完了の入庫がある発注か */
async function hasPendingDirectCompletion(db: AppDb, orderId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.itemShipmentHeaders.id })
    .from(schema.itemShipmentHeaders)
    .innerJoin(
      schema.itemReceiptHeaders,
      eq(schema.itemReceiptHeaders.id, schema.itemShipmentHeaders.directReceiptHeaderId),
    )
    .where(and(eq(schema.itemReceiptHeaders.orderId, orderId), eq(schema.itemReceiptHeaders.status, "UNAPPROVED")))
    .limit(1);
  return rows.length > 0;
}

async function deleteDirectShipmentRecords(db: AppDb, receiptId: string, shipmentId: string) {
  await db.batch([
    db.delete(schema.itemShipmentItems).where(eq(schema.itemShipmentItems.shipmentHeaderId, shipmentId)),
    db.delete(schema.itemShipmentHeaders).where(eq(schema.itemShipmentHeaders.id, shipmentId)),
    db.delete(schema.itemReceiptItems).where(eq(schema.itemReceiptItems.receiptHeaderId, receiptId)),
    db.delete(schema.itemReceiptHeaders).where(eq(schema.itemReceiptHeaders.id, receiptId)),
  ]);
}

/** 直送完了の入庫を確定する(承認機能が無効の時。承認の確定では inventory-stock.adapter.ts が入庫を確定する) */
async function confirmDirectShipmentReceipt(db: AppDb, receiptId: string, operatorId: string, now: Date) {
  const receiptsRepo = ReceiptsRepository.fromDb(db);
  const items = await receiptsRepo.findItemsByHeaderId(receiptId);
  await StocksService.fromDb(db).applyReceiptItems(
    items.map((item: any) => ({
      itemId: item.itemId,
      warehouseId: item.warehouseId,
      locationId: item.locationId,
      lotNumber: item.lotNumber,
      accountCode: item.accountCode,
      receivedQuantity: item.receivedQuantity,
      inspectionStatus: item.inspectionStatus,
      qrCodeKey: item.qrCodeKey,
    })),
    receiptId,
    operatorId,
    now,
  );
  await receiptsRepo.updateHeaderStatus(receiptId, "APPROVED");
}
