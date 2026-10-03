import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { Env } from "../../types/env";
import { salesOrdersAdapter } from "./sales-orders.adapter";

// BUG-048: 承認済みの受注の変更申請の承認時に、ヘッダー・明細・引当の記録・履歴を1回の batch で反映する
const db = drizzle(env.DB, { schema });
const now = new Date();

async function withHonoContext<T>(fn: (c: any) => Promise<T>): Promise<T> {
  const app = new Hono<{ Bindings: Env }>();
  let result!: T;
  let error: unknown = null;
  app.get("/run", async (c) => {
    try {
      result = await fn(c);
    } catch (e) {
      error = e;
    }
    return c.json({});
  });
  const ctx = createExecutionContext();
  await app.request("/run", {}, env, ctx);
  await waitOnExecutionContext(ctx);
  if (error) throw error;
  return result;
}

beforeEach(async () => {
  await db.delete(schema.masterApprovalContexts);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.salesOrderHistoryLogs);
  await db.delete(schema.salesOrderItemReservations);
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  await db.delete(schema.partners);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.put("config", JSON.stringify({ tax_rounding_mode: "floor" }));
  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "承認者太郎",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.partners).values({
    id: "P-1",
    name: "取引先1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.salesOrders).values({
    id: "SO-1",
    partnerId: "P-1",
    orderDate: now,
    status: "PENDING_UPDATE",
    totalAmount: 1100,
    taxAmount: 100,
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.salesOrderItems).values({
    id: "SOI-OLD",
    salesOrderId: "SO-1",
    itemId: "ITEM-1",
    itemName: "変更前の品目",
    quantity: 1,
    unitPrice: 1000,
    amount: 1000,
    sortOrder: 0,
  });
  await db.insert(schema.masterApprovalRequests).values({
    id: "REQ-1",
    targetType: "sales_orders",
    targetId: "SO-1",
    requestType: "UPDATE",
    status: "APPROVED",
    applicantId: "user-001",
    createdAt: now,
    updatedAt: now,
  });
});

async function seedSnapshot(items: Record<string, unknown>[]) {
  await db.insert(schema.masterApprovalContexts).values({
    id: "CTX-1",
    requestId: "REQ-1",
    generalMemo: JSON.stringify({
      header: { title: "変更後", partnerId: "P-1", totalAmount: 0, taxAmount: 0 },
      items,
      reservationOutcome: {
        items: [{ index: 0, itemId: "ITEM-2", backorderedQuantity: 1, reservations: [{ warehouseId: "WH-1", quantity: 2 }] }],
      },
    }),
    createdAt: now,
    createdBy: "EMP001",
    updatedAt: now,
    updatedBy: "EMP001",
  });
}

const approve = () =>
  withHonoContext((c) =>
    salesOrdersAdapter.applyApproved({
      db,
      reqParent: { id: "REQ-1", targetId: "SO-1", targetType: "sales_orders", requestType: "UPDATE", applicantId: "user-001" },
      userId: "user-001",
      now,
      c,
    }),
  );

describe("salesOrdersAdapter.applyApproved: UPDATE(BUG-048)", () => {
  it("ヘッダー・明細・入荷待ち数量・引当の記録・履歴をまとめて反映する", async () => {
    await seedSnapshot([{ itemId: "ITEM-2", itemName: "変更後の品目", quantity: 3, unitPrice: 1005 }]);
    await approve();

    const [order] = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, "SO-1"));
    expect(order.status).toBe("APPROVED");
    expect(order.title).toBe("変更後");
    expect(order.taxAmount).toBe(301); // 3,015円 × 10% の切り捨て
    const items = await db.select().from(schema.salesOrderItems).where(eq(schema.salesOrderItems.salesOrderId, "SO-1"));
    expect(items.map((i) => i.itemName)).toEqual(["変更後の品目"]);
    expect(items[0].backorderedQuantity).toBe(1);
    const ledger = await db.select().from(schema.salesOrderItemReservations);
    expect(ledger).toMatchObject([{ salesOrderItemId: items[0].id, warehouseId: "WH-1", reservedQuantity: 2 }]);
    expect(await db.select().from(schema.salesOrderHistoryLogs)).toHaveLength(1);
  });

  it("書き込みの途中で失敗した場合は何も反映せず、元の明細が残る(エラーを返す)", async () => {
    // 存在しない見積の明細を参照させて、明細の登録を外部キーの制約で失敗させる
    await seedSnapshot([{ itemId: "ITEM-2", itemName: "変更後の品目", quantity: 1, unitPrice: 100, sourceQuoteItemId: "QI-NOPE" }]);
    await expect(approve()).rejects.toThrow();

    const [order] = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, "SO-1"));
    expect(order.status).toBe("PENDING_UPDATE");
    const items = await db.select().from(schema.salesOrderItems).where(eq(schema.salesOrderItems.salesOrderId, "SO-1"));
    expect(items.map((i) => i.id)).toEqual(["SOI-OLD"]);
    expect(await db.select().from(schema.salesOrderHistoryLogs)).toHaveLength(0);
  });
});
