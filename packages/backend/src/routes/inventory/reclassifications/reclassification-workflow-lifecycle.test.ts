import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";
import { seedFixtures } from "../../../../test/support/fixtures";
import { stockReclassificationsRouter } from "./index";

/**
 * Item6 Phase6-3-2: 承認機能ON時の品質区分変更ライフサイクル(申請→承認/差戻し→取消)。
 * targetTypeは入出庫と同じ"inventory_stock"を共有するため、承認フロー(requestType="inventory_stock")も
 * 共有前提でテストする。ON/OFFの判定だけは独立フラグ(is_damage_approval_enabled)を使う。
 */

vi.mock("../../../workflow-engine/notifier", () => ({
  sendWorkflowMail: vi.fn(async () => {}),
  notifyApprovalRequestSubmitted: vi.fn(async () => {}),
}));

const db = drizzle(env.DB, { schema });

function buildWorkflowTestApp() {
  const app = new Hono<{ Bindings: Env }>();
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

async function postReclassification(actorUserId: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockReclassificationsRouter.request(
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

async function putReclassification(actorUserId: string, id: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockReclassificationsRouter.request(
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

const now = new Date();

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

beforeEach(async () => {
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.stockReclassifications);
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
    JSON.stringify({ is_damage_approval_enabled: true }),
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

describe("承認機能ON時の品質区分変更ライフサイクル", () => {
  it("申請→最終承認で、在庫が良品バケットから破損品バケットへ付け替わる", async () => {
    const createRes = await postReclassification("applicant-1", {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      fromQualityStatus: "NORMAL",
      toQualityStatus: "DAMAGED",
      quantity: 4,
    });
    expect(createRes.status).toBe(200);
    const { reclassificationId } = (await createRes.json()) as { reclassificationId: string };

    let record = await db
      .select()
      .from(schema.stockReclassifications)
      .where(eq(schema.stockReclassifications.id, reclassificationId));
    expect(record[0].status).toBe("UNAPPROVED");

    // 承認前は在庫が変化しないこと
    let stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(10);

    const { pendingLog, pendingRequest } = await findPendingLogAndRequest(reclassificationId);
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
      .from(schema.stockReclassifications)
      .where(eq(schema.stockReclassifications.id, reclassificationId));
    expect(record[0].status).toBe("APPROVED");

    stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(6);

    const damagedStock = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.qualityStatus, "DAMAGED"));
    expect(damagedStock[0].quantity).toBe(4);
  });

  it("差戻し後に修正して再申請すると、同じidのまま1件のみ存在し、新しい数量で最終承認できる", async () => {
    const createRes = await postReclassification("applicant-1", {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      fromQualityStatus: "NORMAL",
      toQualityStatus: "DAMAGED",
      quantity: 3,
    });
    expect(createRes.status).toBe(200);
    const { reclassificationId } = (await createRes.json()) as { reclassificationId: string };

    const { pendingLog, pendingRequest } = await findPendingLogAndRequest(reclassificationId);
    const remandRes = await callRemandTask({
      logId: pendingLog!.id,
      requestId: pendingRequest!.id,
      userId: "approver-1",
    });
    expect(remandRes.status).toBe(200);

    // 修正して再提出(同じidへPUT、数量を3→5に変更)
    const resubmitRes = await putReclassification("applicant-1", reclassificationId, {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      fromQualityStatus: "NORMAL",
      toQualityStatus: "DAMAGED",
      quantity: 5,
    });
    expect(resubmitRes.status).toBe(200);
    const resubmitBody = (await resubmitRes.json()) as { reclassificationId: string };
    expect(resubmitBody.reclassificationId).toBe(reclassificationId);

    // 新しいstock_reclassifications行が増えていないこと(入出庫/棚卸と同種の回帰確認)
    const allRows = await db.select().from(schema.stockReclassifications);
    expect(allRows).toHaveLength(1);
    expect(allRows[0].id).toBe(reclassificationId);
    expect(allRows[0].status).toBe("UNAPPROVED");
    expect(allRows[0].quantity).toBe(5);

    const { pendingLog: newPendingLog, pendingRequest: newPendingRequest } =
      await findPendingLogAndRequest(reclassificationId);
    expect(newPendingRequest!.id).not.toBe(pendingRequest!.id);

    const approveRes = await callApproveTask({
      logId: newPendingLog!.id,
      requestId: newPendingRequest!.id,
      userId: "approver-1",
    });
    expect(approveRes.status).toBe(200);

    const stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(5);

    const damagedStock = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.qualityStatus, "DAMAGED"));
    expect(damagedStock[0].quantity).toBe(5);
  }, 15000);

  it("差戻しされると在庫は変化せずstatusがREMANDEDになる", async () => {
    const createRes = await postReclassification("applicant-1", {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      fromQualityStatus: "NORMAL",
      toQualityStatus: "DAMAGED",
      quantity: 4,
    });
    const { reclassificationId } = (await createRes.json()) as { reclassificationId: string };

    const { pendingLog, pendingRequest } = await findPendingLogAndRequest(reclassificationId);
    const remandRes = await callRemandTask({
      logId: pendingLog!.id,
      requestId: pendingRequest!.id,
      userId: "approver-1",
    });
    expect(remandRes.status).toBe(200);

    const record = await db
      .select()
      .from(schema.stockReclassifications)
      .where(eq(schema.stockReclassifications.id, reclassificationId));
    expect(record[0].status).toBe("REMANDED");

    const stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(10);
  });

  it("申請者が取り下げるとstatusがCANCELEDになる", async () => {
    const createRes = await postReclassification("applicant-1", {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      fromQualityStatus: "NORMAL",
      toQualityStatus: "DAMAGED",
      quantity: 2,
    });
    const { reclassificationId } = (await createRes.json()) as { reclassificationId: string };

    const { pendingLog } = await findPendingLogAndRequest(reclassificationId);
    const cancelRes = await callCancelTask({
      targetId: reclassificationId,
      logId: pendingLog!.id,
      userId: "applicant-1",
    });
    expect(cancelRes.status).toBe(200);

    const record = await db
      .select()
      .from(schema.stockReclassifications)
      .where(eq(schema.stockReclassifications.id, reclassificationId));
    expect(record[0].status).toBe("CANCELED");
  });
});
