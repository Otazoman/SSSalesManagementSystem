import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";
import { temporaryHoldingsRouter } from "./index";
import { WorkflowTasksService } from "../../workflow/workflow-tasks/workflow-tasks.service";

// REQ-011(2): 一時保管の台帳。承認フローが無ければすぐ確定、あれば申請中になり承認で数量が変わる

const db = drizzle(env.DB, { schema });
const now = new Date();
const audit = { createdBy: "user-1", createdAt: now, updatedBy: "user-1", updatedAt: now };

async function cookieOf(userId: string): Promise<string> {
  const token = await signSessionToken(
    { userId, employeeNumber: userId, name: "テスト", role: "user", deptName: "部署", companyName: "会社", isAuditEnabled: true },
    await env.SESSION_SECRET.get(),
    3600,
  );
  return `session_token=${token}`;
}

async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const headers: Record<string, string> = { Cookie: await cookieOf("user-1") };
  if (typeof init.body === "string") headers["Content-Type"] = "application/json";
  const res = await temporaryHoldingsRouter.request(path, { ...init, headers }, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });

async function decide(action: "approve" | "remand", movementId: string) {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/approve", async (c) => c.json(await WorkflowTasksService.approveTask(c, db, await c.req.json())));
  app.post("/remand", async (c) => c.json(await WorkflowTasksService.remandTask(c, db, await c.req.json())));
  const [request] = await db.select().from(schema.masterApprovalRequests).where(eq(schema.masterApprovalRequests.targetId, movementId));
  const [log] = await db.select().from(schema.workflowLogs).where(eq(schema.workflowLogs.targetId, movementId));
  const ctx = createExecutionContext();
  const res = await app.request(
    `/${action}`,
    {
      method: "POST",
      headers: { Cookie: await cookieOf("approver-1"), "Content-Type": "application/json" },
      body: JSON.stringify({ logId: log.id, requestId: request.id, userId: "approver-1" }),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(200);
}

async function seedFlow() {
  await db.insert(schema.approvalFlows).values({
    id: "flow-th", name: "一時保管", requestType: "inventory_temporary_holdings", minAmount: 0, maxAmount: 999999999, isActive: true,
  });
  await db.insert(schema.approvalFlowSteps).values({ id: "flow-th-1", flowId: "flow-th", stepOrder: 1, approverRoleId: "approver_role" });
}

const holdingOf = async (id: string) =>
  (await db.select().from(schema.temporaryHoldings).where(eq(schema.temporaryHoldings.id, id)))[0];
const movementsOf = (id: string) =>
  db.select().from(schema.temporaryHoldingMovements).where(eq(schema.temporaryHoldingMovements.holdingId, id));

const receiveBody = (overrides: Record<string, unknown> = {}) => ({
  category: "OWN",
  itemName: "仮置きの部材",
  quantity: 10,
  unitName: "個",
  warehouseId: "WH1",
  receivedDate: "2026-11-15",
  ...overrides,
});

async function receive(overrides: Record<string, unknown> = {}) {
  const res = await post("/receive", receiveBody(overrides));
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string; movementId: string; pending: boolean });
}

beforeEach(async () => {
  await db.delete(schema.temporaryHoldingMovements);
  await db.delete(schema.temporaryHoldings);
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
  await db.delete(schema.masterApprovalContexts);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.workflowLogs);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.userRoles);
  await db.delete(schema.roles);
  await db.delete(schema.warehouses);
  await db.delete(schema.partnerContacts);
  await db.delete(schema.partners);
  await db.delete(schema.users);

  for (const id of ["user-1", "approver-1"]) {
    await db.insert(schema.users).values({ id, employeeNumber: id, email: `${id}@example.com`, name: id, isActive: true, createdAt: now, updatedAt: now });
  }
  await db.insert(schema.roles).values({ id: "approver_role", name: "approver_role", createdAt: now });
  await db.insert(schema.userRoles).values({ userId: "approver-1", roleId: "approver_role", departmentSurrogateId: null });
  await db.insert(schema.warehouses).values({ id: "WH1", name: "本社倉庫", ...audit });
  await db.insert(schema.partners).values({ id: "P-1", name: "取引先1", ...audit });
});

describe("承認フローが無い時(REQ-011(2))", () => {
  it("受入はすぐ確定し、台帳の数量になる。在庫(stocks)には入らない", async () => {
    const { id, pending } = await receive();
    expect(pending).toBe(false);
    expect(await holdingOf(id)).toMatchObject({ quantity: 10, status: "HOLDING", category: "OWN" });
    expect((await movementsOf(id))[0]).toMatchObject({ movementType: "RECEIVE", quantity: 10, approvalStatus: "CONFIRMED" });
    expect(await db.select().from(schema.stocks)).toHaveLength(0);
  });

  it("払出・調整で数量が変わり、0になると払出済になる。残りを超える払出は断る", async () => {
    const { id } = await receive();
    expect((await post(`/${id}/release`, { quantity: 11, movementDate: "2026-11-16" })).status).toBe(400);
    expect((await post(`/${id}/release`, { quantity: 4, movementDate: "2026-11-16" })).status).toBe(200);
    expect((await post(`/${id}/adjust`, { quantity: -1, movementDate: "2026-11-16", memo: "破損" })).status).toBe(200);
    expect((await holdingOf(id)).quantity).toBe(5);
    expect((await post(`/${id}/release`, { quantity: 5, movementDate: "2026-11-17" })).status).toBe(200);
    expect(await holdingOf(id)).toMatchObject({ quantity: 0, status: "RELEASED" });
  });

  it("預り品は取引先が必須", async () => {
    expect((await post("/receive", receiveBody({ category: "CUSTODY" }))).status).toBe(400);
    const { id } = await receive({ category: "CUSTODY", partnerId: "P-1" });
    expect((await holdingOf(id)).partnerId).toBe("P-1");
  });

  it("発注の直接入力の明細から受け入れられる(品目マスタの明細は断る)。発注の明細は変えない", async () => {
    await db.insert(schema.orders).values({ id: "PO-1", partnerId: "P-1", orderDate: now, status: "APPROVED", totalAmount: 0, taxAmount: 0, ...audit });
    await db.insert(schema.orderItems).values([
      { id: "POI-D", orderId: "PO-1", itemName: "特注品", inputType: "DIRECT", quantity: 3, unitPrice: 100, sortOrder: 0 },
      { id: "POI-M", orderId: "PO-1", itemId: null, itemName: "マスタ品", inputType: "MASTER", quantity: 3, unitPrice: 100, sortOrder: 1 },
    ] as (typeof schema.orderItems.$inferInsert)[]);
    expect((await post("/receive", receiveBody({ purchaseOrderId: "PO-1", purchaseOrderItemId: "POI-M" }))).status).toBe(400);
    const { id } = await receive({ purchaseOrderId: "PO-1", purchaseOrderItemId: "POI-D", quantity: 3 });
    expect(await holdingOf(id)).toMatchObject({ sourceType: "PURCHASE_ORDER", sourceId: "PO-1", sourceItemId: "POI-D", partnerId: "P-1" });
    expect(await db.select().from(schema.itemReceiptItems)).toHaveLength(0);
  });

  it("一覧・詳細・CSV を返す", async () => {
    const { id } = await receive();
    const list = (await (await call("/")).json()) as Array<{ id: string; pendingQuantity: number }>;
    expect(list.map((h) => h.id)).toEqual([id]);
    expect(list[0].pendingQuantity).toBe(0);
    const detail = (await (await call(`/${id}`)).json()) as { movements: unknown[] };
    expect(detail.movements).toHaveLength(1);
    expect(await (await call("/csv-download")).text()).toContain("仮置きの部材");
  });

  it("確定した動きがある一時保管は削除できない", async () => {
    const { id } = await receive();
    expect((await call(`/${id}`, { method: "DELETE" })).status).toBe(400);
  });
});

describe("承認フローがある時(REQ-011(2))", () => {
  beforeEach(seedFlow);

  it("受入は申請中になり数量は変わらない。承認で数量が変わる", async () => {
    const { id, movementId, pending } = await receive();
    expect(pending).toBe(true);
    expect((await holdingOf(id)).quantity).toBe(0);
    const list = (await (await call("/")).json()) as Array<{ pendingQuantity: number }>;
    expect(list[0].pendingQuantity).toBe(10);

    await decide("approve", movementId);
    expect((await holdingOf(id)).quantity).toBe(10);
    expect((await movementsOf(id))[0].approvalStatus).toBe("CONFIRMED");
  });

  it("差戻しでは数量が変わらない。差し戻された受入だけの行は削除できる", async () => {
    const { id, movementId } = await receive();
    await decide("remand", movementId);
    expect((await holdingOf(id)).quantity).toBe(0);
    expect((await movementsOf(id))[0].approvalStatus).toBe("REMANDED");
    expect((await call(`/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(await holdingOf(id)).toBeUndefined();
  });

  it("承認待ちの払出も残りから引き、超える払出は断る", async () => {
    const { id, movementId } = await receive();
    await decide("approve", movementId);
    expect((await post(`/${id}/release`, { quantity: 6, movementDate: "2026-11-16" })).status).toBe(200);
    expect((await post(`/${id}/release`, { quantity: 5, movementDate: "2026-11-16" })).status).toBe(400);
    expect((await holdingOf(id)).quantity).toBe(10);
  });

  it("受注の直接入力の明細に紐づけて払い出せる", async () => {
    const { id, movementId } = await receive();
    await decide("approve", movementId);
    await db.insert(schema.salesOrders).values({ id: "SO-1", partnerId: "P-1", orderDate: now, status: "APPROVED", totalAmount: 0, taxAmount: 0, ...audit } as typeof schema.salesOrders.$inferInsert);
    await db.insert(schema.salesOrderItems).values({ id: "SOI-D", salesOrderId: "SO-1", itemName: "特注品", inputType: "DIRECT", quantity: 2, unitPrice: 100, amount: 200 } as typeof schema.salesOrderItems.$inferInsert);
    const res = await post(`/${id}/release`, { quantity: 2, movementDate: "2026-11-16", salesOrderId: "SO-1", salesOrderItemId: "SOI-D" });
    expect(res.status).toBe(200);
    const release = (await movementsOf(id)).find((m) => m.movementType === "RELEASE");
    expect(release).toMatchObject({ sourceType: "SALES_ORDER", sourceId: "SO-1", sourceItemId: "SOI-D", approvalStatus: "PENDING" });
  });
});
