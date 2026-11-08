import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import { purchaseOrdersRouter } from "./index";

// REQ-005: 発注の「直送」の指定(直送する受注)の保存のテスト。
// ヘルパー関数は既存の慣習(purchase-order-delivery-date.test.ts等)にならい、このファイルに複製している

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

async function callOrder(method: "POST" | "PUT", path: string, payload: unknown) {
  const formData = new FormData();
  formData.append("orderData", JSON.stringify(payload));
  const ctx = createExecutionContext();
  const res = await purchaseOrdersRouter.request(
    path,
    { method, headers: { Cookie: await buildSessionCookieHeader("buyer-1") }, body: formData },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function findOrder(id: string) {
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
  return order ?? null;
}

beforeEach(async () => {
  await db.delete(schema.orderAttachments);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
  await db.delete(schema.salesOrderHistoryLogs);
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  await db.delete(schema.partners);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.delete("config");

  await db.insert(schema.users).values({
    id: "buyer-1",
    employeeNumber: "buyer-1",
    email: "buyer-1@example.com",
    name: "buyer-1",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.partners).values({
    id: "P-1",
    name: "取引先P-1",
    creditLimit: 0,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
  await db.insert(schema.salesOrders).values({
    id: "SO-1",
    title: "受注SO-1",
    partnerId: "P-1",
    orderDate: now,
    status: "APPROVED",
    createdBy: "sales-1",
    createdAt: now,
    updatedBy: "sales-1",
    updatedAt: now,
  });
});

describe("発注の直送の指定", () => {
  const base = { title: "直送の発注", orderDate: now.toISOString(), items: [] };

  it("直送と受注を指定して登録すると、その値で保存される", async () => {
    const res = await callOrder("POST", "/register", {
      ...base,
      id: "PO-D1",
      isDirectShipment: true,
      directSalesOrderId: "SO-1",
      deliveryPlace: "直送: 取引先P-1",
    });
    expect(res.status).toBe(200);
    const order = await findOrder("PO-D1");
    expect(order?.isDirectShipment).toBe(true);
    expect(order?.directSalesOrderId).toBe("SO-1");
  });

  it("指定しなければ直送ではなく、受注を送っても保存しない", async () => {
    const res = await callOrder("POST", "/register", { ...base, id: "PO-D2", directSalesOrderId: "SO-1" });
    expect(res.status).toBe(200);
    const order = await findOrder("PO-D2");
    expect(order?.isDirectShipment).toBe(false);
    expect(order?.directSalesOrderId).toBeNull();
  });

  it("直送で受注が無い・見つからない場合は400で、登録しない", async () => {
    const noOrder = await callOrder("POST", "/register", { ...base, id: "PO-D3", isDirectShipment: true });
    expect(noOrder.status).toBe(400);
    const unknown = await callOrder("POST", "/register", {
      ...base,
      id: "PO-D4",
      isDirectShipment: true,
      directSalesOrderId: "SO-X",
    });
    expect(unknown.status).toBe(400);
    expect(await findOrder("PO-D3")).toBeNull();
    expect(await findOrder("PO-D4")).toBeNull();
  });

  it("編集で直送を外すと、受注の指定も消える", async () => {
    await callOrder("POST", "/register", { ...base, id: "PO-D5", isDirectShipment: true, directSalesOrderId: "SO-1" });
    const res = await callOrder("PUT", "/PO-D5", { ...base, isDirectShipment: false, directSalesOrderId: "SO-1" });
    expect(res.status).toBe(200);
    const order = await findOrder("PO-D5");
    expect(order?.isDirectShipment).toBe(false);
    expect(order?.directSalesOrderId).toBeNull();
  });
});
