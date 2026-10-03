import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as logSchema from "../../../db/audit-schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";

// メール送信部分(cloudflare:socketsを使った生SMTP実装)は単体テストで実際に接続できないため、
// workflow-tasks-approval.service.tsが依存する境界であるsendWorkflowMailだけをモック化する。
// 本番コード(workflow-tasks-approval.service.ts / engine.ts / mailer.ts / notifier.ts)は無変更。
vi.mock("../../../workflow-engine/notifier", () => ({
  sendWorkflowMail: vi.fn(async () => {}),
}));

import { WorkflowTasksApprovalService } from "./workflow-tasks-approval.service";
import { sendWorkflowMail } from "../../../workflow-engine/notifier";

const mockedSendWorkflowMail = vi.mocked(sendWorkflowMail);

// #14-2⑥: 元々2262行あったworkflow-tasks.service.test.tsから、単一タスクの承認・差戻し・
// 取消(取り下げ)・「修正して再提出」の遷移先パス解決のテストを分割したもの。ソース側の分割
// (workflow-tasks-approval.service.ts)に対応する。ロジック変更なし。ヘルパー関数は既存の慣習
// (payment-crud.test.ts/payment-csv.test.ts、sales-order-crud/workflow.service.test.ts)に
// ならい、分割後の各ファイルにそのまま複製している(共通ファイル化はしない)。
const db = drizzle(env.DB, { schema });
const logDb = drizzle(env.DB_LOG, { schema: logSchema });

// cancelTask等、Honoの`Context`を要求するメソッド用に、実際にHTTPリクエストを流して
// 本物のContextを取得するテスト用アプリ(getCookie等が内部で正しく動くようにするため)。
function buildTestApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.post("/cancel", async (c) => {
    const body = await c.req.json();
    const result = await WorkflowTasksApprovalService.cancelTask(c, db, body);
    return c.json(result);
  });

  app.post("/approve", async (c) => {
    const body = await c.req.json();
    const result = await WorkflowTasksApprovalService.approveTask(c, db, body);
    return c.json(result);
  });

  app.post("/remand", async (c) => {
    const body = await c.req.json();
    const result = await WorkflowTasksApprovalService.remandTask(c, db, body);
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

async function waitForAuditLogs(minCount: number, timeoutMs = 1000) {
  const start = Date.now();
  let logs = await logDb.select().from(logSchema.auditLogs);
  while (logs.length < minCount && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    logs = await logDb.select().from(logSchema.auditLogs);
  }
  return logs;
}

async function callCancelTask(
  params: { targetId: string; logId: string; userId: string },
  actorUserId = "user-1",
) {
  const app = buildTestApp();
  const ctx = createExecutionContext();
  const res = await app.request(
    "/cancel",
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

async function callApproveTask(
  params: {
    logId: string;
    requestId: string;
    userId: string;
    comment?: string | null;
  },
  actorUserId = "user-1",
) {
  const app = buildTestApp();
  const ctx = createExecutionContext();
  const res = await app.request(
    "/approve",
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

async function callRemandTask(
  params: {
    logId: string;
    requestId: string;
    userId: string;
    comment?: string | null;
  },
  actorUserId = "user-1",
) {
  const app = buildTestApp();
  const ctx = createExecutionContext();
  const res = await app.request(
    "/remand",
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
  await logDb.delete(logSchema.auditLogs);
  await env.COMPANY_SETTINGS.delete("config");
  mockedSendWorkflowMail.mockClear();
});

describe("WorkflowTasksApprovalService.cancelTask", () => {
  it("対象ログが存在しない場合はエラーを投げる", async () => {
    const res = await callCancelTask({
      targetId: "partner-1",
      logId: "no-such-log",
      userId: "user-1",
    });

    expect(res.status).toBe(500);
  });

  it("ログをCANCELEDに更新し、対応するPENDINGの親申請もCANCELEDに更新する", async () => {
    await seedUser("applicant-1");
    await seedUser("user-1");
    await seedRole("approver_role");
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
      approverRoleId: "approver_role",
      layer: 1,
      status: "PENDING",
    });

    // BUG-013: 取下げは申請者本人(applicant-1)が行う
    const res = await callCancelTask(
      {
        targetId: "partner-1",
        logId: "log-1",
        userId: "applicant-1",
      },
      "applicant-1",
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);

    const updatedLog = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.id, "log-1"));
    expect(updatedLog[0].status).toBe("CANCELED");
    expect(updatedLog[0].approverId).toBe("applicant-1");

    const updatedRequest = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.id, "req-1"));
    expect(updatedRequest[0].status).toBe("CANCELED");
  });

  // BUG-013: 取り下げる申請が無い場合は、申請者を確かめられないため取り下げない(以前はログだけCANCELEDにしていた)
  it("対応するPENDING/REMANDEDの親申請が存在しない場合は、取り下げずにエラーにする", async () => {
    await seedUser("user-1");
    await seedRole("approver_role");

    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_partners",
      targetId: "partner-orphan",
      approverRoleId: "approver_role",
      layer: 1,
      status: "PENDING",
    });

    const res = await callCancelTask({
      targetId: "partner-orphan",
      logId: "log-1",
      userId: "user-1",
    });

    expect(res.status).toBe(500);
    const updatedLog = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.id, "log-1"));
    expect(updatedLog[0].status).toBe("PENDING");
  });

  it("監査ログにCANCEL_TASKが記録される", async () => {
    await seedUser("applicant-1");
    await seedUser("user-1");
    await seedRole("approver_role");
    await seedPartner("partner-1", "テスト取引先", "applicant-1");

    await db.insert(schema.masterApprovalRequests).values({
      id: "req-1",
      targetType: "master_partners",
      targetId: "partner-1",
      requestType: "REGISTER",
      status: "PENDING",
      applicantId: "user-1",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "approver_role",
      layer: 1,
      status: "PENDING",
    });

    await callCancelTask({
      targetId: "partner-1",
      logId: "log-1",
      userId: "user-1",
    });

    const logs = await waitForAuditLogs(1);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("CANCEL_TASK");
    expect(logs[0].userId).toBe("user-1");
  });
});

describe("WorkflowTasksApprovalService.approveTask", () => {
  it("次の承認ステップが残っている場合、次ステップのPENDINGログを作成し次承認者へ通知メールを送る", async () => {
    await seedUser("applicant-1");
    await seedUser("approver-1"); // 現在の承認者(1段目)
    await seedUser("approver-2", { email: "approver2@example.com" }); // 次の承認者(2段目)
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

    const res = await callApproveTask({
      logId: "log-1",
      requestId: "req-1",
      userId: "approver-1",
      comment: "第1承認OK",
    });

    expect(res.status).toBe(200);

    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "partner-1"));
    expect(logs).toHaveLength(2);
    const approvedLog = logs.find((l) => l.id === "log-1")!;
    expect(approvedLog.status).toBe("APPROVED");
    const nextLog = logs.find((l) => l.id !== "log-1")!;
    expect(nextLog.status).toBe("PENDING");
    expect(nextLog.layer).toBe(2);
    expect(nextLog.approverRoleId).toBe("role2");

    // 親申請自体はまだ最終承認していないのでPENDINGのまま
    const request = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.id, "req-1"));
    expect(request[0].status).toBe("PENDING");

    expect(mockedSendWorkflowMail).toHaveBeenCalledTimes(1);
    const callArgs = mockedSendWorkflowMail.mock.calls[0][0];
    expect(callArgs.category).toBe("workflow_request");
    expect(callArgs.to).toBe("approver2@example.com");
  });

  it("最終承認の場合、申請をAPPROVEDにし、master_partnersならpartnersマスタへ反映し、申請者へ完了通知メールを送る", async () => {
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
      generalMemo: JSON.stringify({
        name: "新・取引先名",
        type: "CUSTOMER",
      }),
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

    const res = await callApproveTask({
      logId: "log-1",
      requestId: "req-1",
      userId: "approver-1",
      comment: "最終承認",
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
    expect(partner[0].status).toBe("active");

    expect(mockedSendWorkflowMail).toHaveBeenCalledTimes(1);
    const callArgs = mockedSendWorkflowMail.mock.calls[0][0];
    expect(callArgs.category).toBe("workflow_result");
    expect(callArgs.to).toBe("applicant1@example.com");
  });

  it("監査ログにAPPROVE_TASKが記録される", async () => {
    await seedUser("applicant-1");
    await seedUser("approver-1");
    await seedRole("role1");
    await seedUserRole("approver-1", "role1", null);
    await seedPartner("partner-1", "テスト取引先", "applicant-1");
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

    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "role1",
      layer: 1,
      status: "PENDING",
    });

    // 監査ログのuserIdはリクエストパラメータではなくlogin_user_idクッキーから決まる(既存の仕様)
    await callApproveTask(
      {
        logId: "log-1",
        requestId: "req-1",
        userId: "approver-1",
      },
      "approver-1",
    );

    const logs = await waitForAuditLogs(1);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("APPROVE_TASK");
    expect(logs[0].userId).toBe("approver-1");
  });

  it("最終承認時、退避データ(masterApprovalContexts)が存在しない場合はstatusをactiveに更新するのみ", async () => {
    await seedUser("applicant-1");
    await seedUser("approver-1");
    await seedRole("role1");
    await seedUserRole("approver-1", "role1", null);
    await seedPartner("partner-1", "テスト取引先", "applicant-1");
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
    // masterApprovalContextsは意図的に挿入しない

    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "role1",
      layer: 1,
      status: "PENDING",
    });

    const res = await callApproveTask({
      logId: "log-1",
      requestId: "req-1",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);

    const partner = await db
      .select()
      .from(schema.partners)
      .where(eq(schema.partners.id, "partner-1"));
    expect(partner[0].status).toBe("active");
    // 名前等は書き換わらず元のまま
    expect(partner[0].name).toBe("テスト取引先");
  });

  it("最終承認時、退避データのgeneralMemoが不正なJSONの場合もエラーにせずstatusをactiveに更新する", async () => {
    await seedUser("applicant-1");
    await seedUser("approver-1");
    await seedRole("role1");
    await seedUserRole("approver-1", "role1", null);
    await seedPartner("partner-1", "テスト取引先", "applicant-1");
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
      generalMemo: "{ 不正なJSON",
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

    const res = await callApproveTask({
      logId: "log-1",
      requestId: "req-1",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);

    const partner = await db
      .select()
      .from(schema.partners)
      .where(eq(schema.partners.id, "partner-1"));
    expect(partner[0].status).toBe("active");
  });

  it("最終承認時、REGISTER申請でattachmentsが含まれる場合はpartnerAttachmentsへ挿入される", async () => {
    await seedUser("applicant-1");
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
      generalMemo: JSON.stringify({
        name: "新・取引先名",
        type: "CUSTOMER",
        attachments: [
          {
            fileName: "契約書.pdf",
            storageType: "R2",
            attachmentR2Path: "partners/contract.pdf",
            fileType: "CONTRACT",
          },
        ],
      }),
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

    const res = await callApproveTask({
      logId: "log-1",
      requestId: "req-1",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);

    const attachments = await db
      .select()
      .from(schema.partnerAttachments)
      .where(eq(schema.partnerAttachments.partnerId, "partner-1"));
    expect(attachments).toHaveLength(1);
    expect(attachments[0].fileName).toBe("契約書.pdf");
    expect(attachments[0].attachmentR2Path).toBe("partners/contract.pdf");
    // Item1: uploadedByIdはusers.id("applicant-1")ではなく、対応するemployeeNumberで記録される
    expect(attachments[0].uploadedById).toBe("EMP-applicant-1");
  });

  it("UPDATE申請でstatusがtemporary/active以外を指定している場合、その値が採用される", async () => {
    await seedUser("applicant-1");
    await seedUser("approver-1");
    await seedRole("role1");
    await seedUserRole("approver-1", "role1", null);
    await seedPartner("partner-1", "取引先", "applicant-1");
    await seedApprovalFlow("flow-1", "master_partners", [
      { order: 1, roleId: "role1" },
    ]);

    await db.insert(schema.masterApprovalRequests).values({
      id: "req-1",
      targetType: "master_partners",
      targetId: "partner-1",
      requestType: "UPDATE",
      status: "PENDING",
      applicantId: "applicant-1",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.masterApprovalContexts).values({
      id: "ctx-1",
      requestId: "req-1",
      generalMemo: JSON.stringify({
        name: "取引先",
        type: "CUSTOMER",
        status: "suspended",
      }),
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

    const res = await callApproveTask({
      logId: "log-1",
      requestId: "req-1",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);

    const partner = await db
      .select()
      .from(schema.partners)
      .where(eq(schema.partners.id, "partner-1"));
    expect(partner[0].status).toBe("suspended");
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

    // 同一requestType・同一金額帯(0〜999999999)に2つの有効フローが存在するケース
    // (matchField/matchValueで分岐する複数フローが同じ金額帯を共有する状況を模す)。
    // flow-2stepsは2段階、flow-1stepは1段階と、意図的にステップ構成を変えている。
    await seedApprovalFlow("flow-2steps", "master_partners", [
      { order: 1, roleId: "role1" },
      { order: 2, roleId: "role2" },
    ]);
    await seedApprovalFlow("flow-1step", "master_partners", [
      { order: 1, roleId: "role3" },
    ]);

    // 申請時点でflow-2stepsにマッチしたことを示すflowIdを明示的に持たせる
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

    const res = await callApproveTask({
      logId: "log-1",
      requestId: "req-1",
      userId: "approver-1",
      comment: "第1承認OK",
    });

    expect(res.status).toBe(200);

    // flow-1step(1段階)が誤って採用されていれば、この承認で即最終承認になってしまう。
    // flow-2steps(2段階、flowIdで明示)が正しく使われていれば、次はrole2のPENDINGログが作られる。
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

describe("WorkflowTasksApprovalService.remandTask", () => {
  it("ログと親申請をREMANDEDに更新し、申請者へ差戻し通知メールを送る", async () => {
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

    const res = await callRemandTask({
      logId: "log-1",
      requestId: "req-1",
      userId: "approver-1",
      comment: "内容不備のため差戻し",
    });

    expect(res.status).toBe(200);

    const log = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.id, "log-1"));
    expect(log[0].status).toBe("REMANDED");
    expect(log[0].comment).toBe("内容不備のため差戻し");

    const request = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.id, "req-1"));
    expect(request[0].status).toBe("REMANDED");

    expect(mockedSendWorkflowMail).toHaveBeenCalledTimes(1);
    const callArgs = mockedSendWorkflowMail.mock.calls[0][0];
    expect(callArgs.category).toBe("workflow_result");
    expect(callArgs.to).toBe("applicant1@example.com");
  });

  it("監査ログにREMAND_TASKが記録される", async () => {
    await seedUser("applicant-1");
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

    await callRemandTask(
      { logId: "log-1", requestId: "req-1", userId: "approver-1" },
      "approver-1",
    );

    const logs = await waitForAuditLogs(1);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("REMAND_TASK");
    expect(logs[0].userId).toBe("approver-1");
  });
});

describe("resolveEditPath: 承認のtargetTypeと画面resourceが異なる伝票", () => {
  it("仕入(purchase_recognitions)は仕入管理画面(/purchase/receipts)へ解決される", async () => {
    expect(await WorkflowTasksApprovalService.resolveEditPath({}, "purchase_recognitions", "PC-1")).toBe("/purchase/receipts");
  });

  it("購買申請・発注・売上は従来どおり解決される", async () => {
    expect(await WorkflowTasksApprovalService.resolveEditPath({}, "purchase_requisitions", "X")).toBe("/purchase/requisitions");
    expect(await WorkflowTasksApprovalService.resolveEditPath({}, "purchase_orders", "X")).toBe("/purchase/orders");
    expect(await WorkflowTasksApprovalService.resolveEditPath({}, "sales_invoices", "X")).toBe("/sales/invoices");
  });
});
