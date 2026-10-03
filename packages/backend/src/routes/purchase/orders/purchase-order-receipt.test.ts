import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { purchaseOrdersRouter } from "./index";
import { stockReceiptsRouter } from "../../inventory/receipts/index";

/**
 * Item9: 発注→入荷の消込連携(受注→出荷指示/出庫と同じ方針)。
 * (1) GET /:id/receipt-progress が発注数量/入荷済/残数量を正しく返す
 * (2) 入庫作成時、orderItemIdを紐付けた明細が発注明細の残数量を超える場合はブロックする
 */

const db = drizzle(env.DB, { schema });
const now = new Date();

const ORDER_ID = "PO-RECEIPT-TEST-1";
const ORDER_ITEM_ID = "POI-RECEIPT-TEST-1";

async function seedBase() {
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.itemReceiptItems);
  await db.delete(schema.itemReceiptHeaders);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
  await db.delete(schema.locations);
  await db.delete(schema.warehouses);
  await db.delete(schema.items);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
  await db.delete(schema.partners);

  await db.insert(schema.units).values({
    code: "PCS",
    name: "個",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.accounts).values({
    code: "ACC1",
    name: "品目",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.items).values({
    id: "ITEM1",
    name: "テスト品目",
    baseUnitCode: "PCS",
    accountCode: "ACC1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.warehouses).values({
    id: "WH1",
    name: "本社倉庫",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.locations).values({
    id: "LOC1",
    warehouseId: "WH1",
    name: "A-1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.partners).values({
    id: "PARTNER1",
    name: "テスト仕入先",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });

  await db.insert(schema.orders).values({
    id: ORDER_ID,
    title: "テスト発注",
    partnerId: "PARTNER1",
    orderDate: now,
    status: "APPROVED",
    totalAmount: 10000,
    taxAmount: 0,
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.orderItems).values({
    id: ORDER_ITEM_ID,
    orderId: ORDER_ID,
    itemId: "ITEM1",
    itemName: "テスト品目",
    inputType: "MASTER",
    quantity: 10,
    unitPrice: 1000,
    sortOrder: 0,
  });

  await env.COMPANY_SETTINGS.put("config", JSON.stringify({}));
}

beforeEach(async () => {
  await seedBase();
});

async function getReceiptProgress(orderId: string) {
  const ctx = createExecutionContext();
  const res = await purchaseOrdersRouter.request(`/${orderId}/receipt-progress`, {}, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function postReceipt(body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockReceiptsRouter.request(
    "/register",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

function baseReceiptBody(quantity: number, orderItemId?: string | null) {
  return {
    receivedDate: now.toISOString().slice(0, 10),
    orderId: ORDER_ID,
    items: [
      {
        itemId: "ITEM1",
        warehouseId: "WH1",
        locationId: "LOC1",
        quantity,
        orderItemId: orderItemId ?? ORDER_ITEM_ID,
      },
    ],
  };
}

describe("GET /purchase-orders/:id/receipt-progress", () => {
  it("入荷実績が無い場合、残数量=発注数量を返す", async () => {
    const res = await getReceiptProgress(ORDER_ID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ orderItemId: string; remainingQuantity: number }>;
    expect(body).toHaveLength(1);
    expect(body[0].orderItemId).toBe(ORDER_ITEM_ID);
    expect(body[0].remainingQuantity).toBe(10);
  });

  it("承認済み入庫が計上されると残数量が減る", async () => {
    const res = await postReceipt(baseReceiptBody(4));
    expect(res.status).toBe(200);

    const progressRes = await getReceiptProgress(ORDER_ID);
    const body = (await progressRes.json()) as Array<{ receivedQuantity: number; remainingQuantity: number }>;
    expect(body[0].receivedQuantity).toBe(4);
    expect(body[0].remainingQuantity).toBe(6);
  });

  it("存在しない発注IDは404を返す", async () => {
    const res = await getReceiptProgress("NOT-EXIST");
    expect(res.status).toBe(404);
  });
});

describe("発注紐付け入庫の残数量ブロック", () => {
  it("残数量内であれば入庫が成立し、item_receipt_items.order_item_idが保存される", async () => {
    const res = await postReceipt(baseReceiptBody(10));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { headerId: string };

    const items = await db
      .select()
      .from(schema.itemReceiptItems)
      .where(eq(schema.itemReceiptItems.receiptHeaderId, body.headerId));
    expect(items[0].orderItemId).toBe(ORDER_ITEM_ID);

    const headers = await db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(eq(schema.itemReceiptHeaders.id, body.headerId));
    expect(headers[0].orderId).toBe(ORDER_ID);
  });

  it("残数量を超える数量を指定すると400でブロックされる", async () => {
    const res = await postReceipt(baseReceiptBody(11));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("残数量");
  });

  it("複数回に分けて入荷しても、累計が残数量を超える3回目はブロックされる", async () => {
    const res1 = await postReceipt(baseReceiptBody(6));
    expect(res1.status).toBe(200);
    const res2 = await postReceipt(baseReceiptBody(4));
    expect(res2.status).toBe(200);
    const res3 = await postReceipt(baseReceiptBody(1));
    expect(res3.status).toBe(400);
  });
});

describe("BUG-065: サービス品目(isService)は入荷の対象外", () => {
  const SERVICE_ORDER_ITEM_ID = "PO-SVC-LINE";
  beforeEach(async () => {
    await db.insert(schema.items).values({
      id: "ITEM-SVC",
      name: "保守サービス",
      baseUnitCode: "PCS",
      accountCode: "ACC1",
      isService: true,
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.orderItems).values({
      id: SERVICE_ORDER_ITEM_ID,
      orderId: ORDER_ID,
      itemId: "ITEM-SVC",
      itemName: "保守サービス",
      inputType: "MASTER",
      quantity: 1,
      unitPrice: 5000,
      sortOrder: 1,
    });
  });

  it("入荷の残数量(入荷・入庫の画面用)に、サービス品目の明細を含めない", async () => {
    const body = (await (await getReceiptProgress(ORDER_ID)).json()) as Array<{ orderItemId: string }>;

    expect(body.map((b) => b.orderItemId)).toEqual([ORDER_ITEM_ID]);
  });

  it("サービス品目の発注明細を入庫しようとすると400になる", async () => {
    const res = await postReceipt({
      receivedDate: now.toISOString().slice(0, 10),
      orderId: ORDER_ID,
      items: [{ itemId: "ITEM-SVC", warehouseId: "WH1", locationId: "LOC1", quantity: 1, orderItemId: SERVICE_ORDER_ITEM_ID }],
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("サービス");
  });
});
