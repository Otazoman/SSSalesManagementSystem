import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";

/**
 * workflow-tasksルート(実際のHTTPルーター)の統合テスト。
 * #14-2⑥: 元々1139行あったindex.test.tsから、GET /historyの部分を分割したもの。
 * ロジック変更なし。
 */

import { workflowTasksRouter } from "./index";

const db = drizzle(env.DB, { schema });
const now = new Date();

// BUG-013: 履歴は、送られた userId ではなくログイン情報(セッションcookie)の本人で取得する
async function sessionCookie(userId: string): Promise<string> {
  const token = await signSessionToken(
    {
      userId,
      employeeNumber: userId,
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

async function seedUser(id: string) {
  await db.insert(schema.users).values({
    id,
    employeeNumber: `EMP-${id}`,
    email: `${id}@example.com`,
    name: id,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedRole(id: string) {
  await db.insert(schema.roles).values({ id, name: id, createdAt: now });
}

async function seedMasterApprovalRequest(params: {
  id: string;
  targetType: string;
  targetId: string;
  requestType: string;
  applicantId: string;
  generalMemo?: string;
}) {
  await db.insert(schema.masterApprovalRequests).values({
    id: params.id,
    targetType: params.targetType,
    targetId: params.targetId,
    requestType: params.requestType,
    status: "PENDING",
    applicantId: params.applicantId,
    createdAt: now,
    updatedAt: now,
  });
  if (params.generalMemo) {
    await db.insert(schema.masterApprovalContexts).values({
      id: `ctx-${params.id}`,
      requestId: params.id,
      generalMemo: params.generalMemo,
      createdBy: params.applicantId,
      createdAt: now,
      updatedBy: params.applicantId,
      updatedAt: now,
    });
  }
}

beforeEach(async () => {
  await db.delete(schema.masterApprovalContexts);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.workflowLogs);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.itemPrices);
  await db.delete(schema.items);
  await db.delete(schema.units);
  await db.delete(schema.locations);
  await db.delete(schema.partnerContacts);
  await db.delete(schema.partners);
  await db.delete(schema.warehouses);
  await db.delete(schema.accounts);
  await db.delete(schema.userRoles);
  await db.delete(schema.roles);
  await db.delete(schema.users);

});

describe("GET /history", () => {
  it("必須パラメータ(userId)が無い場合は400を返す", async () => {
    const res = await workflowTasksRouter.request("/history", {}, env);
    expect(res.status).toBe(400);
  });

  it("管理者ユーザーは全マスタ種別(units含む)のログを横断して取得できる", async () => {
    await seedUser("applicant-1");
    await seedUser("admin-1");
    await seedRole("admin");
    await seedRole("approver_role");
    await db.insert(schema.userRoles).values({
      userId: "admin-1",
      roleId: "admin",
      departmentSurrogateId: null,
    });
    await db.insert(schema.units).values({
      code: "PCS",
      name: "個",
      status: "active",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-5",
      targetType: "master_units",
      targetId: "PCS",
      requestType: "REGISTER",
      applicantId: "applicant-1",
    });
    await db.insert(schema.workflowLogs).values({
      id: "log-5",
      targetType: "master_units",
      targetId: "PCS",
      approverRoleId: "approver_role",
      layer: 1,
      status: "APPROVED",
      approverId: "admin-1",
      performedAt: now,
    });

    const res = await workflowTasksRouter.request(
      "/history?userId=admin-1",
      { headers: { Cookie: await sessionCookie("admin-1") } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      histories: Array<{ targetType: string; targetId: string }>;
      isAdmin: boolean;
    };
    expect(body.isAdmin).toBe(true);
    expect(
      body.histories.some(
        (h) => h.targetType === "master_units" && h.targetId === "PCS",
      ),
    ).toBe(true);
  });

  it("ログインしていない場合は401を返す", async () => {
    const res = await workflowTasksRouter.request("/history?userId=admin-1", {}, env);
    expect(res.status).toBe(401);
  });

  it("送られた userId ではなく、ログインしている本人の履歴を返す(他人の userId を送っても管理者扱いにならない)", async () => {
    await seedUser("admin-1");
    await seedUser("user-1");
    await seedRole("admin");
    await db.insert(schema.userRoles).values({
      userId: "admin-1",
      roleId: "admin",
      departmentSurrogateId: null,
    });

    const res = await workflowTasksRouter.request(
      "/history?userId=admin-1",
      { headers: { Cookie: await sessionCookie("user-1") } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isAdmin: boolean };
    expect(body.isAdmin).toBe(false);
  });
});
