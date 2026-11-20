import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";
import { paymentRouter } from "./index";
import { WorkflowTasksService } from "../../workflow/workflow-tasks/workflow-tasks.service";

// REQ-026: 支払の作成の承認。会社設定 is_payment_approval_enabled が ON の時は、承認済みの支払だけ支払の記録・総合振込データの対象にできる。
// OFF の時は今までと同じ。ヘルパーは billing-approval.test.ts(REQ-017)と同じ形(複製)

const db = drizzle(env.DB, { schema });
const now = new Date();

function buildWorkflowTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/approve", async (c) => c.json(await WorkflowTasksService.approveTask(c, db, await c.req.json())));
  app.post("/remand", async (c) => c.json(await WorkflowTasksService.remandTask(c, db, await c.req.json())));
  app.post("/cancel", async (c) => c.json(await WorkflowTasksService.cancelTask(c, db, await c.req.json())));
  return app;
}

async function cookieOf(userId: string): Promise<string> {
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

async function call(path: string, init: RequestInit, userId = "applicant-1") {
  const ctx = createExecutionContext();
  const res = await paymentRouter.request(
    path,
    { ...init, headers: { Cookie: await cookieOf(userId), "Content-Type": "application/json", ...(init.headers ?? {}) } },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function callTask(action: "approve" | "remand" | "cancel", body: Record<string, unknown>, userId: string) {
  const ctx = createExecutionContext();
  const res = await buildWorkflowTestApp().request(
    `/${action}`,
    { method: "POST", headers: { Cookie: await cookieOf(userId), "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function enablePaymentApproval() {
  await env.COMPANY_SETTINGS.put("config", JSON.stringify({ is_payment_approval_enabled: true }));
}

async function seedApprover() {
  await db.insert(schema.roles).values({ id: "approver_role", name: "approver_role", createdAt: now });
  await db.insert(schema.users).values({
    id: "approver-1",
    employeeNumber: "approver-1",
    email: "approver-1@example.com",
    name: "承認者",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.userRoles).values({ userId: "approver-1", roleId: "approver_role", departmentSurrogateId: null });
  await db.insert(schema.approvalFlows).values({
    id: "flow-1",
    name: "flow-1",
    requestType: "purchase_payment",
    minAmount: 0,
    maxAmount: 999999999,
    isActive: true,
  });
  await db.insert(schema.approvalFlowSteps).values({ id: "flow-1-step-1", flowId: "flow-1", stepOrder: 1, approverRoleId: "approver_role" });
}

async function seedPayment(id: string, status = "DRAFT") {
  await db.insert(schema.paymentHeaders).values({
    id,
    partnerId: "P-1",
    title: "支払の件名",
    paymentDate: now,
    mode: "PER_TRANSACTION",
    status,
    totalAmount: 11000,
    taxAmount: 1000,
    reconciledAmount: 0,
    reconciliationStatus: "UNRECONCILED",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  });
  await db.insert(schema.paymentHeaderItems).values({
    id: `${id}-item-1`,
    paymentHeaderId: id,
    itemName: "手入力の品名",
    amount: 11000,
    taxAmount: 1000,
    sortOrder: 0,
  });
}

const statusOf = async (id: string) =>
  (await db.select().from(schema.paymentHeaders).where(eq(schema.paymentHeaders.id, id)))[0]?.status;

async function submitAndFindTask(id: string) {
  const res = await call(`/${id}/submit-for-approval`, { method: "POST", body: "{}" });
  expect(res.status).toBe(200);
  const [request] = await db.select().from(schema.masterApprovalRequests).where(eq(schema.masterApprovalRequests.targetId, id));
  const [log] = await db.select().from(schema.workflowLogs).where(eq(schema.workflowLogs.targetId, id));
  return { request, log };
}

beforeEach(async () => {
  await db.delete(schema.paymentDisbursements);
  await db.delete(schema.paymentHeaderItems);
  await db.delete(schema.paymentHeaders);
  await db.delete(schema.masterApprovalContexts);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.workflowLogs);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.userRoles);
  await db.delete(schema.roles);
  await db.delete(schema.partnerContacts);
  await db.delete(schema.partners);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.delete("config");

  await db.insert(schema.users).values({
    id: "applicant-1",
    employeeNumber: "applicant-1",
    email: "applicant-1@example.com",
    name: "申請者",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.partners).values({
    id: "P-1",
    name: "取引先1",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  });
});

const disburse = (id: string) =>
  call(`/${id}/disbursements`, {
    method: "POST",
    body: JSON.stringify({ paidDate: "2026-11-20", amount: 1000, method: "BANK_TRANSFER" }),
  });

describe("REQ-026: 支払の承認", () => {
  it("承認が OFF の時は申請できない(400)。支払の記録は今までどおりできる", async () => {
    await seedPayment("PM-1");
    expect((await call("/PM-1/submit-for-approval", { method: "POST", body: "{}" })).status).toBe(400);
    expect(await statusOf("PM-1")).toBe("DRAFT");
    expect((await disburse("PM-1")).status).toBe(200);
  });

  it("承認が ON でも、合う承認フローが無ければ 400 で下書きに戻す", async () => {
    await enablePaymentApproval();
    await seedPayment("PM-1");
    expect((await call("/PM-1/submit-for-approval", { method: "POST", body: "{}" })).status).toBe(400);
    expect(await statusOf("PM-1")).toBe("DRAFT");
  });

  it("承認が ON の時は、承認前の支払は記録できず、支払管理の承認フローで申請・承認すると記録できる", async () => {
    await enablePaymentApproval();
    await seedApprover();
    await seedPayment("PM-1");

    const before = await disburse("PM-1");
    expect(before.status).toBe(400);
    expect(JSON.stringify(await before.json())).toContain("承認");

    const { request, log } = await submitAndFindTask("PM-1");
    expect(await statusOf("PM-1")).toBe("PENDING_APPROVAL");
    expect(request).toMatchObject({ targetType: "purchase_payment", requestType: "REGISTER", flowId: "flow-1" });
    expect((await disburse("PM-1")).status).toBe(400);

    expect((await callTask("approve", { logId: log.id, requestId: request.id, userId: "approver-1" }, "approver-1")).status).toBe(200);
    expect(await statusOf("PM-1")).toBe("APPROVED");
    expect((await disburse("PM-1")).status).toBe(200);
  });

  it("差し戻すと下書きに戻る", async () => {
    await enablePaymentApproval();
    await seedApprover();
    await seedPayment("PM-1");
    const { request, log } = await submitAndFindTask("PM-1");
    expect(
      (await callTask("remand", { logId: log.id, requestId: request.id, userId: "approver-1", comment: "金額を確認" }, "approver-1")).status,
    ).toBe(200);
    expect(await statusOf("PM-1")).toBe("DRAFT");
  });

  it("承認が ON の時、承認済みの支払は CSV で書き換えられない", async () => {
    await enablePaymentApproval();
    await seedPayment("PM-1", "APPROVED");
    const csv = "id,partnerId,status,totalAmount\nPM-1,P-1,DRAFT,1\n";
    const form = new FormData();
    form.append("file", new File([csv], "payments.csv", { type: "text/csv" }));
    const ctx = createExecutionContext();
    const res = await paymentRouter.request(
      "/bulk-register",
      { method: "POST", headers: { Cookie: await cookieOf("applicant-1") }, body: form },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("承認申請中・承認済みの支払は CSV で変更できません");
    expect(await statusOf("PM-1")).toBe("APPROVED");
  });
});
