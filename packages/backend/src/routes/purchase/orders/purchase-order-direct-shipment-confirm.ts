import { Context } from "hono";
import { inArray } from "drizzle-orm";
import { Env } from "../../../types/env";
import * as schema from "../../../db/schema";
import type { AppDb } from "../../../platform/db/create-db";
import { ShipmentsRepository } from "../../inventory/shipments/shipments.repository";
import { DeliveryNotePdfService } from "../../inventory/shipments/delivery-note-pdf.service";
import { StocksService } from "../../inventory/stocks/stocks.service";
import { SalesOrderRepository } from "../../sales/orders/sales-order.repository";
import { SalesOrderShipmentService } from "../../sales/orders/sales-order-shipment.service";
import {
  WarehouseStockReservationRepository,
  adjustReservationForDirectShipment,
} from "../../../platform/inventory/warehouse-stock-reservation.repository";

// REQ-005 第2段階: 直送完了の入庫の確定・差戻し・取下げに、対になる出庫を合わせる処理。
// 承認の確定(workflow-engine/target-adapters/inventory-stock.adapter.ts)からも呼ぶため、承認エンジンを
// 読み込む purchase-order-direct-shipment.service.ts とは分けている(読み込みの循環を避ける)

/**
 * 直送完了の入庫が確定した後に、対になる出庫を確定する(直送用の倉庫の在庫を0に戻す)。あわせて、出荷した数量の分の
 * 受注明細の欠品・引当を外し(adjustReservationForDirectShipment)、受注の出荷状況を計算し直し、納品書を作る。
 * 入庫が直送完了のものでなければ何もしない。承認機能が無効の時と、承認の確定(inventory-stock.adapter.ts)から呼ぶ
 */
export async function confirmDirectShipmentOfReceipt(
  db: AppDb,
  receiptId: string,
  operatorId: string,
  now: Date,
  c?: Context<{ Bindings: Env }>,
): Promise<void> {
  const shipmentsRepo = ShipmentsRepository.fromDb(db);
  const shipment = await shipmentsRepo.findHeaderByDirectReceiptId(receiptId);
  if (!shipment || shipment.status === "APPROVED") return;

  const items = await shipmentsRepo.findItemsByHeaderId(shipment.id);
  await StocksService.fromDb(db).applyShipmentItems(
    items.map((item: any) => ({
      itemId: item.itemId,
      warehouseId: item.warehouseId,
      locationId: item.locationId,
      lotNumber: item.lotNumber,
      accountCode: item.accountCode,
      qualityStatus: item.qualityStatus,
      shippedQuantity: item.shippedQuantity,
      qrCodeKey: null,
    })),
    shipment.id,
    operatorId,
    now,
  );
  await shipmentsRepo.updateHeaderStatus(shipment.id, "APPROVED");

  const salesOrderRepo = SalesOrderRepository.fromDb(db);
  const reservationRepo = WarehouseStockReservationRepository.fromDb(db);
  const orderItemIds = items.map((item: any) => item.salesOrderItemId).filter((id: any): id is string => !!id);
  const orderItems =
    orderItemIds.length > 0
      ? await db.select().from(schema.salesOrderItems).where(inArray(schema.salesOrderItems.id, orderItemIds))
      : [];
  const orderItemById = new Map(orderItems.map((item) => [item.id, item]));
  for (const item of items) {
    const orderItem = item.salesOrderItemId ? orderItemById.get(item.salesOrderItemId) : undefined;
    if (!orderItem || !orderItem.itemId) continue;
    const nextBackordered = await adjustReservationForDirectShipment(
      reservationRepo,
      orderItem.id,
      orderItem.itemId,
      orderItem.backorderedQuantity,
      item.shippedQuantity,
      now,
    );
    if (nextBackordered !== orderItem.backorderedQuantity) {
      await salesOrderRepo.updateOrderItemBackorder(orderItem.id, nextBackordered);
      orderItem.backorderedQuantity = nextBackordered;
    }
  }
  if (shipment.salesOrderId) {
    await new SalesOrderShipmentService(salesOrderRepo).recalculateShipmentStatus(shipment.salesOrderId);
  }
  // 得意先が設定されていれば、今の出庫と同じく納品書PDFを作る(R2 を使うため Context がある時だけ)
  if (shipment.partnerId && c) {
    c.executionCtx.waitUntil(new DeliveryNotePdfService(shipmentsRepo).generateAndStore(c as any, shipment.id));
  }
}

/** 直送完了の入庫の差戻し・取下げに、対になる出庫の状態を合わせる */
export async function syncDirectShipmentStatusOfReceipt(db: AppDb, receiptId: string, status: string) {
  const shipmentsRepo = ShipmentsRepository.fromDb(db);
  const shipment = await shipmentsRepo.findHeaderByDirectReceiptId(receiptId);
  if (shipment && shipment.status !== "APPROVED") {
    await shipmentsRepo.updateHeaderStatus(shipment.id, status);
  }
}
