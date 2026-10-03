import { Context } from "hono";
import { Env } from "../../../types/env";
import { SalesOrderRepository } from "./sales-order.repository";
import { SalesOrderShipmentService } from "./sales-order-shipment.service";
import { WarehouseStockReservationRepository } from "../../../platform/inventory/warehouse-stock-reservation.repository";
import { WarehousesRepository } from "../../master/warehouses/warehouses.repository";
import { StockRepository } from "../../inventory/stocks/stocks.repository";
import { ShipmentInstructionsService } from "../../inventory/shipment-instructions/shipment-instructions.service";
import { ShipmentInstructionsRepository } from "../../inventory/shipment-instructions/shipment-instructions.repository";
import { ShipmentsService } from "../../inventory/shipments/shipments.service";
import { ShipmentsRepository } from "../../inventory/shipments/shipments.repository";
import { CreateShipmentInstructionInput } from "../../inventory/shipment-instructions/shipment-instructions.schema";
import { CreateShipmentInput } from "../../inventory/shipments/shipments.schema";
import { createDb } from "../../../platform/db/create-db";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { RESOURCE_KEY } from "./sales-order-constants";
import { todayJst } from "../../../platform/date/format-jst-date";

export interface BulkPlanManualItem {
  salesOrderItemId: string;
  itemId: string | null;
  itemName: string | null;
  remainingQuantity: number;
  reason: "NO_LOCATION_CANDIDATE" | "AMBIGUOUS_LOCATION" | "INSUFFICIENT_STOCK";
  candidateCount: number;
}

export interface BulkPlanOrderInstruction {
  warehouseId: string;
  warehouseName: string;
  items: { salesOrderItemId: string; itemId: string; itemName: string | null; quantity: number }[];
}

export interface BulkPlanOrderShipment {
  items: {
    salesOrderItemId: string;
    itemId: string;
    itemName: string | null;
    locationId: string;
    lotNumber: string;
    qualityStatus: string;
    quantity: number;
  }[];
}

export interface BulkPlanOrderResult {
  orderId: string;
  partnerId: string;
  instruction: BulkPlanOrderInstruction | null;
  shipment: BulkPlanOrderShipment | null;
  manualItems: BulkPlanManualItem[];
  skipped: boolean;
  error: string | null;
}

export interface BulkExecuteOrderResult {
  orderId: string;
  instruction: { status: "CREATED" | "FAILED"; headerId?: string; error?: string } | null;
  shipment: { status: "CREATED" | "FAILED"; headerId?: string; error?: string } | null;
}

// 受注一覧からの一括出荷指示/出庫作成。既存の単一受注prefillフロー(ShipmentInstructionPanel.tsx/
// useStockShipmentForm.tsxの?fromSalesOrderId=)と同じ簡易方針(EXTERNAL明細は最初に見つかった
// 1倉庫のみ自動投入)をサーバー側で複数受注分ループする。出荷指示/出庫の作成自体は既存の
// ShipmentInstructionsService.createInstruction / ShipmentsService.createShipmentをそのまま呼ぶため、
// 承認ワークフロー分岐・在庫反映・監査ログ等の既存ロジックは一切複製しない
export class SalesOrderBulkShipmentService {
  constructor(private repo: SalesOrderRepository) {}

  // 副作用なし(DB書き込みを一切行わない)。確認モーダル表示用のプレビュー計算
  async computeBulkShipmentPlan(c: Context<{ Bindings: Env }>, orderIds: string[]): Promise<BulkPlanOrderResult[]> {
    const shipmentSvc = new SalesOrderShipmentService(this.repo);
    const warehousesRepo = new WarehousesRepository(c.env.DB);
    const db = createDb(c.env.DB);
    const stockRepo = StockRepository.fromDb(db);
    const warehouseNameCache = new Map<string, string>();
    const reservationRepo = new WarehouseStockReservationRepository(c.env.DB);

    const results: BulkPlanOrderResult[] = [];
    for (const orderId of orderIds) {
      const order = await this.repo.findOrderById(orderId);
      if (!order) {
        results.push({
          orderId,
          partnerId: "",
          instruction: null,
          shipment: null,
          manualItems: [],
          skipped: true,
          error: "受注が見つかりません",
        });
        continue;
      }
      if (order.status !== "APPROVED") {
        results.push({
          orderId,
          partnerId: order.partnerId,
          instruction: null,
          shipment: null,
          manualItems: [],
          skipped: true,
          error: "APPROVED状態の受注のみ対象です",
        });
        continue;
      }

      const progress = await shipmentSvc.getShipmentProgress(orderId, c.env.DB);
      // BUG-056: サービス品目(isService)は在庫を持たず出荷しないため、一括作成の対象(要手動対応を含む)から除く
      const serviceItemIds = await reservationRepo.findServiceItemIds(progress.map((p) => p.itemId));
      const remaining = progress.filter(
        (p) => p.remainingQuantity > 0 && p.itemId && !serviceItemIds.has(p.itemId),
      );

      if (remaining.length === 0) {
        results.push({
          orderId,
          partnerId: order.partnerId,
          instruction: null,
          shipment: null,
          manualItems: [],
          skipped: true,
          error: null,
        });
        continue;
      }

      // ---- EXTERNAL(出荷指示)グルーピング: 既存の単一受注prefillと同じ
      // 「最初に見つかった1倉庫のみ自動投入・残りは手動」の簡易方針を踏襲 ----
      const externalCandidates = remaining.flatMap((item) =>
        item.reservations
          .filter((r) => r.warehouseType === "EXTERNAL" && r.reservedQuantity > 0)
          .map((r) => ({ item, warehouseId: r.warehouseId, reservedQuantity: r.reservedQuantity })),
      );
      let instruction: BulkPlanOrderInstruction | null = null;
      const externalCoveredItemIds = new Set<string>();
      if (externalCandidates.length > 0) {
        const targetWarehouseId = externalCandidates[0].warehouseId;
        if (!warehouseNameCache.has(targetWarehouseId)) {
          const wh = await warehousesRepo.findById(targetWarehouseId);
          warehouseNameCache.set(targetWarehouseId, wh?.name || targetWarehouseId);
        }
        const lines = externalCandidates
          .filter((cd) => cd.warehouseId === targetWarehouseId)
          .map((cd) => ({
            salesOrderItemId: cd.item.salesOrderItemId,
            itemId: cd.item.itemId!,
            itemName: cd.item.itemName,
            quantity: Math.min(cd.item.remainingQuantity, cd.reservedQuantity),
          }))
          .filter((l) => l.quantity > 0);
        if (lines.length > 0) {
          instruction = {
            warehouseId: targetWarehouseId,
            warehouseName: warehouseNameCache.get(targetWarehouseId)!,
            items: lines,
          };
          lines.forEach((l) => externalCoveredItemIds.add(l.salesOrderItemId));
        }
      }

      // ---- INTERNAL(出庫)グルーピング: ロケーション単位で「唯一の候補で全量を賄えるか」を判定 ----
      const internalRemaining = remaining.filter((item) => !externalCoveredItemIds.has(item.salesOrderItemId));
      const shipmentItems: BulkPlanOrderShipment["items"] = [];
      const manualItems: BulkPlanManualItem[] = [];

      for (const item of internalRemaining) {
        const needed = item.remainingQuantity;
        const rows = await stockRepo.findAvailableStocksForItem(item.itemId!, "INTERNAL");

        // 同一ロケーションに複数ロット/品質区分が並立する場合、既存createShipment側の
        // resolveShipmentItems()は「複数在庫候補」400になるため、そのロケーションは
        // 単独行(単一ロット/品質区分)の場合に限り自動対象とする
        const byLocation = new Map<string, typeof rows>();
        for (const r of rows) {
          const arr = byLocation.get(r.locationId) || [];
          arr.push(r);
          byLocation.set(r.locationId, arr);
        }
        const sufficientSingleLineLocations = [...byLocation.entries()].filter(
          ([, group]) => group.length === 1 && group[0].quantity >= needed,
        );

        if (sufficientSingleLineLocations.length === 0) {
          manualItems.push({
            salesOrderItemId: item.salesOrderItemId,
            itemId: item.itemId,
            itemName: item.itemName,
            remainingQuantity: needed,
            reason: rows.length === 0 ? "NO_LOCATION_CANDIDATE" : "INSUFFICIENT_STOCK",
            candidateCount: rows.length === 0 ? 0 : byLocation.size,
          });
          continue;
        }
        if (sufficientSingleLineLocations.length > 1) {
          manualItems.push({
            salesOrderItemId: item.salesOrderItemId,
            itemId: item.itemId,
            itemName: item.itemName,
            remainingQuantity: needed,
            reason: "AMBIGUOUS_LOCATION",
            candidateCount: sufficientSingleLineLocations.length,
          });
          continue;
        }

        const [locationId, group] = sufficientSingleLineLocations[0];
        const stock = group[0];
        shipmentItems.push({
          salesOrderItemId: item.salesOrderItemId,
          itemId: item.itemId!,
          itemName: item.itemName,
          locationId,
          lotNumber: stock.lotNumber,
          qualityStatus: stock.qualityStatus,
          quantity: needed,
        });
      }

      results.push({
        orderId,
        partnerId: order.partnerId,
        instruction,
        shipment: shipmentItems.length > 0 ? { items: shipmentItems } : null,
        manualItems,
        skipped: false,
        error: null,
      });
    }
    return results;
  }

  // computeBulkShipmentPlan()をその場で再計算してから確定する(プレビュー〜確定の間に
  // 在庫/受注状態が変わっている可能性があるための防御)。既存のcreateInstruction/createShipment
  // をそのまま呼ぶことで、承認要否判定・在庫反映・監査ログ等を複製しない
  async executeBulkShipmentPlan(c: Context<{ Bindings: Env }>, orderIds: string[]) {
    const db = createDb(c.env.DB);
    const instructionsService = new ShipmentInstructionsService(ShipmentInstructionsRepository.fromDb(db));
    const shipmentsService = new ShipmentsService(ShipmentsRepository.fromDb(db));

    const plan = await this.computeBulkShipmentPlan(c, orderIds);
    const results: BulkExecuteOrderResult[] = [];

    let instructionSuccessCount = 0;
    let instructionFailCount = 0;
    let shipmentSuccessCount = 0;
    let shipmentFailCount = 0;
    const today = todayJst();

    for (const orderPlan of plan) {
      let instructionResult: BulkExecuteOrderResult["instruction"] = null;
      let shipmentResult: BulkExecuteOrderResult["shipment"] = null;

      if (orderPlan.instruction) {
        try {
          const input: CreateShipmentInstructionInput = {
            id: null,
            partnerId: orderPlan.partnerId,
            warehouseId: orderPlan.instruction.warehouseId,
            instructedShipDate: today,
            memo: null,
            items: orderPlan.instruction.items.map((it) => ({
              itemId: it.itemId,
              lotNumber: "NONE",
              accountCode: null,
              instructedQuantity: it.quantity,
              memo: null,
              salesOrderItemId: it.salesOrderItemId,
            })),
          };
          const created = await instructionsService.createInstruction(c, input);
          instructionResult = { status: "CREATED", headerId: created.headerId };
          instructionSuccessCount++;
        } catch (err) {
          instructionResult = {
            status: "FAILED",
            error: err instanceof Error ? err.message : "出荷指示の作成に失敗しました",
          };
          instructionFailCount++;
        }
      }

      if (orderPlan.shipment) {
        try {
          const input: CreateShipmentInput = {
            shippedDate: today,
            memo: null,
            partnerId: orderPlan.partnerId,
            shipmentInstructionId: null,
            items: orderPlan.shipment.items.map((it) => ({
              locationId: it.locationId,
              itemId: it.itemId,
              quantity: it.quantity,
              lotNumber: it.lotNumber,
              qualityStatus: it.qualityStatus,
              salesOrderItemId: it.salesOrderItemId,
            })),
          };
          const created = await shipmentsService.createShipment(c, input);
          shipmentResult = { status: "CREATED", headerId: created.headerId };
          shipmentSuccessCount++;
        } catch (err) {
          shipmentResult = {
            status: "FAILED",
            error: err instanceof Error ? err.message : "出庫の作成に失敗しました",
          };
          shipmentFailCount++;
        }
      }

      if (instructionResult || shipmentResult) {
        results.push({ orderId: orderPlan.orderId, instruction: instructionResult, shipment: shipmentResult });
      }
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXECUTE_BULK_SHIPMENT_FROM_SALES_ORDERS", RESOURCE_KEY, "BULK", null, {
        requestedCount: orderIds.length,
        instructionSuccessCount,
        instructionFailCount,
        shipmentSuccessCount,
        shipmentFailCount,
        details: results,
      }),
    );

    return {
      success: true,
      message: `一括作成が完了しました(出荷指示: 成功${instructionSuccessCount}/失敗${instructionFailCount}、出庫: 成功${shipmentSuccessCount}/失敗${shipmentFailCount})`,
      results,
    };
  }
}
