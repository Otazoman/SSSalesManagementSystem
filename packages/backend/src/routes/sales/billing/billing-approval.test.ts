import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";
import { billingRouter } from "./index";
import { WorkflowTasksService } from "../../workflow/workflow-tasks/workflow-tasks.service";

// REQ-017: 請求の承認。会社設定 is_billing_approval_enabled が ON の時は、承認済みの請求だけ PDF の発行・入金の記録ができる。
// OFF の時は今までと同じ(下書きから PDF を発行できる)。ヘルパーは quote-workflow.service.test.ts と同じ形(複製)

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
  const res = await billingRouter.request(
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

async function enableBillingApproval() {
  await env.COMPANY_SETTINGS.put("config", JSON.stringify({ is_billing_approval_enabled: true }));
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
    requestType: "sales_billing",
    minAmount: 0,
    maxAmount: 999999999,
    isActive: true,
  });
  await db.insert(schema.approvalFlowSteps).values({ id: "flow-1-step-1", flowId: "flow-1", stepOrder: 1, approverRoleId: "approver_role" });
}

async function seedBilling(id: string, status = "DRAFT") {
  await db.insert(schema.billingHeaders).values({
    id,
    partnerId: "P-1",
    title: "請求の件名",
    billingDate: now,
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
  await db.insert(schema.billingItems).values({
    id: `${id}-item-1`,
    billingHeaderId: id,
    itemName: "手入力の品名",
    quantity: 1,
    unitPrice: 10000,
    amount: 10000,
    taxAmount: 1000,
    sortOrder: 0,
  });
}

const statusOf = async (id: string) =>
  (await db.select().from(schema.billingHeaders).where(eq(schema.billingHeaders.id, id)))[0]?.status;

async function submitAndFindTask(id: string) {
  const res = await call(`/${id}/submit-for-approval`, { method: "POST", body: "{}" });
  expect(res.status).toBe(200);
  const [request] = await db.select().from(schema.masterApprovalRequests).where(eq(schema.masterApprovalRequests.targetId, id));
  const [log] = await db.select().from(schema.workflowLogs).where(eq(schema.workflowLogs.targetId, id));
  return { request, log };
}

beforeEach(async () => {
  await db.delete(schema.paymentReceipts);
  await db.delete(schema.billingItems);
  await db.delete(schema.billingHeaders);
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

describe("POST /:id/submit-for-approval(REQ-017)", () => {
  it("承認が OFF の時は申請できない(400)。請求は下書きのまま", async () => {
    await seedBilling("BL-1");
    const res = await call("/BL-1/submit-for-approval", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    expect(await statusOf("BL-1")).toBe("DRAFT");
  });

  it("承認が ON でも、合う承認フローが無ければ 400 で下書きに戻す", async () => {
    await enableBillingApproval();
    await seedBilling("BL-1");
    const res = await call("/BL-1/submit-for-approval", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    expect(await statusOf("BL-1")).toBe("DRAFT");
  });

  it("承認が ON で承認フローがあれば、承認申請中になり、申請が作られる(金額は請求の合計)", async () => {
    await enableBillingApproval();
    await seedApprover();
    await seedBilling("BL-1");
    const { request } = await submitAndFindTask("BL-1");
    expect(await statusOf("BL-1")).toBe("PENDING_APPROVAL");
    expect(request).toMatchObject({ targetType: "sales_billing", requestType: "REGISTER", status: "PENDING", applicantId: "applicant-1" });
  });

  it("下書きでない請求は申請できない(400)", async () => {
    await enableBillingApproval();
    await seedApprover();
    await seedBilling("BL-1", "ISSUED");
    const res = await call("/BL-1/submit-for-approval", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
  });
});

describe("承認・差戻し・取下げの反映(REQ-017)", () => {
  beforeEach(async () => {
    await enableBillingApproval();
    await seedApprover();
    await seedBilling("BL-1");
  });

  it("承認すると承認済みになる", async () => {
    const { request, log } = await submitAndFindTask("BL-1");
    const res = await callTask("approve", { logId: log.id, requestId: request.id, userId: "approver-1" }, "approver-1");
    expect(res.status).toBe(200);
    expect(await statusOf("BL-1")).toBe("APPROVED");
  });

  it("差し戻すと下書きに戻る", async () => {
    const { request, log } = await submitAndFindTask("BL-1");
    const res = await callTask("remand", { logId: log.id, requestId: request.id, userId: "approver-1" }, "approver-1");
    expect(res.status).toBe(200);
    expect(await statusOf("BL-1")).toBe("DRAFT");
  });

  it("取り下げると下書きに戻る", async () => {
    const { log } = await submitAndFindTask("BL-1");
    const res = await callTask("cancel", { targetId: "BL-1", logId: log.id, userId: "applicant-1" }, "applicant-1");
    expect(res.status).toBe(200);
    expect(await statusOf("BL-1")).toBe("DRAFT");
  });
});

// PDF のデータ(GET /:id/pdf-source)は画面の権限を確かめるため、管理者で呼ぶ
async function seedAdmin() {
  await db.insert(schema.roles).values({ id: "admin", name: "admin", createdAt: now });
  await db.insert(schema.users).values({
    id: "admin-1",
    employeeNumber: "admin-1",
    email: "admin-1@example.com",
    name: "管理者",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.userRoles).values({ userId: "admin-1", roleId: "admin", departmentSurrogateId: null });
}
const pdfSourceStatus = async (id: string) => (await call(`/${id}/pdf-source`, { method: "GET" }, "admin-1")).status;

describe("承認が ON の時の、承認前の請求の操作(REQ-017)", () => {
  it("下書き・承認申請中の請求は PDF のデータを作れない(400)。承認済みなら作れる", async () => {
    await enableBillingApproval();
    await seedBilling("BL-DRAFT", "DRAFT");
    await seedBilling("BL-PENDING", "PENDING_APPROVAL");
    await seedBilling("BL-OK", "APPROVED");
    await seedAdmin();
    expect(await pdfSourceStatus("BL-DRAFT")).toBe(400);
    expect(await pdfSourceStatus("BL-PENDING")).toBe(400);
    expect(await pdfSourceStatus("BL-OK")).toBe(200);
  });

  it("承認が OFF の時は、今までどおり下書きから PDF のデータを作れる", async () => {
    await seedBilling("BL-DRAFT", "DRAFT");
    await seedAdmin();
    expect(await pdfSourceStatus("BL-DRAFT")).toBe(200);
  });

  it("承認申請中の請求は削除できない(400)", async () => {
    await enableBillingApproval();
    await seedBilling("BL-1", "PENDING_APPROVAL");
    const res = await call("/BL-1", { method: "DELETE" });
    expect(res.status).toBe(400);
    expect(await statusOf("BL-1")).toBe("PENDING_APPROVAL");
  });

  it("承認申請中・承認済み(未発行)の請求には入金を記録できない(400)", async () => {
    await enableBillingApproval();
    await seedBilling("BL-PENDING", "PENDING_APPROVAL");
    await seedBilling("BL-APPROVED", "APPROVED");
    const body = JSON.stringify({ receivedDate: "2026-11-15", amount: 1000, method: "BANK_TRANSFER" });
    expect((await call("/BL-PENDING/payment-receipts", { method: "POST", body })).status).toBe(400);
    expect((await call("/BL-APPROVED/payment-receipts", { method: "POST", body })).status).toBe(400);
  });
});
