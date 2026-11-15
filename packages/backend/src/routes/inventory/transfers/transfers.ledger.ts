import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";

/**
 * REQ-006: 倉庫間移動の状態と入庫済み数を、出庫・入庫の状態から計算し直す(移動の画面と、出庫・入庫の承認(アダプター)から使う)。
 *  - 出庫が承認済み → 輸送中(入庫があれば一部入庫・入庫済み)。出庫が承認待ち・差戻し → 出庫の承認待ち。出庫が取り下げ → 取消。
 *  - 入庫済み数 = 承認済みの入庫の明細(stock_transfer_item_id)の合計。差異で完了した伝票は、状態を変えない(入庫済み数だけ直す)。
 */
type Db = any;

const SETTLED = 1e-9;

export async function recalculateTransfer(db: Db, transferId: string, now = new Date()): Promise<void> {
  const [transfer] = await db.select().from(schema.stockTransfers).where(eq(schema.stockTransfers.id, transferId)).limit(1);
  if (!transfer) return;
  const items = await db.select().from(schema.stockTransferItems).where(eq(schema.stockTransferItems.transferId, transferId));
  const received = await receivedByTransferItem(db, items.map((i: { id: string }) => i.id), ["APPROVED"]);
  for (const item of items) {
    const qty = received.get(item.id) ?? 0;
    if (qty !== item.receivedQuantity) {
      await db.update(schema.stockTransferItems).set({ receivedQuantity: qty }).where(eq(schema.stockTransferItems.id, item.id));
    }
  }

  let status = transfer.status;
  if (transfer.status !== "CLOSED_WITH_DIFFERENCE") {
    const shipmentStatus = await shipmentStatusOf(db, transfer.shipmentId);
    if (shipmentStatus === "CANCELED") status = "CANCELED";
    else if (shipmentStatus !== "APPROVED") status = "SHIPPING_PENDING";
    else {
      const totalReceived = items.reduce((sum: number, i: { id: string }) => sum + (received.get(i.id) ?? 0), 0);
      const allReceived = items.every(
        (i: { id: string; quantity: number }) => (received.get(i.id) ?? 0) + SETTLED >= i.quantity,
      );
      status = allReceived ? "RECEIVED" : totalReceived > 0 ? "PARTIALLY_RECEIVED" : "IN_TRANSIT";
    }
  }
  if (status !== transfer.status) {
    await db.update(schema.stockTransfers).set({ status, updatedAt: now }).where(eq(schema.stockTransfers.id, transferId));
  }
}

async function shipmentStatusOf(db: Db, shipmentId: string | null): Promise<string | null> {
  if (!shipmentId) return null;
  const [row] = await db
    .select({ status: schema.itemShipmentHeaders.status })
    .from(schema.itemShipmentHeaders)
    .where(eq(schema.itemShipmentHeaders.id, shipmentId))
    .limit(1);
  return row?.status ?? null;
}

// 移動の明細ごとの入庫の合計(入庫の状態で絞る)
export async function receivedByTransferItem(db: Db, transferItemIds: string[], statuses: string[]) {
  const totals = new Map<string, number>();
  if (transferItemIds.length === 0) return totals;
  const rows = await db
    .select({ transferItemId: schema.itemReceiptItems.stockTransferItemId, quantity: schema.itemReceiptItems.receivedQuantity })
    .from(schema.itemReceiptItems)
    .innerJoin(schema.itemReceiptHeaders, eq(schema.itemReceiptHeaders.id, schema.itemReceiptItems.receiptHeaderId))
    .where(
      and(
        inArray(schema.itemReceiptItems.stockTransferItemId, transferItemIds),
        inArray(schema.itemReceiptHeaders.status, statuses),
      ),
    );
  for (const r of rows) {
    if (!r.transferItemId) continue;
    totals.set(r.transferItemId, (totals.get(r.transferItemId) ?? 0) + Number(r.quantity));
  }
  return totals;
}

/**
 * 倉庫間移動の入庫の明細を確かめる(入庫の作成から呼ぶ)。移動先の倉庫・品目が移動の明細と同じで、
 * 入庫する数量が「出庫数 − 入庫済み − 差異 − 承認待ちの入庫」を超えないこと。輸送中・一部入庫の移動だけ入庫できる
 */
export async function assertTransferReceiptLine(
  db: Db,
  line: { stockTransferItemId: string; itemId: string; warehouseId: string; quantity: number },
): Promise<void> {
  const [item] = await db
    .select()
    .from(schema.stockTransferItems)
    .where(eq(schema.stockTransferItems.id, line.stockTransferItemId))
    .limit(1);
  if (!item) throw new NotFoundError(`倉庫間移動の明細が見つかりません: ${line.stockTransferItemId}`);
  const [transfer] = await db.select().from(schema.stockTransfers).where(eq(schema.stockTransfers.id, item.transferId)).limit(1);
  if (!transfer) throw new NotFoundError(`倉庫間移動が見つかりません: ${item.transferId}`);
  if (transfer.status !== "IN_TRANSIT" && transfer.status !== "PARTIALLY_RECEIVED") {
    throw new BadRequestError(`倉庫間移動[${transfer.id}]は輸送中ではないため入庫できません`);
  }
  if (transfer.destinationWarehouseId !== line.warehouseId) {
    throw new BadRequestError(`倉庫間移動[${transfer.id}]の移動先の倉庫[${transfer.destinationWarehouseId}]と入庫の倉庫が違います`);
  }
  if (item.itemId !== line.itemId) {
    throw new BadRequestError(`倉庫間移動[${transfer.id}]の明細の品目[${item.itemId}]と入庫の品目が違います`);
  }
  const pending = (await receivedByTransferItem(db, [item.id], ["UNAPPROVED", "REMANDED"])).get(item.id) ?? 0;
  const remaining = item.quantity - item.receivedQuantity - item.differenceQuantity - pending;
  if (line.quantity > remaining + SETTLED) {
    throw new BadRequestError(
      `入庫する数量(${line.quantity})が、倉庫間移動[${transfer.id}]の輸送中の残り(承認待ちの入庫を除く ${Math.max(remaining, 0)})を超えています`,
    );
  }
}

// 出庫・入庫の承認・差戻し・取下げの後に、その出庫・入庫が属する倉庫間移動を計算し直す(inventory-stock.adapter.ts から呼ぶ)
export async function recalculateTransfersOfShipment(db: Db, shipmentId: string, now = new Date()): Promise<void> {
  await linkShipmentFromInstruction(db, shipmentId);
  const rows = await db
    .select({ id: schema.stockTransfers.id })
    .from(schema.stockTransfers)
    .where(eq(schema.stockTransfers.shipmentId, shipmentId));
  for (const r of rows) await recalculateTransfer(db, r.id, now);
}

export async function recalculateTransfersOfReceipt(db: Db, receiptId: string, now = new Date()): Promise<void> {
  const lines = await db
    .select({ transferItemId: schema.itemReceiptItems.stockTransferItemId })
    .from(schema.itemReceiptItems)
    .where(eq(schema.itemReceiptItems.receiptHeaderId, receiptId));
  const ids = lines.map((l: { transferItemId: string | null }) => l.transferItemId).filter(Boolean) as string[];
  if (ids.length === 0) return;
  const items = await db
    .select({ transferId: schema.stockTransferItems.transferId })
    .from(schema.stockTransferItems)
    .where(inArray(schema.stockTransferItems.id, ids));
  for (const transferId of new Set(items.map((i: { transferId: string }) => i.transferId))) {
    await recalculateTransfer(db, transferId as string, now);
  }
}

/**
 * 移動元が外部倉庫の移動: 出荷指示の実績の取込で作られた出庫を、その指示の倉庫間移動に結び付ける。
 * 明細の数量・ロケーション・勘定科目は、実際の出庫に合わせる(品目・ロットで突き合わせる)
 */
async function linkShipmentFromInstruction(db: Db, shipmentId: string): Promise<void> {
  const [shipment] = await db
    .select()
    .from(schema.itemShipmentHeaders)
    .where(eq(schema.itemShipmentHeaders.id, shipmentId))
    .limit(1);
  if (!shipment?.shipmentInstructionId) return;
  const [transfer] = await db
    .select()
    .from(schema.stockTransfers)
    .where(eq(schema.stockTransfers.shipmentInstructionId, shipment.shipmentInstructionId))
    .limit(1);
  if (!transfer || transfer.shipmentId) return;
  await db.update(schema.stockTransfers).set({ shipmentId }).where(eq(schema.stockTransfers.id, transfer.id));
  const shipped = await db.select().from(schema.itemShipmentItems).where(eq(schema.itemShipmentItems.shipmentHeaderId, shipmentId));
  const items = await db.select().from(schema.stockTransferItems).where(eq(schema.stockTransferItems.transferId, transfer.id));
  for (const item of items) {
    const lines = shipped.filter(
      (s: { itemId: string; lotNumber: string }) => s.itemId === item.itemId && (item.lotNumber === "NONE" || s.lotNumber === item.lotNumber),
    );
    if (lines.length === 0) continue;
    await db
      .update(schema.stockTransferItems)
      .set({
        quantity: lines.reduce((sum: number, l: { shippedQuantity: number }) => sum + Number(l.shippedQuantity), 0),
        sourceLocationId: lines[0].locationId,
        accountCode: lines[0].accountCode,
        lotNumber: lines[0].lotNumber,
      })
      .where(eq(schema.stockTransferItems.id, item.id));
  }
}

/**
 * 移動先が外部倉庫の移動: 入荷指示の実績の取込で作る入庫の明細に、倉庫間移動の明細を付ける(品目・ロットで突き合わせる)。
 * 入庫の作成(receipts.service.ts)が、入荷指示を指定した入庫の時に呼ぶ
 */
export async function assignTransferItemsToReceiptLines<T extends { itemId: string; lotNumber?: string | null; stockTransferItemId?: string | null }>(
  db: Db,
  receiptInstructionId: string | null | undefined,
  lines: T[],
): Promise<T[]> {
  if (!receiptInstructionId) return lines;
  const [transfer] = await db
    .select()
    .from(schema.stockTransfers)
    .where(eq(schema.stockTransfers.receiptInstructionId, receiptInstructionId))
    .limit(1);
  if (!transfer) return lines;
  const items = await db.select().from(schema.stockTransferItems).where(eq(schema.stockTransferItems.transferId, transfer.id));
  return lines.map((line) => {
    if (line.stockTransferItemId) return line;
    const item =
      items.find((i: { itemId: string; lotNumber: string }) => i.itemId === line.itemId && i.lotNumber === (line.lotNumber || "NONE")) ??
      items.find((i: { itemId: string }) => i.itemId === line.itemId);
    return item ? { ...line, stockTransferItemId: item.id } : line;
  });
}
