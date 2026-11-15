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

// REQ-011(3): 一時保管の自社品を、品目マスタの品目として在庫へ移す(残りの数量で入庫を作り、入庫が確定したら「在庫へ移行済」)

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

async function post(path: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await temporaryHoldingsRouter.request(
    path,
    { method: "POST", headers: { Cookie: await cookieOf("user-1"), "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function decideReceipt(action: "approve" | "cancel", receiptId: string) {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/approve", async (c) => c.json(await WorkflowTasksService.approveTask(c, db, await c.req.json())));
  app.post("/cancel", async (c) => c.json(await WorkflowTasksService.cancelTask(c, db, await c.req.json())));
  const [request] = await db.select().from(schema.masterApprovalRequests).where(eq(schema.masterApprovalRequests.targetId, receiptId));
  const [log] = await db.select().from(schema.workflowLogs).where(eq(schema.workflowLogs.targetId, receiptId));
  const userId = action === "approve" ? "approver-1" : "user-1";
  const body =
    action === "approve"
      ? { logId: log.id, requestId: request.id, userId }
      : { targetId: receiptId, logId: log.id, userId };
  const ctx = createExecutionContext();
  const res = await app.request(
    `/${action}`,
    { method: "POST", headers: { Cookie: await cookieOf(userId), "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(200);
}

const holdingOf = async (id: string) =>
  (await db.select().from(schema.temporaryHoldings).where(eq(schema.temporaryHoldings.id, id)))[0];
const moveOf = async (id: string) =>
  (await db.select().from(schema.temporaryHoldingMovements).where(eq(schema.temporaryHoldingMovements.holdingId, id))).find(
    (m) => m.movementType === "MOVE_TO_STOCK",
  );
const stockQuantity = async () =>
  (await db.select().from(schema.stocks)).reduce((sum, s) => sum + Number(s.quantity ?? 0), 0);

async function receive(category = "OWN") {
  const res = await post("/receive", {
    category,
    itemName: "仮置きの部材",
    quantity: 4,
    warehouseId: "WH1",
    partnerId: category === "CUSTODY" ? "P-1" : null,
    receivedDate: "2026-11-15",
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

const moveBody = { itemId: "ITEM1", locationId: "LOC1", receivedDate: "2026-11-16" };

beforeEach(async () => {
  await db.delete(schema.temporaryHoldingMovements);
  await db.delete(schema.temporaryHoldings);
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.itemReceiptItems);
  await db.delete(schema.itemReceiptHeaders);
  await db.delete(schema.masterApprovalContexts);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.workflowLogs);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.userRoles);
  await db.delete(schema.roles);
  await db.delete(schema.locations);
  await db.delete(schema.warehouses);
  await db.delete(schema.items);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
  await db.delete(schema.partnerContacts);
  await db.delete(schema.partners);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.delete("config");

  for (const id of ["user-1", "approver-1"]) {
    await db.insert(schema.users).values({ id, employeeNumber: id, email: `${id}@example.com`, name: id, isActive: true, createdAt: now, updatedAt: now });
  }
  await db.insert(schema.roles).values({ id: "approver_role", name: "approver_role", createdAt: now });
  await db.insert(schema.userRoles).values({ userId: "approver-1", roleId: "approver_role", departmentSurrogateId: null });
  await db.insert(schema.units).values({ code: "PCS", name: "個", ...audit });
  await db.insert(schema.accounts).values({ code: "ACC1", name: "品目", ...audit });
  await db.insert(schema.items).values({ id: "ITEM1", name: "登録した品目", baseUnitCode: "PCS", accountCode: "ACC1", ...audit });
  await db.insert(schema.warehouses).values({ id: "WH1", name: "本社倉庫", ...audit });
  await db.insert(schema.locations).values({ id: "LOC1", warehouseId: "WH1", name: "A-1", ...audit });
  await db.insert(schema.partners).values({ id: "P-1", name: "取引先1", ...audit });
});

describe("在庫へ移す(REQ-011(3))", () => {
  it("入庫の承認が無効なら、すぐ入庫して在庫が増え、台帳は在庫へ移行済になる", async () => {
    const id = await receive();
    const res = await post(`/${id}/move-to-stock`, moveBody);
    expect(res.status).toBe(200);
    expect(await stockQuantity()).toBe(4);
    expect(await holdingOf(id)).toMatchObject({ status: "MOVED_TO_STOCK", quantity: 0 });
    expect((await moveOf(id))?.approvalStatus).toBe("CONFIRMED");
    // 移した後は払出できない
    expect((await post(`/${id}/release`, { quantity: 1, movementDate: "2026-11-17" })).status).toBe(400);
  });

  it("預り品は在庫へ移せない", async () => {
    const id = await receive("CUSTODY");
    expect((await post(`/${id}/move-to-stock`, moveBody)).status).toBe(400);
    expect(await db.select().from(schema.itemReceiptHeaders)).toHaveLength(0);
  });

  describe("入庫の承認が有効な時", () => {
    beforeEach(async () => {
      await env.COMPANY_SETTINGS.put("config", JSON.stringify({ is_receiving_approval_enabled: true }));
      await db.insert(schema.approvalFlows).values({ id: "flow-st", name: "入庫", requestType: "inventory_stock", minAmount: 0, maxAmount: 999999999, isActive: true });
      await db.insert(schema.approvalFlowSteps).values({ id: "flow-st-1", flowId: "flow-st", stepOrder: 1, approverRoleId: "approver_role" });
    });

    it("入庫の承認待ちの間は払出できず、入庫が承認されると在庫へ移行済になる", async () => {
      const id = await receive();
      const res = await post(`/${id}/move-to-stock`, moveBody);
      expect(res.status).toBe(200);
      const { receiptId } = (await res.json()) as { receiptId: string };
      expect((await holdingOf(id)).status).toBe("HOLDING");
      expect(await stockQuantity()).toBe(0);
      expect((await post(`/${id}/release`, { quantity: 1, movementDate: "2026-11-17" })).status).toBe(400);

      await decideReceipt("approve", receiptId);
      expect(await stockQuantity()).toBe(4);
      expect(await holdingOf(id)).toMatchObject({ status: "MOVED_TO_STOCK", quantity: 0 });
    });

    it("入庫を取り下げると、在庫へ移す動きは差戻しになり、また払出できる", async () => {
      const id = await receive();
      const { receiptId } = (await (await post(`/${id}/move-to-stock`, moveBody)).json()) as { receiptId: string };
      await decideReceipt("cancel", receiptId);
      expect((await moveOf(id))?.approvalStatus).toBe("REMANDED");
      expect(await holdingOf(id)).toMatchObject({ status: "HOLDING", quantity: 4 });
      expect((await post(`/${id}/release`, { quantity: 1, movementDate: "2026-11-17" })).status).toBe(200);
    });
  });
});
