import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import { signSessionToken } from "../../platform/auth/session-token";
import type { Env } from "../../types/env";
import { billingRouter } from "../../routes/sales/billing/index";
import { cashReceiptsRouter } from "../../routes/sales/cash-receipts/index";
import { paymentRouter } from "../../routes/purchase/payment/index";
import { WorkflowTasksService } from "../../routes/workflow/workflow-tasks/workflow-tasks.service";
import { listUnpostedJournalSources } from "../../platform/journal/journal-sources";

// REQ-018: 入金(請求への入金・単体入金)と支払の消込の承認。ON の時は「申請中」で記録し、承認されるまで消込額・仕訳に入れない。
// 差戻しでは入らないまま(履歴として残す)。OFF の時の動きは既存のテスト(billing・cash-receipts・payment・journal)で確かめている

const db = drizzle(env.DB, { schema });
const now = new Date();

async function cookieOf(userId: string): Promise<string> {
  const token = await signSessionToken(
    { userId, employeeNumber: userId, name: "テスト", role: "user", deptName: "部署", companyName: "会社", isAuditEnabled: true },
    await env.SESSION_SECRET.get(),
    3600,
  );
  return `session_token=${token}`;
}

async function call(router: Hono<any>, path: string, init: RequestInit = {}, userId = "applicant-1") {
  const ctx = createExecutionContext();
  const headers: Record<string, string> = { Cookie: await cookieOf(userId) };
  if (typeof init.body === "string") headers["Content-Type"] = "application/json";
  const res = await router.request(path, { ...init, headers }, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const post = (router: Hono<any>, path: string, body: unknown) => call(router, path, { method: "POST", body: JSON.stringify(body) });

function workflowApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/approve", async (c) => c.json(await WorkflowTasksService.approveTask(c, db, await c.req.json())));
  app.post("/remand", async (c) => c.json(await WorkflowTasksService.remandTask(c, db, await c.req.json())));
  return app;
}

async function decide(action: "approve" | "remand", targetId: string) {
  const [request] = await db.select().from(schema.masterApprovalRequests).where(eq(schema.masterApprovalRequests.targetId, targetId));
  const [log] = await db.select().from(schema.workflowLogs).where(eq(schema.workflowLogs.targetId, targetId));
  expect(request, `${targetId} の申請が無い`).toBeDefined();
  const ctx = createExecutionContext();
  const res = await workflowApp().request(
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

async function enable(config: Record<string, boolean>) {
  await env.COMPANY_SETTINGS.put("config", JSON.stringify(config));
}

// BUG-103: 承認フローはメニュー単位(入金は請求管理、支払の消込は支払管理)。documentKind で伝票の種類ごとに分ける
async function seedFlow(requestType: string, documentKind?: string) {
  const id = `flow-${requestType}-${documentKind ?? "all"}`;
  await db.insert(schema.approvalFlows).values({
    id, name: id, requestType, minAmount: 0, maxAmount: 999999999, isActive: true,
    ...(documentKind ? { matchField: "documentKind", matchValue: documentKind } : {}),
  });
  await db.insert(schema.approvalFlowSteps).values({ id: `step-${id}`, flowId: id, stepOrder: 1, approverRoleId: "approver_role" });
}

const audit = { createdBy: "applicant-1", createdAt: now, updatedBy: "applicant-1", updatedAt: now };

async function seedBilling(id: string, totalAmount = 10000) {
  await db.insert(schema.billingHeaders).values({
    id, partnerId: "P-1", title: "請求", billingDate: now, mode: "PER_TRANSACTION", status: "ISSUED",
    totalAmount, taxAmount: 0, reconciledAmount: 0, reconciliationStatus: "UNRECONCILED", ...audit,
  });
}

async function seedPayment(id: string, totalAmount = 10000) {
  await db.insert(schema.paymentHeaders).values({
    id, partnerId: "P-1", title: "支払", paymentDate: now, mode: "PER_TRANSACTION", status: "ISSUED",
    totalAmount, taxAmount: 0, reconciledAmount: 0, reconciliationStatus: "UNRECONCILED", ...audit,
  });
}

const billingOf = async (id: string) => (await db.select().from(schema.billingHeaders).where(eq(schema.billingHeaders.id, id)))[0];
const paymentOf = async (id: string) => (await db.select().from(schema.paymentHeaders).where(eq(schema.paymentHeaders.id, id)))[0];
const receiptsOf = (billingHeaderId: string) =>
  db.select().from(schema.paymentReceipts).where(eq(schema.paymentReceipts.billingHeaderId, billingHeaderId));
const cashOf = async (id: string) => (await db.select().from(schema.cashReceipts).where(eq(schema.cashReceipts.id, id)))[0];
const journalIds = async (kind: "payment_receipt" | "payment_disbursement" | "cash_receipt") =>
  (await listUnpostedJournalSources(env.DB, kind, {})).map((r) => r.sourceRefId);

beforeEach(async () => {
  await db.delete(schema.paymentReceipts);
  await db.delete(schema.cashReceipts);
  await db.delete(schema.billingItems);
  await db.delete(schema.billingHeaders);
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

  for (const id of ["applicant-1", "approver-1"]) {
    await db.insert(schema.users).values({ id, employeeNumber: id, email: `${id}@example.com`, name: id, isActive: true, createdAt: now, updatedAt: now });
  }
  await db.insert(schema.roles).values({ id: "approver_role", name: "approver_role", createdAt: now });
  await db.insert(schema.userRoles).values({ userId: "approver-1", roleId: "approver_role", departmentSurrogateId: null });
  await db.insert(schema.partners).values({ id: "P-1", name: "取引先1", ...audit });
});

describe("請求への入金の承認(sales_payment_receipts)", () => {
  beforeEach(async () => {
    await enable({ is_cash_receipt_approval_enabled: true });
    await seedFlow("sales_billing", "PAYMENT_RECEIPT");
    await seedBilling("BL-1");
  });

  it("記録すると申請中になり、請求の消込額・仕訳には入らない。承認すると入る", async () => {
    const res = await post(billingRouter, "/BL-1/payment-receipts", { receivedDate: now.toISOString(), amount: 4000 });
    expect(res.status).toBe(200);
    const [receipt] = await receiptsOf("BL-1");
    expect(receipt.approvalStatus).toBe("PENDING");
    expect((await billingOf("BL-1")).reconciledAmount).toBe(0);
    expect(await journalIds("payment_receipt")).not.toContain(receipt.id);

    await decide("approve", receipt.id);
    expect((await receiptsOf("BL-1"))[0].approvalStatus).toBe("APPROVED");
    expect(await billingOf("BL-1")).toMatchObject({ reconciledAmount: 4000, reconciliationStatus: "PARTIALLY_RECONCILED" });
    expect(await journalIds("payment_receipt")).toContain(receipt.id);
  });

  it("差し戻すと差戻しとして残り、消込額には入らないまま", async () => {
    await post(billingRouter, "/BL-1/payment-receipts", { receivedDate: now.toISOString(), amount: 4000 });
    const [receipt] = await receiptsOf("BL-1");
    await decide("remand", receipt.id);
    expect((await receiptsOf("BL-1"))[0].approvalStatus).toBe("REMANDED");
    expect((await billingOf("BL-1")).reconciledAmount).toBe(0);
    // 差し戻した分は未消込額に戻るため、請求額の全額を記録できる
    expect((await post(billingRouter, "/BL-1/payment-receipts", { receivedDate: now.toISOString(), amount: 10000 })).status).toBe(200);
  });

  it("承認待ちの入金も未消込額から引き、超える入金は断る(前受金に振り分けない)", async () => {
    await post(billingRouter, "/BL-1/payment-receipts", { receivedDate: now.toISOString(), amount: 8000 });
    const res = await post(billingRouter, "/BL-1/payment-receipts", { receivedDate: now.toISOString(), amount: 3000 });
    expect(res.status).toBe(400);
    expect(await receiptsOf("BL-1")).toHaveLength(1);
    expect(await db.select().from(schema.cashReceipts)).toHaveLength(0);
  });

  it("合う承認フローが無ければ 400 で、記録した入金は残さない", async () => {
    await db.delete(schema.approvalFlowSteps);
    await db.delete(schema.approvalFlows);
    expect((await post(billingRouter, "/BL-1/payment-receipts", { receivedDate: now.toISOString(), amount: 4000 })).status).toBe(400);
    expect(await receiptsOf("BL-1")).toHaveLength(0);
  });

  it("承認申請中の入金がある請求は削除できない", async () => {
    await post(billingRouter, "/BL-1/payment-receipts", { receivedDate: now.toISOString(), amount: 4000 });
    expect((await call(billingRouter, "/BL-1", { method: "DELETE" })).status).toBe(400);
  });

  it("CSV の入金の取込は断る", async () => {
    const form = new FormData();
    form.append("file", new File(["billingHeaderId,receivedDate,amount\nBL-1,2026-11-15,1000\n"], "r.csv", { type: "text/csv" }));
    const res = await call(billingRouter, "/payment-receipts/bulk-register", { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(await receiptsOf("BL-1")).toHaveLength(0);
  });
});

describe("単体入金の承認(sales_cash_receipts)と紐づけ", () => {
  beforeEach(async () => {
    await enable({ is_cash_receipt_approval_enabled: true });
    await seedFlow("sales_billing", "CASH_RECEIPT");
    await seedFlow("sales_billing", "PAYMENT_RECEIPT");
    await seedBilling("BL-1");
  });

  async function register(amount = 3000) {
    const res = await post(cashReceiptsRouter, "/register", { partnerId: "P-1", receiptDate: now.toISOString(), amount });
    expect(res.status).toBe(200);
    return ((await res.json()) as { id: string }).id;
  }

  it("登録すると申請中になり、仕訳にも紐づけにも使えず、削除もできない。承認すると使える", async () => {
    const id = await register();
    expect((await cashOf(id)).approvalStatus).toBe("PENDING");
    expect(await journalIds("cash_receipt")).not.toContain(id);
    expect((await post(cashReceiptsRouter, `/${id}/link`, { billingHeaderId: "BL-1" })).status).toBe(400);
    expect((await call(cashReceiptsRouter, `/${id}`, { method: "DELETE" })).status).toBe(400);

    await decide("approve", id);
    expect((await cashOf(id)).approvalStatus).toBe("APPROVED");
    expect(await journalIds("cash_receipt")).toContain(id);
  });

  it("差し戻した単体入金は削除できる", async () => {
    const id = await register();
    await decide("remand", id);
    expect((await cashOf(id)).approvalStatus).toBe("REMANDED");
    expect((await call(cashReceiptsRouter, `/${id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("承認済みの単体入金を紐づけると、請求への入金が申請中になる。差し戻すと単体入金は未紐づけに戻る", async () => {
    const id = await register();
    await decide("approve", id);
    expect((await post(cashReceiptsRouter, `/${id}/link`, { billingHeaderId: "BL-1" })).status).toBe(200);
    const [receipt] = await receiptsOf("BL-1");
    expect(receipt).toMatchObject({ approvalStatus: "PENDING", cashReceiptId: id });
    expect((await cashOf(id)).status).toBe("LINKED");
    expect((await billingOf("BL-1")).reconciledAmount).toBe(0);

    await decide("remand", receipt.id);
    expect((await cashOf(id)).status).toBe("UNLINKED");
    expect((await billingOf("BL-1")).reconciledAmount).toBe(0);
  });
});

describe("支払の消込の承認(purchase_payment_disbursements)", () => {
  beforeEach(async () => {
    await enable({ is_payment_disbursement_approval_enabled: true });
    await seedFlow("purchase_payment");
    await seedPayment("PY-1");
  });

  const disbursementsOf = () => db.select().from(schema.paymentDisbursements);

  it("記録すると申請中で消込額・仕訳に入らず、承認で入る", async () => {
    expect((await post(paymentRouter, "/PY-1/disbursements", { paidDate: now.toISOString(), amount: 10000 })).status).toBe(200);
    const [d] = await disbursementsOf();
    expect(d.approvalStatus).toBe("PENDING");
    expect((await paymentOf("PY-1")).reconciledAmount).toBe(0);
    expect(await journalIds("payment_disbursement")).not.toContain(d.id);

    await decide("approve", d.id);
    expect(await paymentOf("PY-1")).toMatchObject({ reconciledAmount: 10000, reconciliationStatus: "RECONCILED" });
    expect(await journalIds("payment_disbursement")).toContain(d.id);
  });

  it("差し戻すと消込額に入らないまま。承認待ちの分は未消込額から引く", async () => {
    await post(paymentRouter, "/PY-1/disbursements", { paidDate: now.toISOString(), amount: 6000 });
    expect((await post(paymentRouter, "/PY-1/disbursements", { paidDate: now.toISOString(), amount: 5000 })).status).toBe(400);
    const [d] = await disbursementsOf();
    await decide("remand", d.id);
    expect((await disbursementsOf())[0].approvalStatus).toBe("REMANDED");
    expect((await paymentOf("PY-1")).reconciledAmount).toBe(0);
  });

  it("入金の承認だけ ON の時は、支払は今までどおりすぐ消込に入る", async () => {
    await enable({ is_cash_receipt_approval_enabled: true });
    await post(paymentRouter, "/PY-1/disbursements", { paidDate: now.toISOString(), amount: 4000 });
    expect((await disbursementsOf())[0].approvalStatus).toBe("APPROVED");
    expect((await paymentOf("PY-1")).reconciledAmount).toBe(4000);
  });
});
