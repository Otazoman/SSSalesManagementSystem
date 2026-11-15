import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { Env } from "../types/env";
import { WorkflowEngine } from "./engine";

// BUG-103: 承認フローはメニュー単位。申請は、伝票を作るメニューの承認フローを使う。分岐条件の無いフローはメニューの全ての伝票に使い、
// documentKind の分岐条件があるフローは、その伝票の種類だけに使う(条件のあるフローを優先する)

const db = drizzle(env.DB, { schema });
const now = new Date();
const audit = { createdBy: "u", createdAt: now, updatedBy: "u", updatedAt: now };

async function start(targetType: string, targetId: string) {
  const app = new Hono<{ Bindings: Env }>();
  let result: Awaited<ReturnType<typeof WorkflowEngine.startWorkflow>> | null = null;
  app.get("/", async (c) => {
    result = await WorkflowEngine.startWorkflow(db, { targetType, targetId, applicantId: "applicant", requestType: "REGISTER", amount: 0 }, c);
    return c.json({});
  });
  const ctx = createExecutionContext();
  await app.request("/", {}, env, ctx);
  await waitOnExecutionContext(ctx);
  const [request] = (await db.select().from(schema.masterApprovalRequests)).filter((r) => r.targetId === targetId);
  return { result: result!, flowId: request?.flowId ?? null };
}

async function seedFlow(id: string, requestType: string, documentKind?: string) {
  await db.insert(schema.approvalFlows).values({
    id, name: id, requestType, minAmount: 0, maxAmount: 999999999, isActive: true,
    ...(documentKind ? { matchField: "documentKind", matchValue: documentKind } : {}),
  });
  await db.insert(schema.approvalFlowSteps).values({ id: `${id}-1`, flowId: id, stepOrder: 1, approverRoleId: "approver_role" });
}

beforeEach(async () => {
  for (const t of [
    schema.masterApprovalContexts, schema.masterApprovalRequests, schema.workflowLogs, schema.approvalFlowSteps, schema.approvalFlows,
    schema.itemReceiptInstructionItems, schema.itemReceiptInstructions, schema.itemReceiptItems, schema.itemReceiptHeaders,
    schema.userRoles, schema.roles, schema.partnerContacts, schema.partners, schema.users,
  ]) {
    await db.delete(t);
  }
  await db.insert(schema.users).values([
    { id: "applicant", employeeNumber: "applicant", email: "a@example.com", name: "a", isActive: true, createdAt: now, updatedAt: now },
    { id: "approver", employeeNumber: "approver", email: "b@example.com", name: "b", isActive: true, createdAt: now, updatedAt: now },
  ]);
  await db.insert(schema.roles).values({ id: "approver_role", name: "approver_role", createdAt: now });
  await db.insert(schema.userRoles).values({ userId: "approver", roleId: "approver_role", departmentSurrogateId: null });
  await db.insert(schema.partners).values({ id: "P-1", name: "仕入先", type: "SUPPLIER", ...audit });
  await db.insert(schema.itemReceiptHeaders).values({ id: "RC-1", receivedDate: now, status: "UNAPPROVED", createdBy: "u", createdAt: now });
  await db.insert(schema.itemReceiptInstructions).values({ id: "RI-1", partnerId: "P-1", warehouseId: "WH", instructedReceiveDate: now, status: "UNAPPROVED", ...audit } as typeof schema.itemReceiptInstructions.$inferInsert);
});

describe("承認フローの選び方(BUG-103)", () => {
  it("入庫・入荷指示は「入荷」メニューの承認フローを使う(分岐条件の無いフローはどちらにも使う)", async () => {
    await seedFlow("flow-receiving", "inventory_receiving");
    expect((await start("inventory_stock", "RC-1")).flowId).toBe("flow-receiving");
    expect((await start("inventory_instructions", "RI-1")).flowId).toBe("flow-receiving");
  });

  it("documentKind の分岐条件があるフローを優先し、その伝票の種類だけに使う", async () => {
    await seedFlow("flow-receiving", "inventory_receiving");
    await seedFlow("flow-receipt-instruction", "inventory_receiving", "RECEIPT_INSTRUCTION");
    expect((await start("inventory_instructions", "RI-1")).flowId).toBe("flow-receipt-instruction");
    expect((await start("inventory_stock", "RC-1")).flowId).toBe("flow-receiving");
  });

  it("裏側の申請の種類(inventory_stock)のフローは使わない", async () => {
    await seedFlow("flow-old", "inventory_stock");
    const { result } = await start("inventory_stock", "RC-1");
    expect(result.success).toBe(false);
    expect(result.message).toContain("inventory_receiving");
  });
});
