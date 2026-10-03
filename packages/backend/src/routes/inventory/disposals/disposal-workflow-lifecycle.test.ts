import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { respondError } from "../../../platform/http/error-handler";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";
import { seedFixtures } from "../../../../test/support/fixtures";
import { stockDisposalsRouter } from "./index";

/**
 * Item6 Phase6-3-3: 承認機能ON時の廃棄ライフサイクル(申請→承認/差戻し→取消)。
 * targetTypeは入出庫と同じ"inventory_stock"を共有するため、承認フロー(requestType="inventory_stock")も
 * 共有前提でテストする。ON/OFFの判定だけは独立フラグ(is_disposal_approval_enabled)を使う。
 */

vi.mock("../../../workflow-engine/notifier", () => ({
  sendWorkflowMail: vi.fn(async () => {}),
  notifyApprovalRequestSubmitted: vi.fn(async () => {}),
}));

const db = drizzle(env.DB, { schema });

function buildWorkflowTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  // 本番のルーターと同じく、業務エラーはそのステータスで返す
  app.onError((err, c) => respondError(c, err));
  app.post("/approve", async (c) => {
    const { WorkflowTasksService } = await import(
      "../../workflow/workflow-tasks/workflow-tasks.service"
    );
    const body = await c.req.json();
    const result = await WorkflowTasksService.approveTask(c, db, body);
    return c.json(result);
  });
  app.post("/remand", async (c) => {
    const { WorkflowTasksService } = await import(
      "../../workflow/workflow-tasks/workflow-tasks.service"
    );
    const body = await c.req.json();
    const result = await WorkflowTasksService.remandTask(c, db, body);
    return c.json(result);
  });
  app.post("/cancel", async (c) => {
    const { WorkflowTasksService } = await import(
      "../../workflow/workflow-tasks/workflow-tasks.service"
    );
    const body = await c.req.json();
    const result = await WorkflowTasksService.cancelTask(c, db, body);
    return c.json(result);
  });
  return app;
}

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

async function postDisposal(actorUserId: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockDisposalsRouter.request(
    "/register",
    {
      method: "POST",
      headers: {
        Cookie: await buildSessionCookieHeader(actorUserId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function putDisposal(actorUserId: string, id: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockDisposalsRouter.request(
    `/${id}`,
    {
      method: "PUT",
      headers: {
        Cookie: await buildSessionCookieHeader(actorUserId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
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

async function callCancelTask(params: { targetId: string; logId: string; userId: string }) {
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

async function findPendingLogAndRequest(targetId: string) {
  const logs = await db
    .select()
    .from(schema.workflowLogs)
    .where(eq(schema.workflowLogs.targetId, targetId));
  const pendingLog = logs.find((l: any) => l.status === "PENDING");

  const requests = await db
    .select()
    .from(schema.masterApprovalRequests)
    .where(eq(schema.masterApprovalRequests.targetId, targetId));
  const pendingRequest = requests.find((r: any) => r.status === "PENDING");

  return { pendingLog, pendingRequest };
}

const now = new Date();

beforeEach(async () => {
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.stockDisposals);
  await db.delete(schema.workflowLogs);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.userRoles);
  await db.delete(schema.roles);
  await db.delete(schema.locations);
  await db.delete(schema.warehouses);
  await db.delete(schema.items);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.delete("config");

  await seedFixtures(db, "inventory-approval"); // 申請者applicant-1・承認者approver-1・承認フロー(test/fixtures/inventory-approval)
  await env.COMPANY_SETTINGS.put(
    "config",
    JSON.stringify({ is_disposal_approval_enabled: true }),
  );

  await db.insert(schema.units).values({
    code: "PCS",
    name: "個",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  });
  await db.insert(schema.accounts).values({
    code: "ACC1",
    name: "品目",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  });
  await db.insert(schema.items).values({
    id: "ITEM1",
    name: "テスト品目",
    baseUnitCode: "PCS",
    accountCode: "ACC1",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  });
  await db.insert(schema.warehouses).values({
    id: "WH1",
    name: "本社倉庫",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  });
  await db.insert(schema.locations).values({
    id: "LOC1",
    warehouseId: "WH1",
    name: "A-1",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  });
  await db.insert(schema.stocks).values({
    id: "STOCK1",
    itemId: "ITEM1",
    warehouseId: "WH1",
    locationId: "LOC1",
    lotNumber: "NONE",
    accountCode: "ACC1",
    qualityStatus: "NORMAL",
    quantity: 10,
    updatedAt: now,
  });
});

describe("承認機能ON時の廃棄ライフサイクル", () => {
  it("申請→最終承認で在庫が減算される", async () => {
    const createRes = await postDisposal("applicant-1", {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      quantity: 4,
    });
    expect(createRes.status).toBe(200);
    const { disposalId } = (await createRes.json()) as { disposalId: string };

    let record = await db
      .select()
      .from(schema.stockDisposals)
      .where(eq(schema.stockDisposals.id, disposalId));
    expect(record[0].status).toBe("UNAPPROVED");

    let stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(10);

    const { pendingLog, pendingRequest } = await findPendingLogAndRequest(disposalId);
    expect(pendingLog).toBeTruthy();
    expect(pendingRequest).toBeTruthy();

    const approveRes = await callApproveTask({
      logId: pendingLog!.id,
      requestId: pendingRequest!.id,
      userId: "approver-1",
    });
    expect(approveRes.status).toBe(200);

    record = await db
      .select()
      .from(schema.stockDisposals)
      .where(eq(schema.stockDisposals.id, disposalId));
    expect(record[0].status).toBe("APPROVED");

    stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(6);
  });

  it("BUG-049: 承認時に在庫が足りない場合は、在庫・廃棄・申請のどれも変えず、承認待ちのまま残る", async () => {
    const createRes = await postDisposal("applicant-1", {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      quantity: 4,
    });
    const { disposalId } = (await createRes.json()) as { disposalId: string };
    // 申請の後、承認までの間に在庫が減った
    await db.update(schema.stocks).set({ quantity: 2 }).where(eq(schema.stocks.id, "STOCK1"));

    const { pendingLog, pendingRequest } = await findPendingLogAndRequest(disposalId);
    const approveRes = await callApproveTask({
      logId: pendingLog!.id,
      requestId: pendingRequest!.id,
      userId: "approver-1",
    });
    expect(approveRes.status).toBe(409);

    const stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(2);
    const record = await db.select().from(schema.stockDisposals).where(eq(schema.stockDisposals.id, disposalId));
    expect(record[0].status).toBe("UNAPPROVED");
    const [log] = await db.select().from(schema.workflowLogs).where(eq(schema.workflowLogs.id, pendingLog!.id));
    expect(log.status).toBe("PENDING");
    const [request] = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.id, pendingRequest!.id));
    expect(request.status).toBe("PENDING");
  });

  it("差戻し後に修正して再申請すると、同じidのまま1件のみ存在し、新しい数量で最終承認できる", async () => {
    const createRes = await postDisposal("applicant-1", {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      quantity: 3,
    });
    const { disposalId } = (await createRes.json()) as { disposalId: string };

    const { pendingLog, pendingRequest } = await findPendingLogAndRequest(disposalId);
    const remandRes = await callRemandTask({
      logId: pendingLog!.id,
      requestId: pendingRequest!.id,
      userId: "approver-1",
    });
    expect(remandRes.status).toBe(200);

    const resubmitRes = await putDisposal("applicant-1", disposalId, {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      quantity: 5,
    });
    expect(resubmitRes.status).toBe(200);
    const resubmitBody = (await resubmitRes.json()) as { disposalId: string };
    expect(resubmitBody.disposalId).toBe(disposalId);

    const allRows = await db.select().from(schema.stockDisposals);
    expect(allRows).toHaveLength(1);
    expect(allRows[0].id).toBe(disposalId);
    expect(allRows[0].status).toBe("UNAPPROVED");
    expect(allRows[0].quantity).toBe(5);

    const { pendingLog: newPendingLog, pendingRequest: newPendingRequest } =
      await findPendingLogAndRequest(disposalId);
    expect(newPendingRequest!.id).not.toBe(pendingRequest!.id);

    const approveRes = await callApproveTask({
      logId: newPendingLog!.id,
      requestId: newPendingRequest!.id,
      userId: "approver-1",
    });
    expect(approveRes.status).toBe(200);

    const stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(5);
  }, 15000);

  it("差戻しされると在庫は変化せずstatusがREMANDEDになる", async () => {
    const createRes = await postDisposal("applicant-1", {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      quantity: 4,
    });
    const { disposalId } = (await createRes.json()) as { disposalId: string };

    const { pendingLog, pendingRequest } = await findPendingLogAndRequest(disposalId);
    const remandRes = await callRemandTask({
      logId: pendingLog!.id,
      requestId: pendingRequest!.id,
      userId: "approver-1",
    });
    expect(remandRes.status).toBe(200);

    const record = await db
      .select()
      .from(schema.stockDisposals)
      .where(eq(schema.stockDisposals.id, disposalId));
    expect(record[0].status).toBe("REMANDED");

    const stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(10);
  });

  it("申請者が取り下げるとstatusがCANCELEDになる", async () => {
    const createRes = await postDisposal("applicant-1", {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      quantity: 2,
    });
    const { disposalId } = (await createRes.json()) as { disposalId: string };

    const { pendingLog } = await findPendingLogAndRequest(disposalId);
    const cancelRes = await callCancelTask({
      targetId: disposalId,
      logId: pendingLog!.id,
      userId: "applicant-1",
    });
    expect(cancelRes.status).toBe(200);

    const record = await db
      .select()
      .from(schema.stockDisposals)
      .where(eq(schema.stockDisposals.id, disposalId));
    expect(record[0].status).toBe("CANCELED");
  });
});
