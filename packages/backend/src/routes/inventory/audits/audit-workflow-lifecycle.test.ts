import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";
import { seedFixtures } from "../../../../test/support/fixtures";
import { stockAuditsRouter } from "./index";

/**
 * Item6 Phase6-3: 承認機能ON時の棚卸ライフサイクル(申請→差戻し→修正して再提出→承認)。
 * receipt-workflow-lifecycle.test.tsと同型(targetType="inventory_audit"、
 * KVフラグはis_inventory_approval_enabled)。棚卸はヘッダー+明細ではなく単一行のレコードのため、
 * itemsテーブルへのjoinは不要。
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

async function postAudit(actorUserId: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockAuditsRouter.request(
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

async function putAudit(actorUserId: string, id: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockAuditsRouter.request(
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

  return { pendingLog, pendingRequest, allRequests: requests };
}

beforeEach(async () => {
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.stockAudits);
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
    JSON.stringify({ is_inventory_approval_enabled: true }),
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
});

describe("承認機能ON時の棚卸ライフサイクル(申請→差戻し→修正して再申請→承認)", () => {
  it("差戻し後に修正して再申請すると、同じidのまま1件のみ存在し、新しい内容で最終承認できる", async () => {
    const createRes = await postAudit("applicant-1", {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      countedQuantity: 3,
    });
    expect(createRes.status).toBe(200);
    const { auditId } = (await createRes.json()) as { auditId: string };

    let auditRows = await db
      .select()
      .from(schema.stockAudits)
      .where(eq(schema.stockAudits.id, auditId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].status).toBe("UNAPPROVED");
    expect(auditRows[0].differenceQuantity).toBe(3);

    const { pendingLog, pendingRequest } = await findPendingLogAndRequest(auditId);
    expect(pendingLog).toBeTruthy();
    expect(pendingRequest).toBeTruthy();

    const remandRes = await callRemandTask({
      logId: pendingLog!.id,
      requestId: pendingRequest!.id,
      userId: "approver-1",
    });
    expect(remandRes.status).toBe(200);

    auditRows = await db
      .select()
      .from(schema.stockAudits)
      .where(eq(schema.stockAudits.id, auditId));
    expect(auditRows[0].status).toBe("REMANDED");

    // 修正して再提出(同じidへPUT、実棚数量を3→9に変更)
    const resubmitRes = await putAudit("applicant-1", auditId, {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      countedQuantity: 9,
    });
    expect(resubmitRes.status).toBe(200);
    const resubmitBody = (await resubmitRes.json()) as { auditId: string };
    expect(resubmitBody.auditId).toBe(auditId);

    // 新しいstock_audits行が増えていないこと(入出庫の重複作成バグと同種の回帰確認)
    const allAuditRowsAfterResubmit = await db.select().from(schema.stockAudits);
    expect(allAuditRowsAfterResubmit).toHaveLength(1);
    expect(allAuditRowsAfterResubmit[0].id).toBe(auditId);
    expect(allAuditRowsAfterResubmit[0].status).toBe("UNAPPROVED");
    expect(allAuditRowsAfterResubmit[0].countedQuantity).toBe(9);
    expect(allAuditRowsAfterResubmit[0].differenceQuantity).toBe(9);

    // 旧申請(差戻し済み)はSUPERSEDEDになり、新しいPENDING申請が1件だけ存在すること
    const { pendingLog: newPendingLog, pendingRequest: newPendingRequest, allRequests } =
      await findPendingLogAndRequest(auditId);
    expect(newPendingLog).toBeTruthy();
    expect(newPendingRequest).toBeTruthy();
    expect(newPendingRequest!.id).not.toBe(pendingRequest!.id);
    const supersededCount = allRequests.filter((r: any) => r.status === "SUPERSEDED").length;
    expect(supersededCount).toBe(1);

    // 新しい申請を最終承認すると、修正後の実棚数量(9)がstocksへ反映されること
    const approveRes = await callApproveTask({
      logId: newPendingLog!.id,
      requestId: newPendingRequest!.id,
      userId: "approver-1",
    });
    expect(approveRes.status).toBe(200);

    const finalAudit = await db
      .select()
      .from(schema.stockAudits)
      .where(eq(schema.stockAudits.id, auditId));
    expect(finalAudit[0].status).toBe("APPROVED");

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows).toHaveLength(1);
    expect(stockRows[0].quantity).toBe(9);
  }, 15000);

  it("申請者が取り下げると、棚卸のstatusはREMANDEDではなくCANCELEDになる", async () => {
    const createRes = await postAudit("applicant-1", {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      countedQuantity: 5,
    });
    expect(createRes.status).toBe(200);
    const { auditId } = (await createRes.json()) as { auditId: string };

    const { pendingLog, pendingRequest } = await findPendingLogAndRequest(auditId);
    expect(pendingLog).toBeTruthy();
    expect(pendingRequest).toBeTruthy();

    const cancelRes = await callCancelTask({
      targetId: auditId,
      logId: pendingLog!.id,
      userId: "applicant-1",
    });
    expect(cancelRes.status).toBe(200);

    const auditRows = await db
      .select()
      .from(schema.stockAudits)
      .where(eq(schema.stockAudits.id, auditId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].status).toBe("CANCELED");

    const requestRows = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.targetId, auditId));
    expect(requestRows[0].status).toBe("CANCELED");

    // 取下げなので在庫には反映されないこと
    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows).toHaveLength(0);
  });
});
