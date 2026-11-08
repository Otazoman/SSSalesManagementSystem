import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";
import { WorkflowTasksService } from "../../workflow/workflow-tasks/workflow-tasks.service";
import { purchaseOrdersRouter } from "./index";

vi.mock("../../../workflow-engine/notifier", () => ({
  sendWorkflowMail: vi.fn(async () => {}),
  notifyApprovalRequestSubmitted: vi.fn(async () => {}),
}));

// REQ-005 第2段階: 直送の発注の「直送完了」。直送用の倉庫への入庫と得意先への出庫を同時に確定し、
// 受注明細の欠品・引当を外すこと、承認機能が有効なら入庫の承認1回で両方を確定・差戻しすることを確かめる。
// ヘルパー関数は既存の慣習(inventory/shipments/index.test.ts等)にならい、このファイルに複製している

const db = drizzle(env.DB, { schema });
const now = new Date();

async function buildSessionCookieHeader(userId: string): Promise<string> {
  const token = await signSessionToken(
    {
      userId,
      employeeNumber: userId,
      name: "テストユーザー",
      role: "user",
      deptName: "テスト部署",
      companyName: "テスト会社",
      isAuditEnabled: true,
    },
    await env.SESSION_SECRET.get(),
    3600,
  );
  return `session_token=${token}`;
}

async function callCompletion(orderId: string, payload: unknown, userId = "buyer-1") {
  const ctx = createExecutionContext();
  const res = await purchaseOrdersRouter.request(
    `/${orderId}/direct-shipment-completion`,
    {
      method: "POST",
      headers: { Cookie: await buildSessionCookieHeader(userId), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function callWorkflow(path: "/approve" | "/remand", params: { logId: string; requestId: string; userId: string }) {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/approve", async (c) => c.json(await WorkflowTasksService.approveTask(c, db, await c.req.json())));
  app.post("/remand", async (c) => c.json(await WorkflowTasksService.remandTask(c, db, await c.req.json())));
  const ctx = createExecutionContext();
  const res = await app.request(
    path,
    {
      method: "POST",
      headers: { Cookie: await buildSessionCookieHeader(params.userId), "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function seedUser(id: string) {
  await db.insert(schema.users).values({
    id,
    employeeNumber: id,
    email: `${id}@example.com`,
    name: id,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

const audit = { createdBy: "system", createdAt: now, updatedBy: "system", updatedAt: now };

// 受注 SO-1(数量5、欠品3、自社倉庫WH1で2を引当)と、その明細から作った直送の発注 PO-1(数量5、確定済み)
async function seedDirectOrder(options: { poStatus?: string; isDirectShipment?: boolean } = {}) {
  await db.insert(schema.salesOrders).values({
    id: "SO-1",
    partnerId: "CUST-1",
    orderDate: now,
    status: "APPROVED",
    ...audit,
  });
  await db.insert(schema.salesOrderItems).values({
    id: "SOI-1",
    salesOrderId: "SO-1",
    itemId: "ITEM1",
    inputType: "MASTER",
    quantity: 5,
    unitPrice: 100,
    amount: 500,
    sortOrder: 0,
    backorderedQuantity: 3,
  });
  await db.insert(schema.warehouseStockReservations).values({
    itemId: "ITEM1",
    warehouseId: "WH1",
    reservedQuantity: 2,
    updatedAt: now,
  });
  await db.insert(schema.salesOrderItemReservations).values({
    id: "RES-1",
    salesOrderItemId: "SOI-1",
    warehouseId: "WH1",
    reservedQuantity: 2,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.orders).values({
    id: "PO-1",
    title: "直送の発注",
    partnerId: "SUP-1",
    orderDate: now,
    status: options.poStatus ?? "APPROVED",
    isDirectShipment: options.isDirectShipment ?? true,
    directSalesOrderId: options.isDirectShipment === false ? null : "SO-1",
    totalAmount: 0,
    taxAmount: 0,
    ...audit,
  });
  await db.insert(schema.orderItems).values({
    id: "POI-1",
    orderId: "PO-1",
    itemId: "ITEM1",
    itemName: "テスト品目",
    inputType: "MASTER",
    quantity: 5,
    unitPrice: 80,
    sortOrder: 0,
    salesOrderItemId: "SOI-1",
  });
}

async function findReceipts() {
  return db.select().from(schema.itemReceiptHeaders).where(eq(schema.itemReceiptHeaders.orderId, "PO-1"));
}

async function findShipments() {
  return db.select().from(schema.itemShipmentHeaders).where(eq(schema.itemShipmentHeaders.salesOrderId, "SO-1"));
}

async function findSalesOrderItem() {
  const [row] = await db.select().from(schema.salesOrderItems).where(eq(schema.salesOrderItems.id, "SOI-1"));
  return row;
}

async function findWh1Reserved() {
  const [row] = await db
    .select()
    .from(schema.warehouseStockReservations)
    .where(eq(schema.warehouseStockReservations.warehouseId, "WH1"));
  return row?.reservedQuantity ?? 0;
}

beforeEach(async () => {
  await env.COMPANY_SETTINGS.put("config", JSON.stringify({}));
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.itemShipmentItems);
  await db.delete(schema.itemShipmentHeaders);
  await db.delete(schema.itemReceiptItems);
  await db.delete(schema.itemReceiptHeaders);
  await db.delete(schema.salesOrderItemReservations);
  await db.delete(schema.warehouseStockReservations);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
  await db.delete(schema.salesOrderHistoryLogs);
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  await db.delete(schema.workflowLogs);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.userRoles);
  await db.delete(schema.roles);
  await db.delete(schema.locations);
  await db.delete(schema.warehouses);
  await db.delete(schema.items);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
  await db.delete(schema.partners);
  await db.delete(schema.users);

  await seedUser("buyer-1");
  await db.insert(schema.units).values({ code: "PCS", name: "個", ...audit });
  await db.insert(schema.accounts).values({ code: "ACC1", name: "商品", ...audit });
  await db.insert(schema.items).values({ id: "ITEM1", name: "テスト品目", baseUnitCode: "PCS", accountCode: "ACC1", ...audit });
  await db.insert(schema.partners).values({ id: "CUST-1", name: "得意先", creditLimit: 0, ...audit });
  await db.insert(schema.partners).values({ id: "SUP-1", name: "仕入先", creditLimit: 0, ...audit });
  await db.insert(schema.warehouses).values({ id: "WH1", name: "本社倉庫", ...audit });
});

describe("直送完了(承認機能が無効)", () => {
  it("直送用の倉庫への入庫と得意先への出庫を確定し、在庫は0に戻る。欠品を先に減らし、残りは自社倉庫の引当を外す", async () => {
    await seedDirectOrder();

    const res = await callCompletion("PO-1", { completedDate: "2026-11-08", items: [{ orderItemId: "POI-1", quantity: 4 }] });
    expect(res.status).toBe(200);

    const [warehouse] = await db.select().from(schema.warehouses).where(eq(schema.warehouses.warehouseType, "DIRECT"));
    expect(warehouse).toBeDefined();

    const receipts = await findReceipts();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ status: "APPROVED", partnerId: "SUP-1" });
    const receiptItems = await db
      .select()
      .from(schema.itemReceiptItems)
      .where(eq(schema.itemReceiptItems.receiptHeaderId, receipts[0].id));
    expect(receiptItems[0]).toMatchObject({ orderItemId: "POI-1", warehouseId: warehouse.id, receivedQuantity: 4 });

    const shipments = await findShipments();
    expect(shipments).toHaveLength(1);
    expect(shipments[0]).toMatchObject({ status: "APPROVED", partnerId: "CUST-1", directReceiptHeaderId: receipts[0].id });
    const shipmentItems = await db
      .select()
      .from(schema.itemShipmentItems)
      .where(eq(schema.itemShipmentItems.shipmentHeaderId, shipments[0].id));
    expect(shipmentItems[0]).toMatchObject({ salesOrderItemId: "SOI-1", warehouseId: warehouse.id, shippedQuantity: 4 });

    const stocks = await db.select().from(schema.stocks).where(eq(schema.stocks.warehouseId, warehouse.id));
    expect(stocks.reduce((sum, s) => sum + s.quantity, 0)).toBe(0);

    // 4のうち3は欠品から、残り1は自社倉庫の引当(2)から外す
    expect((await findSalesOrderItem()).backorderedQuantity).toBe(0);
    expect(await findWh1Reserved()).toBe(1);
    const [ledger] = await db
      .select()
      .from(schema.salesOrderItemReservations)
      .where(eq(schema.salesOrderItemReservations.salesOrderItemId, "SOI-1"));
    expect(ledger.reservedQuantity).toBe(1);

    const [salesOrder] = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, "SO-1"));
    expect(salesOrder.shipmentStatus).toBe("PARTIALLY_SHIPPED");
  });

  it("直送用の倉庫は、倉庫の一覧に出さない(includeDirect=true の時だけ出す)", async () => {
    await seedDirectOrder();
    await callCompletion("PO-1", { completedDate: "2026-11-08", items: [{ orderItemId: "POI-1", quantity: 1 }] });

    const { warehousesRouter } = await import("../../master/warehouses/index");
    const list = async (query: string) => {
      const ctx = createExecutionContext();
      const res = await warehousesRouter.request(`/${query}`, {}, env, ctx);
      await waitOnExecutionContext(ctx);
      return ((await res.json()) as Array<{ id: string; warehouseType: string }>).map((w) => w.warehouseType);
    };
    expect(await list("?status=all")).not.toContain("DIRECT");
    expect(await list("?status=all&includeDirect=true")).toContain("DIRECT");
  });

  it("直送の発注でない・確定前・残数量を超える場合は400で、入庫・出庫を作らない", async () => {
    await seedDirectOrder({ isDirectShipment: false });
    expect((await callCompletion("PO-1", { completedDate: "2026-11-08", items: [{ orderItemId: "POI-1", quantity: 1 }] })).status).toBe(400);

    await db.update(schema.orders).set({ isDirectShipment: true, directSalesOrderId: "SO-1", status: "DRAFT" });
    expect((await callCompletion("PO-1", { completedDate: "2026-11-08", items: [{ orderItemId: "POI-1", quantity: 1 }] })).status).toBe(400);

    await db.update(schema.orders).set({ status: "APPROVED" });
    expect((await callCompletion("PO-1", { completedDate: "2026-11-08", items: [{ orderItemId: "POI-1", quantity: 6 }] })).status).toBe(400);

    expect(await findReceipts()).toHaveLength(0);
    expect(await findShipments()).toHaveLength(0);
  });
});

describe("直送完了(承認機能が有効)", () => {
  async function seedApprovalFlow() {
    await seedUser("approver-1");
    await db.insert(schema.roles).values({ id: "approver_role", name: "approver_role", createdAt: now });
    await db.insert(schema.userRoles).values({ userId: "approver-1", roleId: "approver_role", departmentSurrogateId: null });
    await db.insert(schema.approvalFlows).values({
      id: "flow-inventory-stock",
      name: "flow-inventory-stock",
      requestType: "inventory_stock",
      minAmount: 0,
      maxAmount: 999999999,
      isActive: true,
    });
    await db.insert(schema.approvalFlowSteps).values({
      id: "flow-inventory-stock-step-1",
      flowId: "flow-inventory-stock",
      stepOrder: 1,
      approverRoleId: "approver_role",
    });
    await env.COMPANY_SETTINGS.put("config", JSON.stringify({ is_receiving_approval_enabled: true }));
  }

  async function findTask(receiptId: string) {
    const [log] = await db.select().from(schema.workflowLogs).where(eq(schema.workflowLogs.targetId, receiptId));
    const [request] = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.targetId, receiptId));
    return { logId: log.id, requestId: request.id, userId: "approver-1" };
  }

  it("入庫の承認1回で、入庫と出庫の両方を確定する。申請中は二重に直送完了できない", async () => {
    await seedDirectOrder();
    await seedApprovalFlow();

    const res = await callCompletion("PO-1", { completedDate: "2026-11-08", items: [{ orderItemId: "POI-1", quantity: 5 }] });
    expect(res.status).toBe(200);
    const { receiptId, shipmentId } = (await res.json()) as { receiptId: string; shipmentId: string };
    expect((await findReceipts())[0].status).toBe("UNAPPROVED");
    expect((await findShipments())[0].status).toBe("UNAPPROVED");
    expect((await findSalesOrderItem()).backorderedQuantity).toBe(3);

    const again = await callCompletion("PO-1", { completedDate: "2026-11-08", items: [{ orderItemId: "POI-1", quantity: 1 }] });
    expect(again.status).toBe(400);

    expect((await callWorkflow("/approve", await findTask(receiptId))).status).toBe(200);

    expect((await findReceipts())[0].status).toBe("APPROVED");
    const [shipment] = await db.select().from(schema.itemShipmentHeaders).where(eq(schema.itemShipmentHeaders.id, shipmentId));
    expect(shipment.status).toBe("APPROVED");
    expect((await findSalesOrderItem()).backorderedQuantity).toBe(0);
    expect(await findWh1Reserved()).toBe(0);
    const [salesOrder] = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, "SO-1"));
    expect(salesOrder.shipmentStatus).toBe("SHIPPED");
  });

  it("差戻すと、出庫も差戻しになり、在庫・欠品・引当は変わらない", async () => {
    await seedDirectOrder();
    await seedApprovalFlow();

    const res = await callCompletion("PO-1", { completedDate: "2026-11-08", items: [{ orderItemId: "POI-1", quantity: 5 }] });
    const { receiptId } = (await res.json()) as { receiptId: string };
    expect((await callWorkflow("/remand", await findTask(receiptId))).status).toBe(200);

    expect((await findReceipts())[0].status).toBe("REMANDED");
    expect((await findShipments())[0].status).toBe("REMANDED");
    expect((await findSalesOrderItem()).backorderedQuantity).toBe(3);
    expect(await findWh1Reserved()).toBe(2);
  });
});
