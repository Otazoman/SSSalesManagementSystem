import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";

/**
 * BUG-013: 承認・差戻し・取下げの API が、操作する本人を確かめることのテスト(実際の HTTP ルーター)。
 * - 操作する人は、送られた userId ではなくログイン情報(セッション cookie)から決める
 * - 承認・差戻しは、その段の承認者だけ(管理者は代理で可)
 * - 取下げは、申請者本人だけ(管理者は代理で可)
 */

vi.mock("../../../workflow-engine/notifier", () => ({
  sendWorkflowMail: vi.fn(async () => {}),
  notifyApprovalRequestSubmitted: vi.fn(async () => {}),
}));

import { workflowTasksRouter } from "./index";

const db = drizzle(env.DB, { schema });
const now = new Date();

async function seedUser(id: string, roleId?: string) {
  await db.insert(schema.users).values({
    id,
    employeeNumber: `EMP-${id}`,
    email: `${id}@example.com`,
    name: id,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  if (roleId) {
    await db.insert(schema.userRoles).values({ userId: id, roleId, departmentSurrogateId: null });
  }
}

async function sessionCookie(userId: string): Promise<string> {
  const token = await signSessionToken(
    {
      userId,
      employeeNumber: `EMP-${userId}`,
      name: userId,
      role: "user",
      deptName: "",
      companyName: "テスト会社",
      isAuditEnabled: true,
    },
    await env.SESSION_SECRET.get(),
    3600,
  );
  return `session_token=${token}`;
}

async function post(path: string, body: unknown, actorUserId: string | null) {
  const ctx = createExecutionContext();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (actorUserId) headers.Cookie = await sessionCookie(actorUserId);
  const res = await workflowTasksRouter.request(
    path,
    { method: "POST", headers, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function logStatus(id = "log-1") {
  const [row] = await db.select().from(schema.workflowLogs).where(eq(schema.workflowLogs.id, id));
  return row;
}

async function requestStatus(id = "req-1") {
  const [row] = await db
    .select()
    .from(schema.masterApprovalRequests)
    .where(eq(schema.masterApprovalRequests.id, id));
  return row.status;
}

beforeEach(async () => {
  await db.delete(schema.workflowLogs);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.units);
  await db.delete(schema.userRoles);
  await db.delete(schema.roles);
  await db.delete(schema.users);

  for (const id of ["admin", "approver_role", "other_role"]) {
    await db.insert(schema.roles).values({ id, name: id, createdAt: now });
  }
  await seedUser("applicant-1");
  await seedUser("approver-1", "approver_role");
  await seedUser("stranger-1", "other_role");
  await seedUser("admin-1", "admin");

  await db.insert(schema.approvalFlows).values({
    id: "flow-units",
    name: "flow-units",
    requestType: "master_units",
    minAmount: 0,
    maxAmount: 999999999,
    isActive: true,
  });
  await db.insert(schema.approvalFlowSteps).values({
    id: "flow-units-step-1",
    flowId: "flow-units",
    stepOrder: 1,
    approverRoleId: "approver_role",
  });
  await db.insert(schema.units).values({
    code: "PCS",
    name: "個",
    status: "temporary",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  });
  await db.insert(schema.masterApprovalRequests).values({
    id: "req-1",
    targetType: "master_units",
    targetId: "PCS",
    requestType: "REGISTER",
    status: "PENDING",
    flowId: "flow-units",
    applicantId: "applicant-1",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.workflowLogs).values({
    id: "log-1",
    targetType: "master_units",
    targetId: "PCS",
    approverRoleId: "approver_role",
    layer: 1,
    status: "PENDING",
    requestId: "req-1",
  });
});

const approveBody = (userId: string) => ({ logId: "log-1", requestId: "req-1", userId });

describe("承認・差戻し", () => {
  it("ログインしていなければ 401 を返し、承認しない", async () => {
    const res = await post("/approve", approveBody("approver-1"), null);
    expect(res.status).toBe(401);
    expect((await logStatus()).status).toBe("PENDING");
  });

  it("その段の承認者でなければ 403 を返し、承認・差戻ししない", async () => {
    const approve = await post("/approve", approveBody("stranger-1"), "stranger-1");
    expect(approve.status).toBe(403);
    const remand = await post("/remand", approveBody("stranger-1"), "stranger-1");
    expect(remand.status).toBe(403);
    expect((await logStatus()).status).toBe("PENDING");
    expect(await requestStatus()).toBe("PENDING");
  });

  it("送られた userId が承認者でも、ログインしている本人が承認者でなければ 403(なりすまし不可)", async () => {
    const res = await post("/approve", approveBody("approver-1"), "stranger-1");
    expect(res.status).toBe(403);
    expect((await logStatus()).status).toBe("PENDING");
  });

  it("承認者本人なら承認でき、記録される承認者はログインしている本人", async () => {
    const res = await post("/approve", approveBody("someone-else"), "approver-1");
    expect(res.status).toBe(200);
    const log = await logStatus();
    expect(log.status).toBe("APPROVED");
    expect(log.approverId).toBe("approver-1");
  });

  it("管理者は承認者でなくても代理で承認できる", async () => {
    const res = await post("/approve", approveBody("admin-1"), "admin-1");
    expect(res.status).toBe(200);
    expect((await logStatus()).status).toBe("APPROVED");
  });

  it("処理済みのタスクは 400 を返し、二重に承認しない", async () => {
    await post("/remand", approveBody("approver-1"), "approver-1");
    const res = await post("/approve", approveBody("approver-1"), "approver-1");
    expect(res.status).toBe(400);
    expect((await logStatus()).status).toBe("REMANDED");
  });

  it("一括承認でも、承認者でないタスクは失敗として数え、承認しない", async () => {
    const res = await post(
      "/bulk-approve",
      { logIds: ["log-1"], userId: "approver-1" },
      "stranger-1",
    );
    const body = (await res.json()) as { successCount?: number; success: boolean };
    expect(body.success).toBe(false);
    expect((await logStatus()).status).toBe("PENDING");
  });
});

describe("取下げ", () => {
  const cancelBody = (userId: string) => ({ targetId: "PCS", logId: "log-1", userId });

  it("申請者でなければ 403 を返し、取り下げない", async () => {
    const res = await post("/cancel", cancelBody("applicant-1"), "approver-1");
    expect(res.status).toBe(403);
    expect(await requestStatus()).toBe("PENDING");
  });

  it("申請者本人は取り下げられる", async () => {
    const res = await post("/cancel", cancelBody("applicant-1"), "applicant-1");
    expect(res.status).toBe(200);
    expect(await requestStatus()).toBe("CANCELED");
  });

  it("管理者は代理で取り下げられる", async () => {
    const res = await post("/cancel", cancelBody("admin-1"), "admin-1");
    expect(res.status).toBe(200);
    expect(await requestStatus()).toBe("CANCELED");
  });
});

describe("承認タスク一覧(my-pending)", () => {
  it("送られた userId ではなく、ログインしている本人のタスクを返す", async () => {
    const asStranger = await workflowTasksRouter.request(
      "/my-pending?userId=approver-1",
      { headers: { Cookie: await sessionCookie("stranger-1") } },
      env,
    );
    expect(asStranger.status).toBe(200);
    expect(await asStranger.json()).toHaveLength(0);

    const asApprover = await workflowTasksRouter.request(
      "/my-pending?userId=stranger-1",
      { headers: { Cookie: await sessionCookie("approver-1") } },
      env,
    );
    expect(await asApprover.json()).toHaveLength(1);
  });

  it("ログインしていなければ 401", async () => {
    const res = await workflowTasksRouter.request("/my-pending?userId=approver-1", {}, env);
    expect(res.status).toBe(401);
  });
});
