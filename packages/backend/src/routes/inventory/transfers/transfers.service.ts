import { Context } from "hono";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { createDb } from "../../../platform/db/create-db";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { ShipmentsService } from "../shipments/shipments.service";
import { ShipmentsRepository } from "../shipments/shipments.repository";
import { ReceiptsService } from "../receipts/receipts.service";
import { ReceiptsRepository } from "../receipts/receipts.repository";
import { ShipmentInstructionsService } from "../shipment-instructions/shipment-instructions.service";
import { ShipmentInstructionsRepository } from "../shipment-instructions/shipment-instructions.repository";
import { ReceiptInstructionsService } from "../receipt-instructions/receipt-instructions.service";
import { ReceiptInstructionsRepository } from "../receipt-instructions/receipt-instructions.repository";
import {
  CloseStockTransferInput,
  CreateStockTransferInput,
  ReceiveStockTransferInput,
  SearchStockTransfersQuery,
} from "./transfers.schema";
import { receivedByTransferItem, recalculateTransfer } from "./transfers.ledger";
import { requireWarehousePartner } from "../../../platform/partners/warehouse-partner";

export const RESOURCE_KEY = "inventory_stock_transfers";

/**
 * REQ-006: 倉庫間移動(横持ち)。実際の在庫の増減は、今の出庫(移動元)・入庫(移動先)で行い、この伝票がそれを束ねる。
 *  - 移動元が自社倉庫: 移動の作成で出庫を作る(出庫の承認の流れを通る)。外部倉庫: 出荷指示を作り、出荷の実績の取込で作られた出庫を移動に結び付ける。
 *  - 移動先が自社倉庫: 移動の画面から入庫する(分けて入庫できる)。外部倉庫: 入荷指示を作り、入荷の実績の取込で作られた入庫を移動の明細に消し込む。
 *  - 指示書の取引先には、相手の倉庫と同じ番号の取引先(種類 WAREHOUSE。倉庫マスタに合わせて作る。platform/partners/warehouse-partner.ts)を入れる。
 *  - 届かない分は「差異で完了」で閉じ、差異の数量を記録する(在庫は戻さない)。輸送中の数量は、どちらの倉庫の在庫数にも含めない。
 */
export class StockTransfersService {
  async list(c: Context<{ Bindings: Env }>, query: SearchStockTransfersQuery) {
    const db = createDb(c.env.DB);
    const t = schema.stockTransfers;
    const keyword = query.keyword?.trim();
    const transfers = await db
      .select()
      .from(t)
      .where(
        combineConditions([
          query.status && query.status !== "all" ? eq(t.status, query.status) : undefined,
          query.warehouseId ? or(eq(t.sourceWarehouseId, query.warehouseId), eq(t.destinationWarehouseId, query.warehouseId)) : undefined,
          keyword ? or(like(t.id, `%${keyword}%`), like(t.shipmentId, `%${keyword}%`), like(t.memo, `%${keyword}%`)) : undefined,
        ]),
      )
      .orderBy(desc(t.shippedDate), desc(t.id));
    const items = transfers.length
      ? await db.select().from(schema.stockTransferItems).where(inArray(schema.stockTransferItems.transferId, transfers.map((x) => x.id)))
      : [];
    return transfers.map((x) => ({ ...x, items: items.filter((i) => i.transferId === x.id) }));
  }

  async getDetail(c: Context<{ Bindings: Env }>, id: string) {
    const db = createDb(c.env.DB);
    const [transfer] = await db.select().from(schema.stockTransfers).where(eq(schema.stockTransfers.id, id)).limit(1);
    if (!transfer) throw new NotFoundError("対象の倉庫間移動が見つかりません");
    const items = await db
      .select()
      .from(schema.stockTransferItems)
      .where(eq(schema.stockTransferItems.transferId, id))
      .orderBy(schema.stockTransferItems.sortOrder);
    const pending = await receivedByTransferItem(db, items.map((i) => i.id), ["UNAPPROVED", "REMANDED"]);
    // この移動の入庫(状態つき)
    const receipts = items.length
      ? await db
          .selectDistinct({ id: schema.itemReceiptHeaders.id, status: schema.itemReceiptHeaders.status, receivedDate: schema.itemReceiptHeaders.receivedDate })
          .from(schema.itemReceiptItems)
          .innerJoin(schema.itemReceiptHeaders, eq(schema.itemReceiptHeaders.id, schema.itemReceiptItems.receiptHeaderId))
          .where(inArray(schema.itemReceiptItems.stockTransferItemId, items.map((i) => i.id)))
      : [];
    const [shipment] = transfer.shipmentId
      ? await db
          .select({ id: schema.itemShipmentHeaders.id, status: schema.itemShipmentHeaders.status })
          .from(schema.itemShipmentHeaders)
          .where(eq(schema.itemShipmentHeaders.id, transfer.shipmentId))
      : [];
    return {
      ...transfer,
      items: items.map((i) => ({ ...i, pendingReceiptQuantity: pending.get(i.id) ?? 0 })),
      shipment: shipment ?? null,
      receipts,
    };
  }

  /** 輸送中の在庫(在庫照会に出す)。出庫が承認済みで、まだ入庫も差異もしていない数量 */
  async listInTransit(c: Context<{ Bindings: Env }>, query: { itemId?: string; warehouseId?: string }) {
    const db = createDb(c.env.DB);
    const rows = await db
      .select({ transfer: schema.stockTransfers, item: schema.stockTransferItems })
      .from(schema.stockTransferItems)
      .innerJoin(schema.stockTransfers, eq(schema.stockTransfers.id, schema.stockTransferItems.transferId))
      .where(
        and(
          inArray(schema.stockTransfers.status, ["IN_TRANSIT", "PARTIALLY_RECEIVED"]),
          query.itemId ? eq(schema.stockTransferItems.itemId, query.itemId) : undefined,
          query.warehouseId
            ? or(eq(schema.stockTransfers.sourceWarehouseId, query.warehouseId), eq(schema.stockTransfers.destinationWarehouseId, query.warehouseId))
            : undefined,
        ),
      );
    return rows
      .map(({ transfer, item }) => ({
        transferId: transfer.id,
        shippedDate: transfer.shippedDate,
        sourceWarehouseId: transfer.sourceWarehouseId,
        destinationWarehouseId: transfer.destinationWarehouseId,
        itemId: item.itemId,
        lotNumber: item.lotNumber,
        quantity: item.quantity - item.receivedQuantity - item.differenceQuantity,
      }))
      .filter((r) => r.quantity > 1e-9);
  }

  async create(c: Context<{ Bindings: Env }>, input: CreateStockTransferInput) {
    const db = createDb(c.env.DB);
    if (input.sourceWarehouseId === input.destinationWarehouseId) {
      throw new BadRequestError("移動元と移動先の倉庫が同じです");
    }
    const warehouses = await db
      .select()
      .from(schema.warehouses)
      .where(inArray(schema.warehouses.id, [input.sourceWarehouseId, input.destinationWarehouseId]));
    const source = warehouses.find((w) => w.id === input.sourceWarehouseId);
    const destination = warehouses.find((w) => w.id === input.destinationWarehouseId);
    if (!source) throw new NotFoundError(`移動元の倉庫が見つかりません: ${input.sourceWarehouseId}`);
    if (!destination) throw new NotFoundError(`移動先の倉庫が見つかりません: ${input.destinationWarehouseId}`);
    if (source.warehouseType === "DIRECT" || destination.warehouseType === "DIRECT") {
      throw new BadRequestError("直送用の倉庫は倉庫間移動に使えません");
    }
    const sourceExternal = source.warehouseType === "EXTERNAL";
    const destinationExternal = destination.warehouseType === "EXTERNAL";
    if (!sourceExternal && input.items.some((i) => !i.locationId)) {
      throw new BadRequestError("移動元が自社倉庫の時は、明細ごとに移動元のロケーションを指定してください");
    }

    const operator = await resolveOperatorEmployeeNumber(c, db);
    const id = await resolveConfiguredDocumentId(
      c,
      "stock_transfer",
      async (candidate) => (await db.select({ id: schema.stockTransfers.id }).from(schema.stockTransfers).where(eq(schema.stockTransfers.id, candidate))).length > 0,
      null,
    );
    const now = new Date();
    const shippedDate = new Date(input.shippedDate);
    if (Number.isNaN(shippedDate.getTime())) throw new BadRequestError("出庫日が不正です");
    const memo = `倉庫間移動[${id}] ${source.name} → ${destination.name}${input.memo ? ` ${input.memo}` : ""}`;

    await db.insert(schema.stockTransfers).values({
      id,
      sourceWarehouseId: source.id,
      destinationWarehouseId: destination.id,
      shippedDate,
      status: "SHIPPING_PENDING",
      memo: input.memo || null,
      createdBy: operator,
      createdAt: now,
      updatedBy: operator,
      updatedAt: now,
    });

    try {
      let shipmentId: string | null = null;
      let shipmentInstructionId: string | null = null;
      let receiptInstructionId: string | null = null;
      if (sourceExternal) {
        // 移動元が外部倉庫: 出荷指示(宛先は移動先の倉庫)。実績の取込で出庫が作られる
        const partnerId = await requireWarehousePartner(db, destination.id);
        const result = await new ShipmentInstructionsService(new ShipmentInstructionsRepository(c.env.DB)).createInstruction(c, {
          partnerId,
          warehouseId: source.id,
          instructedShipDate: input.shippedDate,
          items: input.items.map((i) => ({ itemId: i.itemId, lotNumber: i.lotNumber || "NONE", instructedQuantity: i.quantity })),
          memo,
          applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId ?? null,
        } as Parameters<ShipmentInstructionsService["createInstruction"]>[1]);
        shipmentInstructionId = result.headerId;
      } else {
        const result = await new ShipmentsService(new ShipmentsRepository(c.env.DB)).createShipment(c, {
          shippedDate: input.shippedDate,
          items: input.items.map((i) => ({
            itemId: i.itemId,
            locationId: i.locationId!,
            lotNumber: i.lotNumber || null,
            qualityStatus: i.qualityStatus || null,
            quantity: i.quantity,
          })),
          memo,
          destinationWarehouseId: destination.id,
          applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId ?? null,
        } as Parameters<ShipmentsService["createShipment"]>[1]);
        shipmentId = result.headerId;
      }
      if (destinationExternal) {
        // 移動先が外部倉庫: 入荷指示(送り主は移動元の倉庫)。実績の取込で作られた入庫を、移動の明細に消し込む
        const partnerId = await requireWarehousePartner(db, source.id);
        const result = await new ReceiptInstructionsService(new ReceiptInstructionsRepository(c.env.DB)).createInstruction(c, {
          partnerId,
          warehouseId: destination.id,
          instructedReceiveDate: input.shippedDate,
          items: input.items.map((i) => ({ itemId: i.itemId, lotNumber: i.lotNumber || "NONE", instructedQuantity: i.quantity })),
          memo,
          applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId ?? null,
        } as Parameters<ReceiptInstructionsService["createInstruction"]>[1]);
        receiptInstructionId = result.headerId;
      }

      // 明細(自社倉庫から出す時は、出庫の明細から勘定科目・ロット・ロケーションを引き継ぐ)
      const shipmentItems = shipmentId ? await ShipmentsRepository.fromDb(db).findItemsByHeaderId(shipmentId) : [];
      const rows = input.items.map((i, index) => {
        const shipped = shipmentItems[index] as { accountCode?: string; lotNumber?: string; locationId?: string } | undefined;
        return {
          id: crypto.randomUUID(),
          transferId: id,
          itemId: i.itemId,
          lotNumber: shipped?.lotNumber || i.lotNumber || "NONE",
          accountCode: shipped?.accountCode ?? null,
          sourceLocationId: shipped?.locationId ?? i.locationId ?? null,
          quantity: i.quantity,
          sortOrder: index,
        };
      });
      await db.insert(schema.stockTransferItems).values(rows);
      await db
        .update(schema.stockTransfers)
        .set({ shipmentId, shipmentInstructionId, receiptInstructionId })
        .where(eq(schema.stockTransfers.id, id));
      await recalculateTransfer(db, id, now);
    } catch (err) {
      // 出庫・指示書を作れなかった時は、移動の伝票も残さない
      await db.delete(schema.stockTransfers).where(eq(schema.stockTransfers.id, id));
      throw err;
    }

    const [created] = await db.select().from(schema.stockTransfers).where(eq(schema.stockTransfers.id, id));
    c.executionCtx.waitUntil(logAuditEvent(c, "CREATE_STOCK_TRANSFER", RESOURCE_KEY, id, null, { ...input, id, status: created.status }));
    return {
      success: true,
      id,
      status: created.status,
      message:
        created.status === "IN_TRANSIT"
          ? "出庫を確定し、輸送中にしました"
          : sourceExternal
            ? "出荷指示を作りました(出荷の実績を取り込むと輸送中になります)"
            : "出庫の承認を申請しました(出庫が承認されると輸送中になります)",
    };
  }

  async receive(c: Context<{ Bindings: Env }>, id: string, input: ReceiveStockTransferInput) {
    const detail = await this.getDetail(c, id);
    if (detail.receiptInstructionId) {
      throw new BadRequestError("移動先が外部倉庫のため、入荷指示の実績の取込で入庫してください");
    }
    const items = input.items.map((line) => {
      const item = detail.items.find((i) => i.id === line.transferItemId);
      if (!item) throw new BadRequestError(`倉庫間移動[${id}]に無い明細です: ${line.transferItemId}`);
      return {
        itemId: item.itemId,
        warehouseId: detail.destinationWarehouseId,
        locationId: line.locationId,
        lotNumber: item.lotNumber,
        accountCode: item.accountCode,
        quantity: line.quantity,
        inspectionStatus: line.inspectionStatus,
        stockTransferItemId: item.id,
      };
    });
    const result = await new ReceiptsService(new ReceiptsRepository(c.env.DB)).createReceipt(c, {
      receivedDate: input.receivedDate,
      items,
      memo: `倉庫間移動[${id}]の入庫`,
      sourceWarehouseId: detail.sourceWarehouseId,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId ?? null,
    } as Parameters<ReceiptsService["createReceipt"]>[1]);
    const db = createDb(c.env.DB);
    await recalculateTransfer(db, id);
    const [after] = await db.select().from(schema.stockTransfers).where(eq(schema.stockTransfers.id, id));
    c.executionCtx.waitUntil(logAuditEvent(c, "RECEIVE_STOCK_TRANSFER", RESOURCE_KEY, id, null, { receiptId: result.headerId, items: input.items }));
    return { success: true, receiptId: result.headerId, status: after.status, message: result.message };
  }

  // 届かない分を差異として閉じる(在庫は戻さない)。承認待ちの入庫がある間はできない
  async closeWithDifference(c: Context<{ Bindings: Env }>, id: string, input: CloseStockTransferInput) {
    const detail = await this.getDetail(c, id);
    if (detail.status !== "IN_TRANSIT" && detail.status !== "PARTIALLY_RECEIVED") {
      throw new BadRequestError("輸送中・一部入庫の倉庫間移動だけ差異で完了できます");
    }
    if (detail.items.some((i) => i.pendingReceiptQuantity > 0)) {
      throw new BadRequestError("承認待ちの入庫があるため差異で完了できません(入庫が承認されるか取り下げられてから完了してください)");
    }
    const db = createDb(c.env.DB);
    const operator = await resolveOperatorEmployeeNumber(c, db);
    const now = new Date();
    for (const item of detail.items) {
      const difference = Math.max(item.quantity - item.receivedQuantity, 0);
      await db.update(schema.stockTransferItems).set({ differenceQuantity: difference }).where(eq(schema.stockTransferItems.id, item.id));
    }
    await db
      .update(schema.stockTransfers)
      .set({ status: "CLOSED_WITH_DIFFERENCE", closedReason: input.reason, updatedBy: operator, updatedAt: now })
      .where(eq(schema.stockTransfers.id, id));
    c.executionCtx.waitUntil(
      logAuditEvent(c, "CLOSE_STOCK_TRANSFER_WITH_DIFFERENCE", RESOURCE_KEY, id, detail, {
        reason: input.reason,
        differences: detail.items.map((i) => ({ itemId: i.itemId, difference: Math.max(i.quantity - i.receivedQuantity, 0) })),
      }),
    );
    return { success: true, message: "差異で完了しました(届かなかった数量を差異として記録しました)" };
  }
}
