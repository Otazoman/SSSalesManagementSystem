import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";
import { purchaseRequisitionsRouter } from "./index";
import { approvalsRouter } from "../../workflow/approvals";
import { WorkflowTasksService } from "../../workflow/workflow-tasks/workflow-tasks.service";

/**
 * Item9 Phase3(購買申請の基本形)。quote.service.test.tsと同じ「実D1 + 実Hono Context」方式を踏襲し、
 * purchase-requisition-crud.service.ts(submitForApproval/requestRequisitionDeletion含む)・
 * purchase-requisitions.adapter.ts(承認確定/差戻し確定時の反映)を実HTTPリクエスト経由で検証する。
 *
 * #14-2⑥: 元々1263行あったpurchase-requisition.service.test.tsから、CSV入出力(→
 * purchase-requisition-csv.service.test.ts)を除いた部分を分割したもの。ロジック変更なし。
 * ヘルパー関数は既存の慣習(payment-crud.test.ts/payment-csv.test.ts)にならい、
 * 分割後の各ファイルにそのまま複製している(共通ファイル化はしない)。
 */

const db = drizzle(env.DB, { schema });

function buildWorkflowTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/approve", async (c) => {
    const body = await c.req.json();
    const result = await WorkflowTasksService.approveTask(c, db, body);
    return c.json(result);
  });
  app.post("/remand", async (c) => {
    const body = await c.req.json();
    const result = await WorkflowTasksService.remandTask(c, db, body);
    return c.json(result);
  });
  return app;
}

async function buildSessionCookieHeader(
  userId: string,
  employeeNumber = userId,
): Promise<string> {
  const token = await signSessionToken(
    {
      userId,
      employeeNumber,
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

async function callSubmitForApproval(id: string, actorUserId: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await purchaseRequisitionsRouter.request(
    `/${id}/submit-for-approval`,
    {
      method: "POST",
      headers: {
        Cookie: await buildSessionCookieHeader(actorUserId),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function callRequestDeletion(id: string, actorUserId: string) {
  const ctx = createExecutionContext();
  const res = await purchaseRequisitionsRouter.request(
    `/${id}/request-deletion`,
    { method: "POST", headers: { Cookie: await buildSessionCookieHeader(actorUserId) } },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function callCreateRequisition(actorUserId: string, payload: unknown) {
  const formData = new FormData();
  formData.append("requisitionData", JSON.stringify(payload));
  const ctx = createExecutionContext();
  const res = await purchaseRequisitionsRouter.request(
    "/register",
    {
      method: "POST",
      headers: { Cookie: await buildSessionCookieHeader(actorUserId) },
      body: formData,
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function callUpdateRequisition(id: string, actorUserId: string, payload: unknown) {
  const formData = new FormData();
  formData.append("requisitionData", JSON.stringify(payload));
  const ctx = createExecutionContext();
  const res = await purchaseRequisitionsRouter.request(
    `/${id}`,
    {
      method: "PUT",
      headers: { Cookie: await buildSessionCookieHeader(actorUserId) },
      body: formData,
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function callDeleteRequisition(id: string, actorUserId: string) {
  const ctx = createExecutionContext();
  const res = await purchaseRequisitionsRouter.request(
    `/${id}`,
    { method: "DELETE", headers: { Cookie: await buildSessionCookieHeader(actorUserId) } },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function callRequestUpdateApproval(
  actorUserId: string,
  body: {
    targetId: string;
    requestType: "REGISTER" | "UPDATE" | "SUSPEND" | "DELETE";
    payload: Record<string, unknown>;
    comment?: string;
  },
) {
  const ctx = createExecutionContext();
  const res = await approvalsRouter.request(
    "/request-update",
    {
      method: "POST",
      headers: {
        Cookie: await buildSessionCookieHeader(actorUserId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ targetType: "purchase_requisitions", ...body }),
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

const now = new Date();

async function seedUser(id: string, overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  await db.insert(schema.users).values({
    id,
    employeeNumber: id,
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
  await db.insert(schema.userRoles).values({ userId, roleId, departmentSurrogateId });
}

async function seedDepartment(surrogateId: string, id: string, name: string) {
  await db.insert(schema.departments).values({
    surrogateId,
    id,
    name,
    validFrom: now,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

async function seedApprovalFlow(
  id: string,
  requestType: string,
  steps: Array<{ order: number; roleId: string }>,
  options: {
    amountRange?: { min: number; max: number };
    matchField?: string | null;
    matchValue?: string | null;
  } = {},
) {
  const amountRange = options.amountRange ?? { min: 0, max: 999999999 };
  await db.insert(schema.approvalFlows).values({
    id,
    name: id,
    requestType,
    minAmount: amountRange.min,
    maxAmount: amountRange.max,
    matchField: options.matchField ?? null,
    matchValue: options.matchValue ?? null,
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

async function seedRequisition(
  id: string,
  overrides: Partial<typeof schema.purchaseRequests.$inferInsert> = {},
) {
  await db.insert(schema.purchaseRequests).values({
    id,
    title: `購買申請${id}`,
    departmentSurrogateId: "dept-a",
    applicantId: "applicant-1",
    requestType: "ONE_TIME",
    status: "DRAFT",
    totalAmount: 10000,
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
    ...overrides,
  });
}

async function seedUnit(code: string) {
  await db.insert(schema.units).values({
    code,
    name: code,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

async function seedAccount(code: string) {
  await db.insert(schema.accounts).values({
    code,
    name: `科目${code}`,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

async function seedProject(id: string) {
  await db.insert(schema.projects).values({
    id,
    name: `プロジェクト${id}`,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

async function seedPartner(id: string, type = "SUPPLIER") {
  await db.insert(schema.partners).values({
    id,
    name: `仕入先${id}`,
    type,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

async function seedTaxCategory(code: string, taxType: "EXEMPT" | "STANDARD" | "VARIABLE", taxRate: number) {
  await db.insert(schema.taxCategories).values({
    code,
    name: code,
    taxType,
    taxRate,
  });
}

async function seedItem(id: string, baseUnitCode: string) {
  await db.insert(schema.items).values({
    id,
    name: `品目${id}`,
    baseUnitCode,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

async function enablePurchaseRequisitionApprovalWorkflow() {
  await env.COMPANY_SETTINGS.put(
    "config",
    JSON.stringify({ is_purchase_requisition_approval_enabled: true }),
  );
}

async function findRequisition(id: string) {
  const rows = await db
    .select()
    .from(schema.purchaseRequests)
    .where(eq(schema.purchaseRequests.id, id));
  return rows[0] ?? null;
}

async function findPendingRequestByTarget(targetId: string) {
  return db
    .select()
    .from(schema.masterApprovalRequests)
    .where(eq(schema.masterApprovalRequests.targetId, targetId));
}

beforeEach(async () => {
  await db.delete(schema.purchaseRequestAttachments);
  await db.delete(schema.purchaseRequestItems);
  await db.delete(schema.purchaseRequests);
  await db.delete(schema.masterApprovalContexts);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.workflowLogs);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.userRoles);
  await db.delete(schema.departments);
  await db.delete(schema.roles);
  await db.delete(schema.users);
  await db.delete(schema.items);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
  await db.delete(schema.partners);
  await db.delete(schema.taxCategories);
  await env.COMPANY_SETTINGS.delete("config");

  await seedUser("applicant-1");
  await seedDepartment("dept-a", "D001", "資材部");
});

describe("POST /register", () => {
  it("新規登録は自動採番されたIDでDRAFTとして作成される", async () => {
    const res = await callCreateRequisition("applicant-1", {
      title: "事務用品購入",
      departmentSurrogateId: "dept-a",
      requestType: "ONE_TIME",
      items: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^PR-\d{4}$/);
    const requisition = await findRequisition(body.id);
    expect(requisition?.status).toBe("DRAFT");
    expect(requisition?.requestType).toBe("ONE_TIME");
  });
});

describe("PUT /:id のステータスガード", () => {
  it("DRAFTの購買申請は通常通り直接更新できる", async () => {
    await seedRequisition("PR-1", { status: "DRAFT" });
    const res = await callUpdateRequisition("PR-1", "applicant-1", {
      title: "更新後タイトル",
      departmentSurrogateId: "dept-a",
      items: [],
    });
    expect(res.status).toBe(200);
    expect((await findRequisition("PR-1"))?.title).toBe("更新後タイトル");
  });

  it("承認機能ONの場合、PENDING_APPROVAL中は直接更新できない(400)", async () => {
    await enablePurchaseRequisitionApprovalWorkflow();
    await seedRequisition("PR-1", { status: "PENDING_APPROVAL" });
    const res = await callUpdateRequisition("PR-1", "applicant-1", {
      title: "更新後タイトル",
      departmentSurrogateId: "dept-a",
      items: [],
    });
    expect(res.status).toBe(400);
  });

  it("承認機能ONの場合、APPROVED済みは直接更新できない(400、変更申請への案内)", async () => {
    await enablePurchaseRequisitionApprovalWorkflow();
    await seedRequisition("PR-1", { status: "APPROVED" });
    const res = await callUpdateRequisition("PR-1", "applicant-1", {
      title: "更新後タイトル",
      departmentSurrogateId: "dept-a",
      items: [],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("/api/approvals/request-update");
  });

  it("承認機能OFFの場合、APPROVED済みも直接更新できる", async () => {
    await seedRequisition("PR-1", { status: "APPROVED" });
    const res = await callUpdateRequisition("PR-1", "applicant-1", {
      title: "OFF時は直接更新可",
      departmentSurrogateId: "dept-a",
      items: [],
    });
    expect(res.status).toBe(200);
    expect((await findRequisition("PR-1"))?.title).toBe("OFF時は直接更新可");
  });
});

describe("DELETE /:id のステータスガード", () => {
  it("DRAFTの購買申請は直接削除できる", async () => {
    await seedRequisition("PR-1", { status: "DRAFT" });
    const res = await callDeleteRequisition("PR-1", "applicant-1");
    expect(res.status).toBe(200);
    expect(await findRequisition("PR-1")).toBeNull();
  });

  it("APPROVED済みは直接削除できない(400)", async () => {
    await seedRequisition("PR-1", { status: "APPROVED" });
    const res = await callDeleteRequisition("PR-1", "applicant-1");
    expect(res.status).toBe(400);
    expect(await findRequisition("PR-1")).not.toBeNull();
  });
});

describe("POST /:id/submit-for-approval", () => {
  it("DRAFT以外は申請できない(400)", async () => {
    await seedRequisition("PR-1", { status: "APPROVED" });
    const res = await callSubmitForApproval("PR-1", "applicant-1");
    expect(res.status).toBe(400);
  });

  it("承認機能OFFの場合は直接APPROVEDに確定する(ワークフロー申請は作られない)", async () => {
    await seedRequisition("PR-1", { status: "DRAFT" });
    const res = await callSubmitForApproval("PR-1", "applicant-1");
    expect(res.status).toBe(200);
    expect((await findRequisition("PR-1"))?.status).toBe("APPROVED");
    expect(await findPendingRequestByTarget("PR-1")).toHaveLength(0);
  });

  it("承認機能ONだが合致する承認フローが無い場合は400になり、ステータスはDRAFTのまま戻る", async () => {
    await enablePurchaseRequisitionApprovalWorkflow();
    await seedRequisition("PR-1", { status: "DRAFT" });
    const res = await callSubmitForApproval("PR-1", "applicant-1");
    expect(res.status).toBe(400);
    expect((await findRequisition("PR-1"))?.status).toBe("DRAFT");
  });

  it("承認機能ONかつ承認フローが定義されている場合、PENDING_APPROVALになりPENDING申請が作られる", async () => {
    await enablePurchaseRequisitionApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "purchase_requisitions", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedRequisition("PR-1", { status: "DRAFT", totalAmount: 5000 });

    const res = await callSubmitForApproval("PR-1", "applicant-1");
    expect(res.status).toBe(200);
    expect((await findRequisition("PR-1"))?.status).toBe("PENDING_APPROVAL");

    const requests = await findPendingRequestByTarget("PR-1");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      targetType: "purchase_requisitions",
      requestType: "REGISTER",
      status: "PENDING",
      applicantId: "applicant-1",
    });
  });

  it("Item9 Phase2汎用マッチ機構の実利用: matchField=requestTypeで前払だけ別の承認フローに分岐する", async () => {
    await enablePurchaseRequisitionApprovalWorkflow();
    await seedRole("standard_approver");
    await seedRole("finance_approver");
    await seedUser("standard-approver-1");
    await seedUserRole("standard-approver-1", "standard_approver");
    await seedUser("finance-approver-1");
    await seedUserRole("finance-approver-1", "finance_approver");

    // matchField未設定の汎用フロー(都度/定期用)と、matchField="requestType"/matchValue="PREPAYMENT"の
    // 専用フロー(前払用)が同一targetType・同一金額帯に共存するケース
    await seedApprovalFlow("flow-standard", "purchase_requisitions", [
      { order: 1, roleId: "standard_approver" },
    ]);
    await seedApprovalFlow(
      "flow-prepayment",
      "purchase_requisitions",
      [{ order: 1, roleId: "finance_approver" }],
      { matchField: "requestType", matchValue: "PREPAYMENT" },
    );

    await seedRequisition("PR-PREPAY", {
      status: "DRAFT",
      requestType: "PREPAYMENT",
      totalAmount: 5000,
    });

    const res = await callSubmitForApproval("PR-PREPAY", "applicant-1");
    expect(res.status).toBe(200);

    const requests = await findPendingRequestByTarget("PR-PREPAY");
    expect(requests).toHaveLength(1);

    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "PR-PREPAY"));
    expect(logs).toHaveLength(1);
    expect(logs[0].approverRoleId).toBe("finance_approver");
  });

  it("追加要望F: 申請者の実際の所属部署を指定した場合、masterApprovalRequestsにapplicantDepartmentSurrogateIdとして保存される", async () => {
    await enablePurchaseRequisitionApprovalWorkflow();
    await seedRole("approver_role");
    await seedUserRole("applicant-1", "approver_role", "dept-a");
    await seedApprovalFlow("flow-1", "purchase_requisitions", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedRequisition("PR-1", { status: "DRAFT", totalAmount: 5000 });

    const res = await callSubmitForApproval("PR-1", "applicant-1", {
      applicantDepartmentSurrogateId: "dept-a",
    });
    expect(res.status).toBe(200);

    const requests = await findPendingRequestByTarget("PR-1");
    expect(requests[0].applicantDepartmentSurrogateId).toBe("dept-a");
  });
});

describe("POST /:id/request-deletion", () => {
  it("未申請のDRAFTは承認不要で直接削除される", async () => {
    await enablePurchaseRequisitionApprovalWorkflow();
    await seedRequisition("PR-1", { status: "DRAFT" });
    const res = await callRequestDeletion("PR-1", "applicant-1");
    expect(res.status).toBe(200);
    expect(await findRequisition("PR-1")).toBeNull();
  });

  it("承認機能ONの場合、APPROVED済みはPENDING_DELETIONになり削除申請が作られる(即削除されない)", async () => {
    await enablePurchaseRequisitionApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "purchase_requisitions", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedRequisition("PR-1", { status: "APPROVED" });

    const res = await callRequestDeletion("PR-1", "applicant-1");
    expect(res.status).toBe(200);
    expect((await findRequisition("PR-1"))?.status).toBe("PENDING_DELETION");

    const requests = await findPendingRequestByTarget("PR-1");
    expect(requests).toHaveLength(1);
    expect(requests[0].requestType).toBe("DELETE");
  });
});

describe("承認確定(WorkflowTasksService.approveTask)によるpurchase-requisitions.adapter.tsの反映", () => {
  it("REGISTER申請(初回承認)が最終承認されると、purchase_requests.statusがAPPROVEDになる", async () => {
    await enablePurchaseRequisitionApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "purchase_requisitions", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedRequisition("PR-1", { status: "DRAFT" });

    await callSubmitForApproval("PR-1", "applicant-1");
    const requests = await findPendingRequestByTarget("PR-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "PR-1"));

    const res = await callApproveTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(res.status).toBe(200);
    expect((await findRequisition("PR-1"))?.status).toBe("APPROVED");
  });

  it("UPDATE申請(承認済み購買申請の変更)が最終承認されると、headerが新しい内容に置き換わる", async () => {
    await enablePurchaseRequisitionApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "purchase_requisitions", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedRequisition("PR-1", { status: "APPROVED", title: "旧タイトル" });

    const submitRes = await callRequestUpdateApproval("applicant-1", {
      targetId: "PR-1",
      requestType: "UPDATE",
      payload: {
        header: {
          title: "新タイトル",
          departmentSurrogateId: "dept-a",
          requestType: "ONE_TIME",
          totalAmount: 20000,
        },
        items: [],
      },
    });
    expect(submitRes.status).toBe(200);

    // UPDATE申請中でも、承認されるまでは旧内容がそのまま有効
    expect((await findRequisition("PR-1"))?.title).toBe("旧タイトル");

    const requests = await findPendingRequestByTarget("PR-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "PR-1"));

    const res = await callApproveTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(res.status).toBe(200);

    const requisition = await findRequisition("PR-1");
    expect(requisition?.title).toBe("新タイトル");
    expect(requisition?.status).toBe("APPROVED");
    expect(requisition?.totalAmount).toBe(20000);
  });

  it("DELETE申請が最終承認されると、購買申請が物理削除される", async () => {
    await enablePurchaseRequisitionApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "purchase_requisitions", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedRequisition("PR-1", { status: "APPROVED" });

    await callRequestDeletion("PR-1", "applicant-1");
    const requests = await findPendingRequestByTarget("PR-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "PR-1"));

    const res = await callApproveTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(res.status).toBe(200);
    expect(await findRequisition("PR-1")).toBeNull();
  });
});

describe("差戻し確定(WorkflowTasksService.remandTask)によるpurchase-requisitions.adapter.tsの反映", () => {
  it("REGISTER申請の差戻しで、purchase_requests.statusがDRAFTへ自動的に戻る", async () => {
    await enablePurchaseRequisitionApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "purchase_requisitions", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedRequisition("PR-1", { status: "DRAFT" });

    await callSubmitForApproval("PR-1", "applicant-1");
    const requests = await findPendingRequestByTarget("PR-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "PR-1"));

    const res = await callRemandTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(res.status).toBe(200);
    expect((await findRequisition("PR-1"))?.status).toBe("DRAFT");
  });

  it("DELETE申請の差戻しで、purchase_requests.statusがAPPROVEDへ戻る(削除されない)", async () => {
    await enablePurchaseRequisitionApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "purchase_requisitions", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedRequisition("PR-1", { status: "APPROVED" });

    await callRequestDeletion("PR-1", "applicant-1");
    const requests = await findPendingRequestByTarget("PR-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "PR-1"));

    const res = await callRemandTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(res.status).toBe(200);
    expect((await findRequisition("PR-1"))?.status).toBe("APPROVED");
  });
});

describe("明細行(purchase_request_items)の登録・合計金額の自動計算", () => {
  it("明細を含めて登録すると、totalAmountは税込(明細のquantity*estimatedUnitPriceの合計+消費税)になる", async () => {
    await seedUnit("PCS");
    await seedProject("PJ-1");
    await seedItem("ITEM-1", "PCS");

    const res = await callCreateRequisition("applicant-1", {
      id: "PR-ITEM-1",
      title: "備品購入",
      departmentSurrogateId: "dept-a",
      requestType: "ONE_TIME",
      projectId: "PJ-1",
      items: [
        { itemId: "ITEM-1", quantity: 3, estimatedUnitPrice: 1500 },
      ],
    });
    expect(res.status).toBe(200);

    const requisition = await findRequisition("PR-ITEM-1");
    // 税区分未指定は10%扱い(quotesのcalcTaxBreakdownと同じ既定挙動): 4500 + 450 = 4950
    expect(requisition?.totalAmount).toBe(4950);
    expect(requisition?.taxAmount).toBe(450);
    expect(requisition?.projectId).toBe("PJ-1");

    const items = await db
      .select()
      .from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, "PR-ITEM-1"));
    expect(items).toHaveLength(1);
    expect(items[0].salesOrderItemId).toBeNull();
    expect(items[0].inputType).toBe("MASTER");
  });

  it("Phase3フォローアップ: 手入力(DIRECT)の品目は、itemsマスタに存在しないitemId+itemNameでも登録できる", async () => {
    await seedAccount("ACC-1");

    const res = await callCreateRequisition("applicant-1", {
      id: "PR-DIRECT-1",
      title: "マスタ外品の購入",
      departmentSurrogateId: "dept-a",
      requestType: "ONE_TIME",
      accountCode: "ACC-1",
      items: [
        {
          itemId: "FREE-CODE-1",
          itemName: "自由入力の品目名",
          inputType: "DIRECT",
          quantity: 2,
          estimatedUnitPrice: 2000,
        },
      ],
    });
    expect(res.status).toBe(200);

    const requisition = await findRequisition("PR-DIRECT-1");
    // 4000 + 400(10%) = 4400
    expect(requisition?.totalAmount).toBe(4400);

    const items = await db
      .select()
      .from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, "PR-DIRECT-1"));
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe("FREE-CODE-1");
    expect(items[0].itemName).toBe("自由入力の品目名");
    expect(items[0].inputType).toBe("DIRECT");
  });
});

describe("申請者/入力者(見積のsalesPerson/inputPersonと同じ2担当者分離)", () => {
  it("applicantId/inputPersonEmployeeNumberを明示指定すると、ログイン操作者ではなくその値が保存される", async () => {
    await seedAccount("ACC-1");

    const res = await callCreateRequisition("applicant-1", {
      id: "PR-PERSON-1",
      title: "担当者指定確認",
      departmentSurrogateId: "dept-a",
      requestType: "ONE_TIME",
      accountCode: "ACC-1",
      applicantId: "requester-9",
      inputPersonEmployeeNumber: "inputter-9",
      items: [],
    });
    expect(res.status).toBe(200);

    const requisition = await findRequisition("PR-PERSON-1");
    expect(requisition?.applicantId).toBe("requester-9");
    expect(requisition?.inputPersonEmployeeNumber).toBe("inputter-9");
  });

  it("未指定の場合はログイン操作者がinputPersonEmployeeNumberの既定値になる", async () => {
    await seedAccount("ACC-1");

    const res = await callCreateRequisition("applicant-1", {
      id: "PR-PERSON-2",
      title: "担当者未指定確認",
      departmentSurrogateId: "dept-a",
      requestType: "ONE_TIME",
      accountCode: "ACC-1",
      items: [],
    });
    expect(res.status).toBe(200);

    const requisition = await findRequisition("PR-PERSON-2");
    expect(requisition?.applicantId).toBe("applicant-1");
    expect(requisition?.inputPersonEmployeeNumber).toBe("applicant-1");
  });
});

describe("消費税計算(見積のcalcTaxBreakdownと同じ税率別内訳)", () => {
  it("明細ごとのtaxCategoryCodeに応じて10%/8%/非課税を按分し、totalAmountに反映する", async () => {
    await seedAccount("ACC-1");
    await seedTaxCategory("TAX_10", "STANDARD", 0.1);
    await seedTaxCategory("TAX_8", "STANDARD", 0.08);
    await seedTaxCategory("TAX_0", "EXEMPT", 0);

    const res = await callCreateRequisition("applicant-1", {
      id: "PR-TAX-1",
      title: "税率混在確認",
      departmentSurrogateId: "dept-a",
      requestType: "ONE_TIME",
      accountCode: "ACC-1",
      items: [
        { itemId: "FREE-A", inputType: "DIRECT", itemName: "10%品", quantity: 1, estimatedUnitPrice: 1000, taxCategoryCode: "TAX_10" },
        { itemId: "FREE-B", inputType: "DIRECT", itemName: "8%品", quantity: 1, estimatedUnitPrice: 1000, taxCategoryCode: "TAX_8" },
        { itemId: "FREE-C", inputType: "DIRECT", itemName: "非課税品", quantity: 1, estimatedUnitPrice: 1000, taxCategoryCode: "TAX_0" },
      ],
    });
    expect(res.status).toBe(200);

    const requisition = await findRequisition("PR-TAX-1");
    // 税額: 1000*0.1 + 1000*0.08 + 0 = 180、合計: 3000 + 180 = 3180
    expect(requisition?.taxAmount).toBe(180);
    expect(requisition?.totalAmount).toBe(3180);

    const items = await db
      .select()
      .from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, "PR-TAX-1"));
    expect(items.find((i) => i.itemId === "FREE-A")?.taxCategoryCode).toBe("TAX_10");
  });
});

describe("仕入先(マスタ選択/手入力)", () => {
  it("マスタ選択(MASTER)の仕入先はpartnersマスタのIDで登録される", async () => {
    await seedAccount("ACC-1");
    await seedPartner("PARTNER-1");

    const res = await callCreateRequisition("applicant-1", {
      id: "PR-PARTNER-MASTER-1",
      title: "仕入先マスタ選択確認",
      departmentSurrogateId: "dept-a",
      requestType: "ONE_TIME",
      partnerId: "PARTNER-1",
      partnerInputType: "MASTER",
      items: [],
    });
    expect(res.status).toBe(200);

    const requisition = await findRequisition("PR-PARTNER-MASTER-1");
    expect(requisition?.partnerId).toBe("PARTNER-1");
    expect(requisition?.partnerInputType).toBe("MASTER");
  });

  it("手入力(DIRECT)の仕入先は、partnersマスタに存在しないpartnerNameでも登録できる", async () => {
    await seedAccount("ACC-1");

    const res = await callCreateRequisition("applicant-1", {
      id: "PR-PARTNER-DIRECT-1",
      title: "仕入先手入力確認",
      departmentSurrogateId: "dept-a",
      requestType: "ONE_TIME",
      partnerName: "自由入力の仕入先",
      partnerInputType: "DIRECT",
      items: [],
    });
    expect(res.status).toBe(200);

    const requisition = await findRequisition("PR-PARTNER-DIRECT-1");
    expect(requisition?.partnerId).toBeNull();
    expect(requisition?.partnerName).toBe("自由入力の仕入先");
    expect(requisition?.partnerInputType).toBe("DIRECT");
  });
});

describe("添付ファイル(R2/共有リンク)", () => {
  it("共有リンク(GOOGLE_DRIVE)の添付は、R2アップロード無しでexternalUrlのみで登録できる", async () => {
    await seedAccount("ACC-1");

    const res = await callCreateRequisition("applicant-1", {
      id: "PR-ATTACH-URL-1",
      title: "共有リンク添付確認",
      departmentSurrogateId: "dept-a",
      requestType: "ONE_TIME",
      items: [],
      attachments: [
        {
          fileName: "見積依頼書",
          storageType: "GOOGLE_DRIVE",
          externalUrl: "https://drive.google.com/example",
        },
      ],
    });
    expect(res.status).toBe(200);

    const attachments = await db
      .select()
      .from(schema.purchaseRequestAttachments)
      .where(eq(schema.purchaseRequestAttachments.requestId, "PR-ATTACH-URL-1"));
    expect(attachments).toHaveLength(1);
    expect(attachments[0].storageType).toBe("GOOGLE_DRIVE");
    expect(attachments[0].externalUrl).toBe("https://drive.google.com/example");
    expect(attachments[0].attachmentR2Path).toBeNull();
  });

  it("更新時、既存の共有リンク添付を維持したまま他フィールドを更新できる", async () => {
    await seedAccount("ACC-1");
    await callCreateRequisition("applicant-1", {
      id: "PR-ATTACH-URL-2",
      title: "更新前",
      departmentSurrogateId: "dept-a",
      requestType: "ONE_TIME",
      items: [],
      attachments: [
        {
          fileName: "参考リンク",
          storageType: "GOOGLE_DRIVE",
          externalUrl: "https://drive.google.com/before",
        },
      ],
    });

    const res = await callUpdateRequisition("PR-ATTACH-URL-2", "applicant-1", {
      title: "更新後",
      departmentSurrogateId: "dept-a",
      requestType: "ONE_TIME",
      items: [],
      attachments: [
        {
          fileName: "参考リンク",
          storageType: "GOOGLE_DRIVE",
          externalUrl: "https://drive.google.com/after",
        },
      ],
    });
    expect(res.status).toBe(200);

    const attachments = await db
      .select()
      .from(schema.purchaseRequestAttachments)
      .where(eq(schema.purchaseRequestAttachments.requestId, "PR-ATTACH-URL-2"));
    expect(attachments).toHaveLength(1);
    expect(attachments[0].externalUrl).toBe("https://drive.google.com/after");
  });
});
