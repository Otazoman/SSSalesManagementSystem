import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";
import { seedFixtures } from "../../../../test/support/fixtures";
import { stockReceiptsRouter } from "./index";

/**
 * ユーザー報告バグの再現・回帰テスト:「修正して再提出しても複数の入庫レコードができる」
 * 「取下げしたデータが取下げに書き換わらない」。
 * receipts.index.test.tsは承認機能OFF(即時反映)のパスしか検証していなかったため、
 * 承認機能ON時の実際のライフサイクル(申請→差戻し/取下げ→修正して再提出→承認)を
 * quote.service.test.tsと同じ「実D1 + WorkflowTasksServiceを直接呼ぶテスト用Honoアプリ」
 * 方式でHTTP経由のまま検証する。
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

async function postReceipt(actorUserId: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockReceiptsRouter.request(
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

async function putReceipt(actorUserId: string, id: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockReceiptsRouter.request(
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

  return { pendingLog, pendingRequest, allLogs: logs, allRequests: requests };
}

beforeEach(async () => {
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.itemReceiptItems);
  await db.delete(schema.itemReceiptHeaders);
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
    JSON.stringify({ is_receiving_approval_enabled: true }),
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

describe("承認機能ON時の入庫ライフサイクル(申請→差戻し→修正して再申請→承認)", () => {
  it("差戻し後に修正して再申請すると、同じheaderIdのまま1件のみ存在し、新しい内容で最終承認できる", async () => {
    // create→remand→resubmit→approveと複数のHTTPラウンドトリップを伴うため、
    // フルスイート並列実行時のリソース競合を考慮しデフォルトの5000msより長く設定する
    const createRes = await postReceipt("applicant-1", {
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 3 }],
    });
    expect(createRes.status).toBe(200);
    const { headerId } = (await createRes.json()) as { headerId: string };

    let headerRows = await db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(eq(schema.itemReceiptHeaders.id, headerId));
    expect(headerRows).toHaveLength(1);
    expect(headerRows[0].status).toBe("UNAPPROVED");

    const { pendingLog, pendingRequest } = await findPendingLogAndRequest(headerId);
    expect(pendingLog).toBeTruthy();
    expect(pendingRequest).toBeTruthy();

    const remandRes = await callRemandTask({
      logId: pendingLog!.id,
      requestId: pendingRequest!.id,
      userId: "approver-1",
    });
    expect(remandRes.status).toBe(200);

    headerRows = await db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(eq(schema.itemReceiptHeaders.id, headerId));
    expect(headerRows).toHaveLength(1);
    expect(headerRows[0].status).toBe("REMANDED");

    // 修正して再提出(同じheaderIdへPUT、数量を3→9に変更)
    const resubmitRes = await putReceipt("applicant-1", headerId, {
      receivedDate: "2026-08-21",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 9 }],
    });
    expect(resubmitRes.status).toBe(200);
    const resubmitBody = (await resubmitRes.json()) as { headerId: string };
    expect(resubmitBody.headerId).toBe(headerId);

    // 新しいitem_receipt_headers行が増えていないこと(重複作成バグの回帰確認)
    const allHeaderRowsAfterResubmit = await db.select().from(schema.itemReceiptHeaders);
    expect(allHeaderRowsAfterResubmit).toHaveLength(1);
    expect(allHeaderRowsAfterResubmit[0].id).toBe(headerId);
    expect(allHeaderRowsAfterResubmit[0].status).toBe("UNAPPROVED");

    const itemRows = await db
      .select()
      .from(schema.itemReceiptItems)
      .where(eq(schema.itemReceiptItems.receiptHeaderId, headerId));
    expect(itemRows).toHaveLength(1);
    expect(itemRows[0].receivedQuantity).toBe(9);

    // 旧申請(差戻し済み)はSUPERSEDEDになり、新しいPENDING申請が1件だけ存在すること
    const { pendingLog: newPendingLog, pendingRequest: newPendingRequest, allRequests } =
      await findPendingLogAndRequest(headerId);
    expect(newPendingLog).toBeTruthy();
    expect(newPendingRequest).toBeTruthy();
    expect(newPendingRequest!.id).not.toBe(pendingRequest!.id);
    const supersededCount = allRequests.filter((r: any) => r.status === "SUPERSEDED").length;
    expect(supersededCount).toBe(1);

    // 新しい申請を最終承認すると、修正後の数量(9)がstocksへ反映されること
    const approveRes = await callApproveTask({
      logId: newPendingLog!.id,
      requestId: newPendingRequest!.id,
      userId: "approver-1",
    });
    expect(approveRes.status).toBe(200);

    const finalHeader = await db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(eq(schema.itemReceiptHeaders.id, headerId));
    expect(finalHeader[0].status).toBe("APPROVED");

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows).toHaveLength(1);
    expect(stockRows[0].quantity).toBe(9);
  }, 15000);

  it("申請者が取り下げると、入庫ヘッダーのstatusはREMANDEDではなくCANCELEDになる", async () => {
    const createRes = await postReceipt("applicant-1", {
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 5 }],
    });
    expect(createRes.status).toBe(200);
    const { headerId } = (await createRes.json()) as { headerId: string };

    const { pendingLog, pendingRequest } = await findPendingLogAndRequest(headerId);
    expect(pendingLog).toBeTruthy();
    expect(pendingRequest).toBeTruthy();

    const cancelRes = await callCancelTask({
      targetId: headerId,
      logId: pendingLog!.id,
      userId: "applicant-1",
    });
    expect(cancelRes.status).toBe(200);

    const headerRows = await db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(eq(schema.itemReceiptHeaders.id, headerId));
    expect(headerRows).toHaveLength(1);
    expect(headerRows[0].status).toBe("CANCELED");

    const requestRows = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.targetId, headerId));
    expect(requestRows[0].status).toBe("CANCELED");
  });

  it("承認履歴画面(/workflow/histories)で、差戻し済みの古いログには古い(SUPERSEDEDな)申請情報が、再申請後の新しいログには新しい申請情報が、それぞれ正しく紐付く", async () => {
    const { WorkflowTasksService } = await import(
      "../../workflow/workflow-tasks/workflow-tasks.service"
    );

    const createRes = await postReceipt("applicant-1", {
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 3 }],
    });
    const { headerId } = (await createRes.json()) as { headerId: string };

    const { pendingLog, pendingRequest } = await findPendingLogAndRequest(headerId);
    await callRemandTask({
      logId: pendingLog!.id,
      requestId: pendingRequest!.id,
      userId: "approver-1",
    });

    await putReceipt("applicant-1", headerId, {
      receivedDate: "2026-08-21",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 9 }],
    });

    const { pendingRequest: newPendingRequest } = await findPendingLogAndRequest(headerId);
    expect(newPendingRequest!.id).not.toBe(pendingRequest!.id);

    const { histories } = await WorkflowTasksService.getHistory(db, {
      userId: "applicant-1",
    } as any);
    const rowsForThisReceipt = histories.filter((h: any) => h.targetId === headerId);

    // 差戻し済みログ1件+再提出後のPENDINGログ1件、あわせて2件のログ行が履歴として残ること自体は
    // 正常な監査証跡(何が起きたかの記録)であり、問題ではない。問題だったのは、両方のログ行が
    // 同じ「最新の申請」情報を指してしまい、古いログがあたかも新しい申請と同じ内容であるかのように
    // 見えてしまう点だった(ユーザー報告「複数の申請が残ってしまう」の実体)。
    expect(rowsForThisReceipt).toHaveLength(2);

    const remandedRow = rowsForThisReceipt.find((h: any) => h.status === "REMANDED");
    const pendingRow = rowsForThisReceipt.find((h: any) => h.status === "PENDING");
    expect(remandedRow).toBeTruthy();
    expect(pendingRow).toBeTruthy();

    // 差戻し済みログは、古い(今はSUPERSEDEDになった)申請に紐付いたままであるべき
    expect(remandedRow!.requestId).toBe(pendingRequest!.id);
    expect(remandedRow!.parentStatus).toBe("SUPERSEDED");

    // 再提出後のPENDINGログは、新しい申請に紐付いているべき
    expect(pendingRow!.requestId).toBe(newPendingRequest!.id);
    expect(pendingRow!.parentStatus).toBe("PENDING");
  });
});
