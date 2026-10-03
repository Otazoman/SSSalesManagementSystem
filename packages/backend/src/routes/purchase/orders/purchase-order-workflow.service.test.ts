import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";
import { purchaseOrdersRouter } from "./index";
import { WorkflowTasksService } from "../../workflow/workflow-tasks/workflow-tasks.service";

// #14-2⑥: 元々1189行あったpurchase-order.service.test.tsから、承認ワークフロー(申請提出・削除
// 申請・承認確定/差戻し確定によるpurchase-orders.adapter.tsの反映)の部分を分割したもの。ロジック
// 変更なし。ヘルパー関数は既存の慣習(payment-crud.test.ts/payment-csv.test.ts、
// sales-order-crud/workflow.service.test.ts)にならい、分割後の各ファイルにそのまま複製している
// (共通ファイル化はしない)。

const db = drizzle(env.DB, { schema });

function buildWorkflowTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/approve", async (c) => {
    const body = await c.req.json();
    const result = await WorkflowTasksService.approveTask(c, db, body);
    return c.json(result);
  });
  app.post("/remand", async (c) => {
    const body = await c.req.json();
    const result = await WorkflowTasksService.remandTask(c, db, body);
    return c.json(result);
  });
  return app;
}

async function buildSessionCookieHeader(
  userId: string,
  employeeNumber = userId,
): Promise<string> {
  const token = await signSessionToken(
    {
      userId,
      employeeNumber,
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

async function callSubmitForApproval(id: string, actorUserId: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await purchaseOrdersRouter.request(
    `/${id}/submit-for-approval`,
    {
      method: "POST",
      headers: {
        Cookie: await buildSessionCookieHeader(actorUserId),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function callRequestDeletion(id: string, actorUserId: string) {
  const ctx = createExecutionContext();
  const res = await purchaseOrdersRouter.request(
    `/${id}/request-deletion`,
    { method: "POST", headers: { Cookie: await buildSessionCookieHeader(actorUserId) } },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function callApproveTask(params: { logId: string; requestId: string; userId: string }) {
  const app = buildWorkflowTestApp();
  const ctx = createExecutionContext();
  const res = await app.request(
    "/approve",
    {
      method: "POST",
      headers: {
        Cookie: await buildSessionCookieHeader(params.userId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function callRemandTask(params: { logId: string; requestId: string; userId: string }) {
  const app = buildWorkflowTestApp();
  const ctx = createExecutionContext();
  const res = await app.request(
    "/remand",
    {
      method: "POST",
      headers: {
        Cookie: await buildSessionCookieHeader(params.userId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const now = new Date();

async function seedUser(id: string, overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  await db.insert(schema.users).values({
    id,
    employeeNumber: id,
    email: `${id}@example.com`,
    name: overrides.name ?? id,
    isActive: overrides.isActive ?? true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

async function seedRole(id: string) {
  await db.insert(schema.roles).values({ id, name: id, createdAt: now });
}

async function seedUserRole(
  userId: string,
  roleId: string,
  departmentSurrogateId: string | null = null,
) {
  await db.insert(schema.userRoles).values({ userId, roleId, departmentSurrogateId });
}

async function seedDepartment(surrogateId: string, id: string, name: string) {
  await db.insert(schema.departments).values({
    surrogateId,
    id,
    name,
    validFrom: now,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

async function seedApprovalFlow(
  id: string,
  requestType: string,
  steps: Array<{ order: number; roleId: string }>,
  options: { amountRange?: { min: number; max: number } } = {},
) {
  const amountRange = options.amountRange ?? { min: 0, max: 999999999 };
  await db.insert(schema.approvalFlows).values({
    id,
    name: id,
    requestType,
    minAmount: amountRange.min,
    maxAmount: amountRange.max,
    isActive: true,
  });
  for (const step of steps) {
    await db.insert(schema.approvalFlowSteps).values({
      id: `${id}-step-${step.order}`,
      flowId: id,
      stepOrder: step.order,
      approverRoleId: step.roleId,
    });
  }
}

async function seedRequisition(
  id: string,
  overrides: Partial<typeof schema.purchaseRequests.$inferInsert> = {},
) {
  await db.insert(schema.purchaseRequests).values({
    id,
    title: `購買申請${id}`,
    departmentSurrogateId: "dept-a",
    applicantId: "applicant-1",
    requestType: "ONE_TIME",
    status: "DRAFT",
    totalAmount: 10000,
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
    ...overrides,
  });
}

async function seedOrder(id: string, overrides: Partial<typeof schema.orders.$inferInsert> = {}) {
  await db.insert(schema.orders).values({
    id,
    title: `発注${id}`,
    orderDate: now,
    status: "DRAFT",
    totalAmount: 10000,
    taxAmount: 0,
    createdBy: "buyer-1",
    createdAt: now,
    updatedBy: "buyer-1",
    updatedAt: now,
    ...overrides,
  });
}

async function enablePurchaseOrderApprovalWorkflow() {
  await env.COMPANY_SETTINGS.put("config", JSON.stringify({ is_purchase_order_approval_enabled: true }));
}

async function findOrder(id: string) {
  const rows = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
  return rows[0] ?? null;
}

async function findPendingRequestByTarget(targetId: string) {
  return db
    .select()
    .from(schema.masterApprovalRequests)
    .where(eq(schema.masterApprovalRequests.targetId, targetId));
}

beforeEach(async () => {
  await db.delete(schema.orderAttachments);
  // 追加要望対応: purchaseRecognitionItems.sourceOrderItemIdがorderItems.idをFK参照するため、
  // orderItemsを消す前に削除する必要がある
  await db.delete(schema.purchaseRecognitionItems);
  await db.delete(schema.purchaseRecognitions);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
  await db.delete(schema.purchaseRequestItems);
  await db.delete(schema.purchaseRequests);
  await db.delete(schema.masterApprovalContexts);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.workflowLogs);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.userRoles);
  await db.delete(schema.departments);
  await db.delete(schema.roles);
  await db.delete(schema.users);
  await db.delete(schema.items);
  // journal_posting_rulesがaccountsをFK参照するため、accountsの削除より先に消す必要がある
  await db.delete(schema.journalPostingEvents);
  await db.delete(schema.journalPostingRules);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
  await db.delete(schema.partners);
  await db.delete(schema.taxCategories);
  await env.COMPANY_SETTINGS.delete("config");

  await seedUser("buyer-1");
  await seedDepartment("dept-a", "D001", "資材部");
});

describe("POST /:id/submit-for-approval", () => {
  it("DRAFT以外は申請できない(400)", async () => {
    await seedOrder("PO-1", { status: "APPROVED" });
    const res = await callSubmitForApproval("PO-1", "buyer-1");
    expect(res.status).toBe(400);
  });

  it("承認機能OFFの場合は直接APPROVEDに確定する(ワークフロー申請は作られない)", async () => {
    await seedOrder("PO-1", { status: "DRAFT" });
    const res = await callSubmitForApproval("PO-1", "buyer-1");
    expect(res.status).toBe(200);
    expect((await findOrder("PO-1"))?.status).toBe("APPROVED");
    expect(await findPendingRequestByTarget("PO-1")).toHaveLength(0);
  });

  it("承認機能ONだが合致する承認フローが無い場合は400になり、ステータスはDRAFTのまま戻る", async () => {
    await enablePurchaseOrderApprovalWorkflow();
    await seedRequisition("PR-1", { status: "APPROVED" });
    await seedOrder("PO-1", { status: "DRAFT", requestId: "PR-1" });
    const res = await callSubmitForApproval("PO-1", "buyer-1");
    expect(res.status).toBe(400);
    expect((await findOrder("PO-1"))?.status).toBe("DRAFT");
  });

  it("承認機能ONかつ承認フローが定義されている場合、PENDING_APPROVALになりPENDING申請が作られる", async () => {
    await enablePurchaseOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "purchase_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedRequisition("PR-1", { status: "APPROVED" });
    await seedOrder("PO-1", { status: "DRAFT", requestId: "PR-1", totalAmount: 5000 });

    const res = await callSubmitForApproval("PO-1", "buyer-1");
    expect(res.status).toBe(200);
    expect((await findOrder("PO-1"))?.status).toBe("PENDING_APPROVAL");

    const requests = await findPendingRequestByTarget("PO-1");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      targetType: "purchase_orders",
      requestType: "REGISTER",
      status: "PENDING",
      applicantId: "buyer-1",
    });
  });
});

describe("POST /:id/request-deletion", () => {
  it("未申請のDRAFTは承認不要で直接削除される", async () => {
    await enablePurchaseOrderApprovalWorkflow();
    await seedOrder("PO-1", { status: "DRAFT" });
    const res = await callRequestDeletion("PO-1", "buyer-1");
    expect(res.status).toBe(200);
    expect(await findOrder("PO-1")).toBeNull();
  });

  it("承認機能ONの場合、APPROVED済みはPENDING_DELETIONになり削除申請が作られる(即削除されない)", async () => {
    await enablePurchaseOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "purchase_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedOrder("PO-1", { status: "APPROVED" });

    const res = await callRequestDeletion("PO-1", "buyer-1");
    expect(res.status).toBe(200);
    expect((await findOrder("PO-1"))?.status).toBe("PENDING_DELETION");

    const requests = await findPendingRequestByTarget("PO-1");
    expect(requests).toHaveLength(1);
    expect(requests[0].requestType).toBe("DELETE");
  });
});

describe("承認確定(WorkflowTasksService.approveTask)によるpurchase-orders.adapter.tsの反映", () => {
  it("REGISTER申請(初回承認)が最終承認されると、orders.statusがAPPROVEDになる", async () => {
    await enablePurchaseOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "purchase_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedRequisition("PR-1", { status: "APPROVED" });
    await seedOrder("PO-1", { status: "DRAFT", requestId: "PR-1" });

    await callSubmitForApproval("PO-1", "buyer-1");
    const requests = await findPendingRequestByTarget("PO-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "PO-1"));

    const res = await callApproveTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(res.status).toBe(200);
    expect((await findOrder("PO-1"))?.status).toBe("APPROVED");
  });

  it("BUG-049: 承認時の伝票への反映が失敗した場合は、手番・申請も承認済みにならない(1回の batch)", async () => {
    await enablePurchaseOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "purchase_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedRequisition("PR-1", { status: "APPROVED" });
    await seedOrder("PO-1", { status: "DRAFT", requestId: "PR-1" });

    await callSubmitForApproval("PO-1", "buyer-1");
    const requests = await findPendingRequestByTarget("PO-1");
    const requestId = requests[0].id;
    // 変更申請として、反映に失敗する申請内容(存在しない税区分の明細)を用意する
    await db.update(schema.masterApprovalRequests).set({ requestType: "UPDATE" }).where(eq(schema.masterApprovalRequests.id, requestId));
    await db.insert(schema.masterApprovalContexts).values({
      id: "CTX-BAD",
      requestId,
      generalMemo: JSON.stringify({
        header: { title: "失敗する変更" },
        items: [{ itemId: "ITEM-1", itemName: "明細", quantity: 1, unitPrice: 100, taxCategoryCode: "NO_SUCH_TAX" }],
      }),
      createdAt: new Date(),
      createdBy: "buyer-1",
      updatedAt: new Date(),
      updatedBy: "buyer-1",
    });
    const logs = await db.select().from(schema.workflowLogs).where(eq(schema.workflowLogs.targetId, "PO-1"));

    const res = await callApproveTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(res.status).toBe(500);
    const [log] = await db.select().from(schema.workflowLogs).where(eq(schema.workflowLogs.id, logs[0].id));
    expect(log.status).toBe("PENDING");
    const [request] = await db.select().from(schema.masterApprovalRequests).where(eq(schema.masterApprovalRequests.id, requestId));
    expect(request.status).toBe("PENDING");
    expect((await findOrder("PO-1"))?.status).toBe("PENDING_APPROVAL");
  });

  it("DELETE申請が最終承認されると、発注が物理削除される", async () => {
    await enablePurchaseOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "purchase_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedOrder("PO-1", { status: "APPROVED" });

    await callRequestDeletion("PO-1", "buyer-1");
    const requests = await findPendingRequestByTarget("PO-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "PO-1"));

    const res = await callApproveTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(res.status).toBe(200);
    expect(await findOrder("PO-1")).toBeNull();
  });
});

describe("差戻し確定(WorkflowTasksService.remandTask)によるpurchase-orders.adapter.tsの反映", () => {
  it("REGISTER申請の差戻しで、orders.statusがDRAFTへ自動的に戻る", async () => {
    await enablePurchaseOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "purchase_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedRequisition("PR-1", { status: "APPROVED" });
    await seedOrder("PO-1", { status: "DRAFT", requestId: "PR-1" });

    await callSubmitForApproval("PO-1", "buyer-1");
    const requests = await findPendingRequestByTarget("PO-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "PO-1"));

    const res = await callRemandTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(res.status).toBe(200);
    expect((await findOrder("PO-1"))?.status).toBe("DRAFT");
  });
});
