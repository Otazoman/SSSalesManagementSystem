import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { WorkflowEngine } from "./engine";

// BUG-044: 申請の開始は、書き込みを1回の batch で行う。承認フローが見つからない場合は何も書き込まない
const db = drizzle(env.DB, { schema });
const past = new Date("2026-09-01T00:00:00Z");
const c = { env } as any;

async function requestsOf(targetId: string) {
  return db
    .select()
    .from(schema.masterApprovalRequests)
    .where(eq(schema.masterApprovalRequests.targetId, targetId));
}

describe("WorkflowEngine.startWorkflow", () => {
  beforeEach(async () => {
    await db.delete(schema.workflowLogs);
    await db.delete(schema.masterApprovalContexts);
    await db.delete(schema.masterApprovalRequests);
    await db.delete(schema.approvalFlowSteps);
    await db.delete(schema.approvalFlows);
    await db.delete(schema.userRoles);
    await db.delete(schema.roles);
    await db.insert(schema.roles).values({ id: "approver_role", name: "承認者", createdAt: past });
    await db.insert(schema.masterApprovalRequests).values({
      id: "OLD-REQ",
      targetType: "sales_quotes",
      targetId: "Q-1",
      requestType: "REGISTER",
      status: "PENDING",
      applicantId: "user-001",
      createdAt: past,
      updatedAt: past,
    });
  });

  it("承認フローが見つからない場合は、申請中の古い申請を取り消さずに失敗を返す", async () => {
    const result = await WorkflowEngine.startWorkflow(
      db,
      { targetType: "sales_quotes", targetId: "Q-1", applicantId: "user-001", requestType: "UPDATE", amount: 1000 },
      c,
    );

    expect(result.success).toBe(false);
    const rows = await requestsOf("Q-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PENDING");
  });

  it("再申請では、古い申請を取り消し、新しい申請・内容・承認待ちの手番をまとめて登録する", async () => {
    await db.insert(schema.approvalFlows).values({
      id: "FLOW-1",
      name: "見積",
      requestType: "sales_quotes",
      minAmount: 0,
      maxAmount: 999999999,
      isActive: true,
    });
    await db.insert(schema.approvalFlowSteps).values({
      id: "STEP-1",
      flowId: "FLOW-1",
      stepOrder: 1,
      approverRoleId: "approver_role",
    });

    const result = await WorkflowEngine.startWorkflow(
      db,
      {
        targetType: "sales_quotes",
        targetId: "Q-1",
        applicantId: "user-001",
        requestType: "UPDATE",
        amount: 1000,
        contextData: { generalMemo: "{}" },
      },
      c,
    );

    expect(result.success).toBe(true);
    const rows = await requestsOf("Q-1");
    expect(rows.find((r) => r.id === "OLD-REQ")?.status).toBe("SUPERSEDED");
    const created = rows.find((r) => r.id === result.requestId);
    expect(created?.status).toBe("PENDING");
    const contexts = await db
      .select()
      .from(schema.masterApprovalContexts)
      .where(eq(schema.masterApprovalContexts.requestId, result.requestId!));
    expect(contexts).toHaveLength(1);
    const logs = await db.select().from(schema.workflowLogs).where(eq(schema.workflowLogs.requestId, result.requestId!));
    expect(logs.map((l) => l.status)).toEqual(["PENDING"]);
  });
});
