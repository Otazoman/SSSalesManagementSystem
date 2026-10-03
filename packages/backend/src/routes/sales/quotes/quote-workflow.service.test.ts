import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";
import { quotesRouter } from "./index";
import { approvalsRouter } from "../../workflow/approvals";
import { WorkflowTasksService } from "../../workflow/workflow-tasks/workflow-tasks.service";

// #14-2⑥: 元々1233行あったquote.service.test.tsから、承認ワークフロー(申請提出・削除申請・
// 承認確定/差戻し確定/取り下げ確定によるquotes.adapter.tsの反映、フロー選定バグの回帰テスト)の
// 部分を分割したもの。ロジック変更なし。ヘルパー関数は既存の慣習(payment-crud.test.ts/
// payment-csv.test.ts、sales-order-crud/workflow.service.test.ts)にならい、分割後の各ファイルに
// そのまま複製している(共通ファイル化はしない)。

const db = drizzle(env.DB, { schema });

// 承認/差戻しの最終確定はworkflow-tasksルート経由でしか実HTTPパスが無いため、
// WorkflowTasksServiceを直接呼ぶ小さなテスト用アプリを用意する(workflow-tasks.service.test.tsと同じ方式)。
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
  app.post("/cancel", async (c) => {
    const body = await c.req.json();
    const result = await WorkflowTasksService.cancelTask(c, db, body);
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

async function callSubmitForApproval(
  id: string,
  actorUserId: string,
  body?: unknown,
) {
    const ctx = createExecutionContext();
  const _res = await quotesRouter.request(
    `/${id}/submit-for-approval`,
    {
      method: "POST",
      headers: {
        Cookie: await buildSessionCookieHeader(actorUserId),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

async function callRequestDeletion(id: string, actorUserId: string) {
    const ctx = createExecutionContext();
  const _res = await quotesRouter.request(
    `/${id}/request-deletion`,
    { method: "POST", headers: { Cookie: await buildSessionCookieHeader(actorUserId) } },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

async function callUpdateQuote(id: string, actorUserId: string, payload: unknown) {
  const formData = new FormData();
  formData.append("quoteData", JSON.stringify(payload));
    const ctx = createExecutionContext();
  const _res = await quotesRouter.request(
    `/${id}`,
    {
      method: "PUT",
      headers: { Cookie: await buildSessionCookieHeader(actorUserId) },
      body: formData,
    },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

async function callRequestUpdateApproval(
  actorUserId: string,
  body: {
    targetId: string;
    requestType: "REGISTER" | "UPDATE" | "SUSPEND" | "DELETE";
    payload: Record<string, unknown>;
    comment?: string;
  },
) {
    const ctx = createExecutionContext();
  const _res = await approvalsRouter.request(
    "/request-update",
    {
      method: "POST",
      headers: {
        Cookie: await buildSessionCookieHeader(actorUserId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ targetType: "sales_quotes", ...body }),
    },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

async function callApproveTask(params: {
  logId: string;
  requestId: string;
  userId: string;
}) {
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

async function callRemandTask(params: {
  logId: string;
  requestId: string;
  userId: string;
}) {
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

async function callCancelTask(params: {
  targetId: string;
  logId: string;
  userId: string;
}) {
  const app = buildWorkflowTestApp();
  const ctx = createExecutionContext();
  const res = await app.request(
    "/cancel",
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

async function seedPartner(id: string) {
  await db.insert(schema.partners).values({
    id,
    name: `取引先${id}`,
    createdBy: id,
    createdAt: now,
    updatedBy: id,
    updatedAt: now,
  });
}

async function seedApprovalFlow(
  id: string,
  requestType: string,
  steps: Array<{ order: number; roleId: string }>,
  amountRange: { min: number; max: number } = { min: 0, max: 999999999 },
) {
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

async function seedQuote(
  id: string,
  overrides: Partial<typeof schema.quotes.$inferInsert> = {},
) {
  await db.insert(schema.quotes).values({
    id,
    title: `見積${id}`,
    partnerId: "partner-1",
    quoteDate: now,
    status: "DRAFT",
    totalAmount: 10000,
    taxAmount: 1000,
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
    ...overrides,
  });
}

async function seedQuoteItem(
  quoteId: string,
  overrides: Partial<typeof schema.quoteItems.$inferInsert> = {},
) {
  await db.insert(schema.quoteItems).values({
    id: `${quoteId}-item-1`,
    quoteId,
    itemId: "ITEM-1",
    itemName: "テスト品目",
    quantity: 1,
    unitPrice: 10000,
    amount: 10000,
    sortOrder: 0,
    ...overrides,
  });
}

async function enableQuoteApprovalWorkflow() {
  await env.COMPANY_SETTINGS.put(
    "config",
    JSON.stringify({ is_quote_approval_enabled: true }),
  );
}

async function findQuote(id: string) {
  const rows = await db.select().from(schema.quotes).where(eq(schema.quotes.id, id));
  return rows[0] ?? null;
}

async function findPendingRequestByTarget(targetId: string) {
  const rows = await db
    .select()
    .from(schema.masterApprovalRequests)
    .where(eq(schema.masterApprovalRequests.targetId, targetId));
  return rows;
}

beforeEach(async () => {
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  await db.delete(schema.quoteHistoryLogs);
  await db.delete(schema.quoteAttachments);
  await db.delete(schema.quoteItems);
  await db.delete(schema.quotes);
  await db.delete(schema.masterApprovalContexts);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.workflowLogs);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.userRoles);
  await db.delete(schema.departments);
  await db.delete(schema.partners);
  await db.delete(schema.roles);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.delete("config");

  await seedUser("applicant-1");
  await seedPartner("partner-1");
});

describe("POST /:id/submit-for-approval", () => {
  it("DRAFT以外の見積は申請できない(400)", async () => {
    await seedQuote("Q-1", { status: "APPROVED" });
    const res = await callSubmitForApproval("Q-1", "applicant-1");
    expect(res.status).toBe(400);
  });

  it("承認機能OFFの場合は直接APPROVEDに確定する(ワークフロー申請は作られない)", async () => {
    await seedQuote("Q-1", { status: "DRAFT" });
    const res = await callSubmitForApproval("Q-1", "applicant-1");
    expect(res.status).toBe(200);
    const quote = await findQuote("Q-1");
    expect(quote?.status).toBe("APPROVED");
    expect(await findPendingRequestByTarget("Q-1")).toHaveLength(0);
  });

  it("承認機能ONだが合致する承認フローが無い場合は400になり、ステータスはDRAFTのまま戻る", async () => {
    await enableQuoteApprovalWorkflow();
    await seedQuote("Q-1", { status: "DRAFT" });
    const res = await callSubmitForApproval("Q-1", "applicant-1");
    expect(res.status).toBe(400);
    const quote = await findQuote("Q-1");
    expect(quote?.status).toBe("DRAFT");
  });

  it("承認機能ONかつ承認フローが定義されている場合、PENDING_APPROVALになりPENDING申請が作られる", async () => {
    await enableQuoteApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_quotes", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedQuote("Q-1", { status: "DRAFT", totalAmount: 5000 });

    const res = await callSubmitForApproval("Q-1", "applicant-1");
    expect(res.status).toBe(200);

    const quote = await findQuote("Q-1");
    expect(quote?.status).toBe("PENDING_APPROVAL");

    const requests = await findPendingRequestByTarget("Q-1");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      targetType: "sales_quotes",
      requestType: "REGISTER",
      status: "PENDING",
      applicantId: "applicant-1",
    });
  });

  it("追加要望F: 申請者の実際の所属部署を指定した場合、masterApprovalRequestsにapplicantDepartmentSurrogateIdとして保存される", async () => {
    await enableQuoteApprovalWorkflow();
    await seedRole("approver_role");
    await seedDepartment("dept-a", "D001", "営業統括部");
    await seedUserRole("applicant-1", "approver_role", "dept-a");
    await seedApprovalFlow("flow-1", "sales_quotes", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedQuote("Q-1", { status: "DRAFT", totalAmount: 5000 });

    const res = await callSubmitForApproval("Q-1", "applicant-1", {
      applicantDepartmentSurrogateId: "dept-a",
    });
    expect(res.status).toBe(200);

    const requests = await findPendingRequestByTarget("Q-1");
    expect(requests[0].applicantDepartmentSurrogateId).toBe("dept-a");
  });

  it("追加要望F: 申請者が実際に所属していない部署を指定した場合は無視される(nullのまま保存)", async () => {
    await enableQuoteApprovalWorkflow();
    await seedRole("approver_role");
    await seedApprovalFlow("flow-1", "sales_quotes", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedQuote("Q-1", { status: "DRAFT", totalAmount: 5000 });

    const res = await callSubmitForApproval("Q-1", "applicant-1", {
      applicantDepartmentSurrogateId: "dept-not-mine",
    });
    expect(res.status).toBe(200);

    const requests = await findPendingRequestByTarget("Q-1");
    expect(requests[0].applicantDepartmentSurrogateId).toBeNull();
  });
});

describe("POST /:id/request-deletion", () => {
  it("未申請のDRAFTは承認不要で直接削除される", async () => {
    await enableQuoteApprovalWorkflow();
    await seedQuote("Q-1", { status: "DRAFT" });
    const res = await callRequestDeletion("Q-1", "applicant-1");
    expect(res.status).toBe(200);
    expect(await findQuote("Q-1")).toBeNull();
    expect(await findPendingRequestByTarget("Q-1")).toHaveLength(0);
  });

  it("承認機能ONの場合、承認処理中(PENDING_APPROVAL)の見積は削除申請できない(400)", async () => {
    await enableQuoteApprovalWorkflow();
    await seedQuote("Q-1", { status: "PENDING_APPROVAL" });
    const res = await callRequestDeletion("Q-1", "applicant-1");
    expect(res.status).toBe(400);
    expect(await findQuote("Q-1")).not.toBeNull();
  });

  it("承認機能OFFの場合、APPROVED済みの見積も直接削除される", async () => {
    await seedQuote("Q-1", { status: "APPROVED" });
    const res = await callRequestDeletion("Q-1", "applicant-1");
    expect(res.status).toBe(200);
    expect(await findQuote("Q-1")).toBeNull();
  });

  it("承認機能OFFの場合、会社設定で無効化した時点でPENDING_APPROVAL中だった見積も直接削除される(取り下げ不要)", async () => {
    await seedQuote("Q-1", { status: "PENDING_APPROVAL" });
    const res = await callRequestDeletion("Q-1", "applicant-1");
    expect(res.status).toBe(200);
    expect(await findQuote("Q-1")).toBeNull();
  });

  it("承認機能ONの場合、APPROVED済みの見積はPENDING_DELETIONになり削除申請が作られる(即削除されない)", async () => {
    await enableQuoteApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_quotes", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedQuote("Q-1", { status: "APPROVED" });

    const res = await callRequestDeletion("Q-1", "applicant-1");
    expect(res.status).toBe(200);

    const quote = await findQuote("Q-1");
    expect(quote?.status).toBe("PENDING_DELETION");

    const requests = await findPendingRequestByTarget("Q-1");
    expect(requests).toHaveLength(1);
    expect(requests[0].requestType).toBe("DELETE");
  });
});

describe("承認確定(WorkflowTasksService.approveTask)によるquotes.adapter.tsの反映", () => {
  it("REGISTER申請(初回承認)が最終承認されると、quotes.statusがAPPROVEDになる", async () => {
    await enableQuoteApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_quotes", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedQuote("Q-1", { status: "DRAFT" });

    await callSubmitForApproval("Q-1", "applicant-1");
    const requests = await findPendingRequestByTarget("Q-1");
    const requestId = requests[0].id;

    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "Q-1"));
    expect(logs).toHaveLength(1);

    const res = await callApproveTask({
      logId: logs[0].id,
      requestId,
      userId: "approver-1",
    });
    expect(res.status).toBe(200);

    const quote = await findQuote("Q-1");
    expect(quote?.status).toBe("APPROVED");
  });

  it("UPDATE申請(承認済み見積の変更)が最終承認されると、header/itemsが新しい内容に置き換わる", async () => {
    await enableQuoteApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_quotes", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedQuote("Q-1", { status: "APPROVED", title: "旧タイトル" });
    await seedQuoteItem("Q-1", { itemName: "旧品目", quantity: 1, unitPrice: 100 });

    const submitRes = await callRequestUpdateApproval("applicant-1", {
      targetId: "Q-1",
      requestType: "UPDATE",
      payload: {
        header: { title: "新タイトル", partnerId: "partner-1", quoteDate: "2026-02-01" },
        items: [
          { itemId: "ITEM-2", itemName: "新品目", quantity: 2, unitPrice: 500 },
        ],
      },
    });
    expect(submitRes.status).toBe(200);

    // UPDATE申請中でも、承認されるまでは旧内容がそのまま有効(業務ルール5)
    expect((await findQuote("Q-1"))?.title).toBe("旧タイトル");

    const requests = await findPendingRequestByTarget("Q-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "Q-1"));

    const res = await callApproveTask({
      logId: logs[0].id,
      requestId,
      userId: "approver-1",
    });
    expect(res.status).toBe(200);

    const quote = await findQuote("Q-1");
    expect(quote?.title).toBe("新タイトル");
    expect(quote?.status).toBe("APPROVED");

    const items = await db
      .select()
      .from(schema.quoteItems)
      .where(eq(schema.quoteItems.quoteId, "Q-1"));
    expect(items).toHaveLength(1);
    expect(items[0].itemName).toBe("新品目");
    expect(items[0].quantity).toBe(2);
  });

  it("UPDATE申請の承認でも、明細IDを付けた明細は明細IDを保ったまま更新され、受注明細とのつながりが保たれる", async () => {
    await enableQuoteApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_quotes", [{ order: 1, roleId: "approver_role" }]);
    await seedQuote("Q-1", { status: "APPROVED" });
    await seedQuoteItem("Q-1", { itemName: "受注済みの品目", quantity: 1, unitPrice: 100 });
    await db.insert(schema.salesOrders).values({
      id: "SO-1",
      partnerId: "partner-1",
      sourceQuoteId: "Q-1",
      orderDate: new Date(),
      status: "DRAFT",
      createdBy: "applicant-1",
      createdAt: new Date(),
      updatedBy: "applicant-1",
      updatedAt: new Date(),
    });
    await db.insert(schema.salesOrderItems).values({
      id: "SO-1-item-1",
      salesOrderId: "SO-1",
      sourceQuoteItemId: "Q-1-item-1",
      itemId: "ITEM-1",
      itemName: "受注済みの品目",
      quantity: 1,
      unitPrice: 100,
      amount: 100,
      sortOrder: 0,
    });

    await callRequestUpdateApproval("applicant-1", {
      targetId: "Q-1",
      requestType: "UPDATE",
      payload: {
        header: { title: "数量変更", partnerId: "partner-1", quoteDate: "2026-02-01" },
        items: [{ id: "Q-1-item-1", itemId: "ITEM-1", itemName: "受注済みの品目", quantity: 3, unitPrice: 100 }],
      },
    });
    const requestId = (await findPendingRequestByTarget("Q-1"))[0].id;
    const logs = await db.select().from(schema.workflowLogs).where(eq(schema.workflowLogs.targetId, "Q-1"));
    const res = await callApproveTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(res.status).toBe(200);

    const items = await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.quoteId, "Q-1"));
    expect(items.map((i) => [i.id, i.quantity])).toEqual([["Q-1-item-1", 3]]);
    const orderItem = await db.select().from(schema.salesOrderItems).where(eq(schema.salesOrderItems.id, "SO-1-item-1"));
    expect(orderItem[0].sourceQuoteItemId).toBe("Q-1-item-1");
  });

  it("DELETE申請が最終承認されると、見積が物理削除される", async () => {
    await enableQuoteApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_quotes", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedQuote("Q-1", { status: "APPROVED" });

    await callRequestDeletion("Q-1", "applicant-1");
    const requests = await findPendingRequestByTarget("Q-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "Q-1"));

    const res = await callApproveTask({
      logId: logs[0].id,
      requestId,
      userId: "approver-1",
    });
    expect(res.status).toBe(200);
    expect(await findQuote("Q-1")).toBeNull();
  });
});

describe("差戻し確定(WorkflowTasksService.remandTask)によるquotes.adapter.tsの反映", () => {
  it("REGISTER申請の差戻しで、quotes.statusがDRAFTへ自動的に戻る(業務ルール4)", async () => {
    await enableQuoteApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_quotes", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedQuote("Q-1", { status: "DRAFT" });

    await callSubmitForApproval("Q-1", "applicant-1");
    const requests = await findPendingRequestByTarget("Q-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "Q-1"));

    const res = await callRemandTask({
      logId: logs[0].id,
      requestId,
      userId: "approver-1",
    });
    expect(res.status).toBe(200);

    const quote = await findQuote("Q-1");
    expect(quote?.status).toBe("DRAFT");
  });

  // BUG-015: 画面の「削除」は request-deletion を呼ぶ(下書きは直接削除)。この経路でも差戻しの申請を閉じる
  it("差し戻されて下書きに戻った見積を、画面と同じ request-deletion で削除すると、差戻しの申請も CANCELED になる", async () => {
    await enableQuoteApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_quotes", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedQuote("Q-1", { status: "DRAFT" });

    await callSubmitForApproval("Q-1", "applicant-1");
    const [request] = await findPendingRequestByTarget("Q-1");
    const [log] = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "Q-1"));
    await callRemandTask({ logId: log.id, requestId: request.id, userId: "approver-1" });
    expect((await findPendingRequestByTarget("Q-1"))[0].status).toBe("REMANDED");

    const res = await callRequestDeletion("Q-1", "applicant-1");
    expect(res.status).toBe(200);
    expect(await findQuote("Q-1")).toBeNull();
    expect((await findPendingRequestByTarget("Q-1"))[0].status).toBe("CANCELED");
  });

  it("DELETE申請の差戻しで、quotes.statusがAPPROVEDへ戻る(削除されない)", async () => {
    await enableQuoteApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_quotes", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedQuote("Q-1", { status: "APPROVED" });

    await callRequestDeletion("Q-1", "applicant-1");
    const requests = await findPendingRequestByTarget("Q-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "Q-1"));

    const res = await callRemandTask({
      logId: logs[0].id,
      requestId,
      userId: "approver-1",
    });
    expect(res.status).toBe(200);

    const quote = await findQuote("Q-1");
    expect(quote?.status).toBe("APPROVED");
  });
});

describe("取り下げ確定(WorkflowTasksService.cancelTask)によるquotes.adapter.tsの反映", () => {
  it("申請者自身によるREGISTER申請の取り下げで、quotes.statusがDRAFTへ戻り再編集できるようになる", async () => {
    await enableQuoteApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_quotes", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedQuote("Q-1", { status: "DRAFT" });

    await callSubmitForApproval("Q-1", "applicant-1");
    expect((await findQuote("Q-1"))?.status).toBe("PENDING_APPROVAL");

    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "Q-1"));

    const res = await callCancelTask({
      targetId: "Q-1",
      logId: logs[0].id,
      userId: "applicant-1",
    });
    expect(res.status).toBe(200);

    const quote = await findQuote("Q-1");
    expect(quote?.status).toBe("DRAFT");

    // DRAFTに戻っているので、取り下げ後は直接編集(PUT)が再びできる
    const updateRes = await callUpdateQuote("Q-1", "applicant-1", {
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      title: "取り下げ後の再編集",
      items: [],
    });
    expect(updateRes.status).toBe(200);
    expect((await findQuote("Q-1"))?.title).toBe("取り下げ後の再編集");
  });

  it("DELETE申請の取り下げで、quotes.statusがAPPROVEDへ戻る(削除されない)", async () => {
    await enableQuoteApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_quotes", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedQuote("Q-1", { status: "APPROVED" });

    await callRequestDeletion("Q-1", "applicant-1");
    expect((await findQuote("Q-1"))?.status).toBe("PENDING_DELETION");

    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "Q-1"));

    const res = await callCancelTask({
      targetId: "Q-1",
      logId: logs[0].id,
      userId: "applicant-1",
    });
    expect(res.status).toBe(200);

    const quote = await findQuote("Q-1");
    expect(quote?.status).toBe("APPROVED");
  });
});

describe("金額帯の異なる複数フローが同一requestTypeに定義されている場合のフロー選定(バグ修正の回帰テスト)", () => {
  it("3段階フロー(100万円以上)に一致する見積は、2段階フロー(100万円未満)ではなく正しく3段階分の承認を要求する", async () => {
    await enableQuoteApprovalWorkflow();
    await seedRole("users");
    await seedRole("manager");
    await seedRole("generalmanager");
    await seedUserRole("applicant-1", "users");
    await seedUser("manager-1");
    await seedUserRole("manager-1", "manager");
    await seedUser("generalmanager-1", { email: "generalmanager-1@example.com" });
    await seedUserRole("generalmanager-1", "generalmanager");

    // ユーザーのCSV相当: 「標準見積(100万未満)」(2段階)と「標準見積(1000万未満)」(3段階)が
    // 同一requestType="sales_quotes"でどちらもアクティブ登録されている状態を再現する
    await seedApprovalFlow(
      "flow-tier1",
      "sales_quotes",
      [
        { order: 1, roleId: "users" },
        { order: 2, roleId: "manager" },
      ],
      { min: 0, max: 999999 },
    );
    await seedApprovalFlow(
      "flow-tier2",
      "sales_quotes",
      [
        { order: 1, roleId: "users" },
        { order: 2, roleId: "manager" },
        { order: 3, roleId: "generalmanager" },
      ],
      { min: 1000000, max: 9999999999 },
    );

    await seedQuote("Q-1", { status: "DRAFT", totalAmount: 2000000 });

    // 申請提出: applicant-1は"users"ロールを持つため1段階目は自動通過し、
    // 2段階目(manager)がPENDINGになる
    const submitRes = await callSubmitForApproval("Q-1", "applicant-1");
    expect(submitRes.status).toBe(200);
    expect((await findQuote("Q-1"))?.status).toBe("PENDING_APPROVAL");

    const requests = await findPendingRequestByTarget("Q-1");
    const requestId = requests[0].id;

    let logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "Q-1"));
    expect(logs).toHaveLength(2); // 1段階目(自動通過・APPROVED) + 2段階目(PENDING)
    const managerLog = logs.find((l) => l.layer === 2)!;
    expect(managerLog.status).toBe("PENDING");

    // 2段階目(manager)を承認 → 修正前は誤って2段階フローとマッチし、
    // ここで最終承認扱い(APPROVED)になってしまっていた。
    // 正しくは3段階目(generalmanager)へ回送され、まだ最終承認されないはず。
    const managerApproveRes = await callApproveTask({
      logId: managerLog.id,
      requestId,
      userId: "manager-1",
    });
    expect(managerApproveRes.status).toBe(200);

    const stillPendingRequest = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.id, requestId));
    expect(stillPendingRequest[0].status).toBe("PENDING");
    expect((await findQuote("Q-1"))?.status).toBe("PENDING_APPROVAL");

    logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "Q-1"));
    expect(logs).toHaveLength(3);
    const generalManagerLog = logs.find((l) => l.layer === 3)!;
    expect(generalManagerLog.status).toBe("PENDING");
    expect(generalManagerLog.approverRoleId).toBe("generalmanager");

    // 3段階目(generalmanager)を承認 → ここで初めて最終承認され、quotes.statusがAPPROVEDになる
    const finalApproveRes = await callApproveTask({
      logId: generalManagerLog.id,
      requestId,
      userId: "generalmanager-1",
    });
    expect(finalApproveRes.status).toBe(200);
    expect((await findQuote("Q-1"))?.status).toBe("APPROVED");
  });
});
