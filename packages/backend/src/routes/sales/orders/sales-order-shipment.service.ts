import { SalesOrderRepository } from "./sales-order.repository";
import { WarehouseStockReservationRepository } from "../../../platform/inventory/warehouse-stock-reservation.repository";
import { WarehousesRepository } from "../../master/warehouses/warehouses.repository";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";

export interface ShipmentProgressWarehouseBreakdown {
  warehouseId: string;
  warehouseName: string;
  warehouseType: string;
  reservedQuantity: number;
}

export interface ShipmentProgressItem {
  salesOrderItemId: string;
  itemId: string | null;
  itemName: string | null;
  inputType: string | null;
  quantity: number;
  shippedQuantity: number;
  remainingQuantity: number;
  reservations: ShipmentProgressWarehouseBreakdown[];
}

// Item7残課題6: 受注→出荷指示/出庫の消込連携。既存のsales-order-csv.service.ts等と同じ、
// SalesOrderRepositoryを受け取ってsales-order.service.tsのfacadeに合成される構成
export class SalesOrderShipmentService {
  constructor(private repo: SalesOrderRepository) {}

  async getShipmentProgress(orderId: string, d1: D1Database): Promise<ShipmentProgressItem[]> {
    const order = await this.repo.findOrderById(orderId);
    if (!order) throw new NotFoundError("対象の受注が見つかりません");

    const items = await this.repo.findOrderItems(orderId);
    const itemIds = items.map((i: any) => i.id);

    const warehouseReservationRepo = new WarehouseStockReservationRepository(d1);
    const [shippedRows, reservationRows] = await Promise.all([
      this.repo.getShippedQuantitiesByOrderItemIds(itemIds),
      warehouseReservationRepo.findReservationsByOrderItemIds(itemIds),
    ]);

    const shippedByItemId = new Map(shippedRows.map((r) => [r.salesOrderItemId, r.shippedQuantity]));

    const warehousesRepo = new WarehousesRepository(d1);
    const warehouseCache = new Map<string, { name: string; warehouseType: string }>();
    const resolveWarehouse = async (warehouseId: string) => {
      if (!warehouseCache.has(warehouseId)) {
        const wh = await warehousesRepo.findById(warehouseId);
        warehouseCache.set(warehouseId, {
          name: wh?.name || warehouseId,
          warehouseType: wh?.warehouseType || "INTERNAL",
        });
      }
      return warehouseCache.get(warehouseId)!;
    };

    const reservationsByItemId = new Map<string, ShipmentProgressWarehouseBreakdown[]>();
    for (const r of reservationRows) {
      const wh = await resolveWarehouse(r.warehouseId);
      const list = reservationsByItemId.get(r.salesOrderItemId) || [];
      list.push({
        warehouseId: r.warehouseId,
        warehouseName: wh.name,
        warehouseType: wh.warehouseType,
        reservedQuantity: r.reservedQuantity,
      });
      reservationsByItemId.set(r.salesOrderItemId, list);
    }

    return items.map((item: any) => {
      const shippedQuantity = shippedByItemId.get(item.id) || 0;
      return {
        salesOrderItemId: item.id,
        itemId: item.itemId,
        itemName: item.itemName,
        inputType: item.inputType,
        quantity: item.quantity,
        shippedQuantity,
        remainingQuantity: Math.max(item.quantity - shippedQuantity, 0),
        reservations: reservationsByItemId.get(item.id) || [],
      };
    });
  }

  // 出荷指示・出庫の明細作成時、対応する受注明細の残数量(受注数量-既出荷数量)を
  // 超えていないか検証する(超過時はエラーでブロックする、ユーザー確認済み)
  async validateRemainingQuantity(salesOrderItemId: string, requestedQuantity: number): Promise<void> {
    const orderItem = await this.repo.findOrderItemById(salesOrderItemId);
    if (!orderItem) {
      throw new NotFoundError(`受注明細が見つかりません: ${salesOrderItemId}`);
    }
    const shippedRows = await this.repo.getShippedQuantitiesByOrderItemIds([salesOrderItemId]);
    const shippedQuantity = shippedRows[0]?.shippedQuantity || 0;
    const remaining = orderItem.quantity - shippedQuantity;
    if (requestedQuantity > remaining) {
      throw new BadRequestError(
        `受注明細[${salesOrderItemId}]の残数量(${remaining})を超えています(指定数量: ${requestedQuantity})`,
      );
    }
  }

  // 全明細の受注数量合計と出荷済数量合計を比較し、sales_orders.shipment_statusを更新する
  async recalculateShipmentStatus(orderId: string): Promise<void> {
    const items = await this.repo.findOrderItems(orderId);
    const itemIds = items.map((i: any) => i.id);
    const shippedRows = await this.repo.getShippedQuantitiesByOrderItemIds(itemIds);
    const shippedByItemId = new Map(shippedRows.map((r) => [r.salesOrderItemId, r.shippedQuantity]));

    const totalOrdered = items.reduce((sum: number, i: any) => sum + i.quantity, 0);
    const totalShipped = items.reduce(
      (sum: number, i: any) => sum + Math.min(shippedByItemId.get(i.id) || 0, i.quantity),
      0,
    );

    const nextStatus =
      totalShipped <= 0 ? "NOT_SHIPPED" : totalShipped >= totalOrdered ? "SHIPPED" : "PARTIALLY_SHIPPED";
    await this.repo.updateShipmentStatus(orderId, nextStatus);
  }
}
