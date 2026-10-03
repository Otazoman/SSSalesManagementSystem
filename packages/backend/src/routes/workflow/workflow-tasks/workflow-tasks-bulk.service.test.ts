import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";

// メール送信部分(cloudflare:socketsを使った生SMTP実装)は単体テストで実際に接続できないため、
// workflow-tasks-bulk.service.tsが依存する境界であるsendWorkflowMailだけをモック化する。
// 本番コード(workflow-tasks-bulk.service.ts / engine.ts / mailer.ts / notifier.ts)は無変更。
vi.mock("../../../workflow-engine/notifier", () => ({
  sendWorkflowMail: vi.fn(async () => {}),
}));

import { WorkflowTasksBulkService } from "./workflow-tasks-bulk.service";
import { sendWorkflowMail } from "../../../workflow-engine/notifier";

const mockedSendWorkflowMail = vi.mocked(sendWorkflowMail);

// #14-2⑥: 元々2262行あったworkflow-tasks.service.test.tsから、一括承認・一括差戻し
// (bulkApprove/bulkRemand)のテストを分割したもの。ソース側の分割
// (workflow-tasks-bulk.service.ts)に対応する。ロジック変更なし。ヘルパー関数は既存の慣習
// (payment-crud.test.ts/payment-csv.test.ts、sales-order-crud/workflow.service.test.ts)に
// ならい、分割後の各ファイルにそのまま複製している(共通ファイル化はしない)。
const db = drizzle(env.DB, { schema });

function buildTestApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.post("/bulk-approve", async (c) => {
    const body = await c.req.json();
    const result = await WorkflowTasksBulkService.bulkApprove(c, db, body);
    return c.json(result);
  });

  app.post("/bulk-remand", async (c) => {
    const body = await c.req.json();
    const result = await WorkflowTasksBulkService.bulkRemand(c, db, body);
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

async function callBulkApprove(
  params: { logIds: string[]; userId: string; comment?: string | null },
  actorUserId = "user-1",
) {
  const app = buildTestApp();
  const ctx = createExecutionContext();
  const res = await app.request(
    "/bulk-approve",
    {
      method: "POST",
      headers: {
        Cookie: await buildSessionCookieHeader(actorUserId),
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

async function callBulkRemand(
  params: { logIds: string[]; userId: string; comment?: string | null },
  actorUserId = "user-1",
) {
  const app = buildTestApp();
  const ctx = createExecutionContext();
  const res = await app.request(
    "/bulk-remand",
    {
      method: "POST",
      headers: {
        Cookie: await buildSessionCookieHeader(actorUserId),
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
    employeeNumber: `EMP-${id}`,
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
  await db
    .insert(schema.userRoles)
    .values({ userId, roleId, departmentSurrogateId });
}

async function seedPartner(id: string, name: string, createdBy: string) {
  await db.insert(schema.partners).values({
    id,
    name,
    createdBy,
    createdAt: now,
    updatedBy: createdBy,
    updatedAt: now,
  });
}

async function seedApprovalFlow(
  id: string,
  requestType: string,
  steps: Array<{ order: number; roleId: string }>,
) {
  await db.insert(schema.approvalFlows).values({
    id,
    name: id,
    requestType,
    minAmount: 0,
    maxAmount: 999999999,
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

beforeEach(async () => {
  // 各テストの前にテーブルを空にする(D1はテストごとに自動ロールバックされないため明示的にクリア)
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
  mockedSendWorkflowMail.mockClear();
});

describe("WorkflowTasksBulkService.bulkApprove", () => {
  it("PENDING状態のログのみ処理し、そうでないログは失敗としてカウントする", async () => {
    await seedUser("approver-1");
    await seedRole("role1");
    await seedUserRole("approver-1", "role1", null);

    await db.insert(schema.workflowLogs).values({
      id: "log-already-approved",
      targetType: "master_partners",
      targetId: "partner-x",
      approverRoleId: "role1",
      layer: 1,
      status: "APPROVED",
      approverId: "approver-1",
      performedAt: now,
    });

    const res = await callBulkApprove({
      logIds: ["log-already-approved", "log-not-found"],
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(false);
    expect(body.message).toContain("失敗: 2件");
  });

  it("次ステップが残っているログを一括承認すると、次ステップのPENDINGログが作成され通知メールが送られる", async () => {
    await seedUser("applicant-1");
    await seedUser("approver-1");
    await seedUser("approver-2", { email: "approver2@example.com" });
    await seedRole("role1");
    await seedRole("role2");
    await seedUserRole("approver-1", "role1", null);
    await seedUserRole("approver-2", "role2", null);
    await seedPartner("partner-1", "テスト取引先", "applicant-1");
    await seedApprovalFlow("flow-1", "master_partners", [
      { order: 1, roleId: "role1" },
      { order: 2, roleId: "role2" },
    ]);

    await db.insert(schema.masterApprovalRequests).values({
      id: "req-1",
      targetType: "master_partners",
      targetId: "partner-1",
      requestType: "REGISTER",
      status: "PENDING",
      applicantId: "applicant-1",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "role1",
      layer: 1,
      status: "PENDING",
    });

    const res = await callBulkApprove({
      logIds: ["log-1"],
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain("1 件を承認しました");

    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "partner-1"));
    expect(logs).toHaveLength(2);
    expect(logs.some((l) => l.status === "PENDING" && l.layer === 2)).toBe(
      true,
    );

    expect(mockedSendWorkflowMail).toHaveBeenCalledTimes(1);
    expect(mockedSendWorkflowMail.mock.calls[0][0].category).toBe(
      "workflow_request",
    );
  });

  it("最終ステップのログを一括承認すると、申請がAPPROVEDになりpartnersマスタへ反映される", async () => {
    await seedUser("applicant-1", { email: "applicant1@example.com" });
    await seedUser("approver-1");
    await seedRole("role1");
    await seedUserRole("approver-1", "role1", null);
    await seedPartner("partner-1", "旧・取引先名", "applicant-1");
    await seedApprovalFlow("flow-1", "master_partners", [
      { order: 1, roleId: "role1" },
    ]);

    await db.insert(schema.masterApprovalRequests).values({
      id: "req-1",
      targetType: "master_partners",
      targetId: "partner-1",
      requestType: "REGISTER",
      status: "PENDING",
      applicantId: "applicant-1",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.masterApprovalContexts).values({
      id: "ctx-1",
      requestId: "req-1",
      generalMemo: JSON.stringify({ name: "新・取引先名", type: "CUSTOMER" }),
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });

    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "role1",
      layer: 1,
      status: "PENDING",
    });

    const res = await callBulkApprove({
      logIds: ["log-1"],
      userId: "approver-1",
    });

    expect(res.status).toBe(200);

    const request = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.id, "req-1"));
    expect(request[0].status).toBe("APPROVED");

    const partner = await db
      .select()
      .from(schema.partners)
      .where(eq(schema.partners.id, "partner-1"));
    expect(partner[0].name).toBe("新・取引先名");

    expect(mockedSendWorkflowMail).toHaveBeenCalledTimes(1);
    expect(mockedSendWorkflowMail.mock.calls[0][0].category).toBe(
      "workflow_result",
    );
  });

  it("Item9 Phase2: 同一targetType・同一金額帯に複数の有効フローがあっても、申請のflowIdで確定したフロー(のステップ構成)で進行する", async () => {
    await seedUser("applicant-1");
    await seedUser("approver-1");
    await seedUser("approver-2", { email: "approver2@example.com" });
    await seedRole("role1");
    await seedRole("role2");
    await seedRole("role3");
    await seedUserRole("approver-1", "role1", null);
    await seedUserRole("approver-2", "role2", null);
    await seedPartner("partner-1", "テスト取引先", "applicant-1");

    await seedApprovalFlow("flow-2steps", "master_partners", [
      { order: 1, roleId: "role1" },
      { order: 2, roleId: "role2" },
    ]);
    await seedApprovalFlow("flow-1step", "master_partners", [
      { order: 1, roleId: "role3" },
    ]);

    await db.insert(schema.masterApprovalRequests).values({
      id: "req-1",
      targetType: "master_partners",
      targetId: "partner-1",
      requestType: "REGISTER",
      status: "PENDING",
      flowId: "flow-2steps",
      applicantId: "applicant-1",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "role1",
      layer: 1,
      status: "PENDING",
    });

    const res = await callBulkApprove({
      logIds: ["log-1"],
      userId: "approver-1",
    });

    expect(res.status).toBe(200);

    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "partner-1"));
    expect(logs).toHaveLength(2);
    const nextLog = logs.find((l) => l.id !== "log-1")!;
    expect(nextLog.status).toBe("PENDING");
    expect(nextLog.layer).toBe(2);
    expect(nextLog.approverRoleId).toBe("role2");

    const request = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.id, "req-1"));
    expect(request[0].status).toBe("PENDING");
  });
});

describe("WorkflowTasksBulkService.bulkRemand", () => {
  it("PENDING状態のログのみ処理し、そうでないログは失敗としてカウントする", async () => {
    const res = await callBulkRemand({
      logIds: ["log-not-found"],
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(false);
    expect(body.message).toContain("失敗: 1件");
  });

  it("PENDINGログを一括差戻しし、親申請をREMANDEDに更新して申請者へ通知する", async () => {
    await seedUser("applicant-1", { email: "applicant1@example.com" });
    await seedUser("approver-1");
    await seedRole("role1");
    await seedUserRole("approver-1", "role1", null);
    await seedPartner("partner-1", "テスト取引先", "applicant-1");

    await db.insert(schema.masterApprovalRequests).values({
      id: "req-1",
      targetType: "master_partners",
      targetId: "partner-1",
      requestType: "REGISTER",
      status: "PENDING",
      applicantId: "applicant-1",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "role1",
      layer: 1,
      status: "PENDING",
    });

    const res = await callBulkRemand({
      logIds: ["log-1"],
      userId: "approver-1",
      comment: "まとめて差戻し",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain("1 件を差戻しました");

    const log = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.id, "log-1"));
    expect(log[0].status).toBe("REMANDED");

    const request = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.id, "req-1"));
    expect(request[0].status).toBe("REMANDED");

    expect(mockedSendWorkflowMail).toHaveBeenCalledTimes(1);
    expect(mockedSendWorkflowMail.mock.calls[0][0].category).toBe(
      "workflow_result",
    );
  });
});
