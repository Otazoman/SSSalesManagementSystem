import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as logSchema from "../../../db/audit-schema";
import { signSessionToken } from "../../../platform/auth/session-token";

/**
 * workflow-tasksルート(実際のHTTPルーター)の統合テスト。
 * #14-2⑥: 元々1139行あったindex.test.tsから、GET /request-status/:targetId・POST /approve
 * (各種target-adapterへの反映を含む)の部分を分割したもの。ロジック変更なし。
 * GET /request-status/:targetIdはWorkflowTasksRepositoryを直接呼ぶだけでworkflow-tasks-*
 * .service.tsのどれにも対応しないが、ファイルが小さいため利用頻度の近いPOST /approveと
 * 同居させている。GET /historyのみworkflow-tasks-history.index.test.tsへ分離した。
 */

vi.mock("../../../workflow-engine/notifier", () => ({
  sendWorkflowMail: vi.fn(async () => {}),
  notifyApprovalRequestSubmitted: vi.fn(async () => {}),
}));

import { workflowTasksRouter } from "./index";

const db = drizzle(env.DB, { schema });
const logDb = drizzle(env.DB_LOG, { schema: logSchema });
const now = new Date();

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

async function seedApprovalFlow(
  id: string,
  targetType: string,
  steps: Array<{ order: number; roleId: string }>,
) {
  await db.insert(schema.approvalFlows).values({
    id,
    name: id,
    requestType: targetType,
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

async function seedWorkflowLog(params: {
  id: string;
  targetType: string;
  targetId: string;
  approverRoleId: string;
  layer: number;
}) {
  await db.insert(schema.workflowLogs).values({
    id: params.id,
    targetType: params.targetType,
    targetId: params.targetId,
    approverRoleId: params.approverRoleId,
    layer: params.layer,
    status: "PENDING",
  });
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
  await logDb.delete(logSchema.auditLogs);
});

// BUG-013: 承認APIは操作する人をログイン情報(セッションcookie)から決め、その段の承認者かを確かめる。
// そのため、送る userId のユーザーを「approver_role を部署の指定なしで持つ承認者」として用意し、ログインさせる
async function loginAsApprover(userId: string): Promise<string> {
  await db
    .insert(schema.users)
    .values({
      id: userId,
      employeeNumber: `EMP-${userId}`,
      email: `${userId}@example.com`,
      name: userId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  await db
    .insert(schema.roles)
    .values({ id: "approver_role", name: "approver_role", createdAt: now })
    .onConflictDoNothing();
  await db
    .insert(schema.userRoles)
    .values({ userId, roleId: "approver_role", departmentSurrogateId: null })
    .onConflictDoNothing();
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

async function callApprove(body: { userId: string } & Record<string, unknown>) {
  const cookie = await loginAsApprover(body.userId);
  const ctx = createExecutionContext();
  const res = await workflowTasksRouter.request(
    "/approve",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("GET /request-status/:targetId", () => {
  async function seedRequest(targetType: string, targetId: string) {
    await db.insert(schema.masterApprovalRequests).values({
      id: `REQ-${targetType}-${targetId}`,
      targetType,
      targetId,
      requestType: "REGISTER",
      status: "PENDING",
      applicantId: "EMP001",
      createdAt: now,
      updatedAt: now,
    });
  }

  it("targetType未指定時は従来通りmaster_partnersとして検索する(後方互換)", async () => {
    await seedRequest("master_partners", "P-1");
    const res = await workflowTasksRouter.request("/request-status/P-1", {}, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ hasRequest: true, status: "PENDING" });
  });

  it("targetType指定時はそのtargetTypeで検索する(units等の新規マスタ対応)", async () => {
    await seedRequest("master_units", "PCS");
    const res = await workflowTasksRouter.request(
      "/request-status/PCS?targetType=master_units",
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ hasRequest: true, status: "PENDING" });
  });

  it("targetIdが同じでもtargetTypeが違う申請はヒットしない", async () => {
    await seedRequest("master_partners", "SAME-ID");
    const res = await workflowTasksRouter.request(
      "/request-status/SAME-ID?targetType=master_units",
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ hasRequest: false, status: null });
  });
});

describe("POST /approve", () => {
  it("master_units: REGISTER申請の最終承認で、target-adapterがstatusをactiveへ反映する", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-units", "master_units", [
      { order: 1, roleId: "approver_role" },
    ]);
    await db.insert(schema.units).values({
      code: "PCS",
      name: "個",
      status: "temporary",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-1",
      targetType: "master_units",
      targetId: "PCS",
      requestType: "REGISTER",
      applicantId: "applicant-1",
    });
    await seedWorkflowLog({
      id: "log-1",
      targetType: "master_units",
      targetId: "PCS",
      approverRoleId: "approver_role",
      layer: 1,
    });

    const res = await callApprove({
      logId: "log-1",
      requestId: "req-1",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);

    const unit = await db
      .select()
      .from(schema.units)
      .where(eq(schema.units.code, "PCS"));
    expect(unit[0].status).toBe("active");

    const request = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.id, "req-1"));
    expect(request[0].status).toBe("APPROVED");
  });

  it("master_units: UPDATE申請の最終承認で、target-adapterが退避スナップショットの内容(name変更)を正式反映する", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-units", "master_units", [
      { order: 1, roleId: "approver_role" },
    ]);
    await db.insert(schema.units).values({
      code: "PCS",
      name: "旧名称",
      status: "temporary",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-2",
      targetType: "master_units",
      targetId: "PCS",
      requestType: "UPDATE",
      applicantId: "applicant-1",
      generalMemo: JSON.stringify({ name: "新名称", status: "active" }),
    });
    await seedWorkflowLog({
      id: "log-2",
      targetType: "master_units",
      targetId: "PCS",
      approverRoleId: "approver_role",
      layer: 1,
    });

    const res = await callApprove({
      logId: "log-2",
      requestId: "req-2",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);

    const unit = await db
      .select()
      .from(schema.units)
      .where(eq(schema.units.code, "PCS"));
    expect(unit[0].name).toBe("新名称");
    expect(unit[0].status).toBe("active");
  });

  // 回帰テスト: 無効化(suspend)申請はUPDATE申請としてstatus="suspended"をスナップショットに
  // 積んで提出される。以前のunits.adapter.tsは承認確定時に無条件でstatus:"active"を書き込んで
  // いたため、無効化申請を承認してもactiveへ戻ってしまい「無効化申請が効いていない」不具合に
  // なっていた。
  it("master_units: 無効化(suspend)申請の最終承認でstatusがsuspendedへ反映される(activeに戻らない)", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-units-suspend", "master_units", [
      { order: 1, roleId: "approver_role" },
    ]);
    await db.insert(schema.units).values({
      code: "KG",
      name: "キログラム",
      status: "temporary",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-2s",
      targetType: "master_units",
      targetId: "KG",
      requestType: "UPDATE",
      applicantId: "applicant-1",
      generalMemo: JSON.stringify({ name: "キログラム", status: "suspended" }),
    });
    await seedWorkflowLog({
      id: "log-2s",
      targetType: "master_units",
      targetId: "KG",
      approverRoleId: "approver_role",
      layer: 1,
    });

    const res = await callApprove({
      logId: "log-2s",
      requestId: "req-2s",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const unit = await db
      .select()
      .from(schema.units)
      .where(eq(schema.units.code, "KG"));
    expect(unit[0].status).toBe("suspended");
  });

  it("master_locations: REGISTER申請の最終承認でstatusがactiveへ反映される", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-locations", "master_locations", [
      { order: 1, roleId: "approver_role" },
    ]);
    await db.insert(schema.warehouses).values({
      id: "WH1",
      name: "倉庫1",
      status: "active",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.locations).values({
      id: "LOC1",
      warehouseId: "WH1",
      name: "棚A",
      status: "temporary",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-3",
      targetType: "master_locations",
      targetId: "LOC1",
      requestType: "REGISTER",
      applicantId: "applicant-1",
    });
    await seedWorkflowLog({
      id: "log-3",
      targetType: "master_locations",
      targetId: "LOC1",
      approverRoleId: "approver_role",
      layer: 1,
    });

    const res = await callApprove({
      logId: "log-3",
      requestId: "req-3",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const location = await db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, "LOC1"));
    expect(location[0].status).toBe("active");
  });

  it("master_locations: 無効化(suspend)申請の最終承認でstatusがsuspendedへ反映される(activeに戻らない)", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-locations-suspend", "master_locations", [
      { order: 1, roleId: "approver_role" },
    ]);
    await db.insert(schema.warehouses).values({
      id: "WH1",
      name: "倉庫1",
      status: "active",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.locations).values({
      id: "LOC1",
      warehouseId: "WH1",
      name: "棚A",
      status: "temporary",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-3s",
      targetType: "master_locations",
      targetId: "LOC1",
      requestType: "UPDATE",
      applicantId: "applicant-1",
      generalMemo: JSON.stringify({
        warehouseId: "WH1",
        name: "棚A",
        status: "suspended",
      }),
    });
    await seedWorkflowLog({
      id: "log-3s",
      targetType: "master_locations",
      targetId: "LOC1",
      approverRoleId: "approver_role",
      layer: 1,
    });

    const res = await callApprove({
      logId: "log-3s",
      requestId: "req-3s",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const location = await db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, "LOC1"));
    expect(location[0].status).toBe("suspended");
  });

  it("master_contacts: REGISTER申請の最終承認でstatusがactiveへ反映される", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-contacts", "master_contacts", [
      { order: 1, roleId: "approver_role" },
    ]);
    await db.insert(schema.partners).values({
      id: "P-1",
      name: "テスト取引先",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.partnerContacts).values({
      id: "C-1",
      partnerId: "P-1",
      contactType: "CUSTOMER_CONTACT",
      name: "山田太郎",
      status: "temporary",
      isEmailTarget: true,
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-4",
      targetType: "master_contacts",
      targetId: "C-1",
      requestType: "REGISTER",
      applicantId: "applicant-1",
    });
    await seedWorkflowLog({
      id: "log-4",
      targetType: "master_contacts",
      targetId: "C-1",
      approverRoleId: "approver_role",
      layer: 1,
    });

    const res = await callApprove({
      logId: "log-4",
      requestId: "req-4",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const contact = await db
      .select()
      .from(schema.partnerContacts)
      .where(eq(schema.partnerContacts.id, "C-1"));
    expect(contact[0].status).toBe("active");
  });

  it("master_contacts: 無効化(suspend)申請の最終承認でstatusがsuspendedへ反映される(activeに戻らない)", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-contacts-suspend", "master_contacts", [
      { order: 1, roleId: "approver_role" },
    ]);
    await db.insert(schema.partners).values({
      id: "P-1",
      name: "テスト取引先",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.partnerContacts).values({
      id: "C-1",
      partnerId: "P-1",
      contactType: "CUSTOMER_CONTACT",
      name: "山田太郎",
      status: "temporary",
      isEmailTarget: true,
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-4s",
      targetType: "master_contacts",
      targetId: "C-1",
      requestType: "UPDATE",
      applicantId: "applicant-1",
      generalMemo: JSON.stringify({
        partnerId: "P-1",
        contactType: "CUSTOMER_CONTACT",
        name: "山田太郎",
        status: "suspended",
      }),
    });
    await seedWorkflowLog({
      id: "log-4s",
      targetType: "master_contacts",
      targetId: "C-1",
      approverRoleId: "approver_role",
      layer: 1,
    });

    const res = await callApprove({
      logId: "log-4s",
      requestId: "req-4s",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const contact = await db
      .select()
      .from(schema.partnerContacts)
      .where(eq(schema.partnerContacts.id, "C-1"));
    expect(contact[0].status).toBe("suspended");
  });

  // V-5: 取引先担当者の変更申請の退避データに含まれる「メールで送る帳票」は、最終承認で反映される
  describe("master_contacts: 変更申請の最終承認と、メールで送る帳票(V-5)", () => {
    async function approveContactUpdate(reqId: string, snapshot: Record<string, unknown>) {
      await seedUser("applicant-1");
      await seedRole("approver_role");
      await seedApprovalFlow(`flow-${reqId}`, "master_contacts", [{ order: 1, roleId: "approver_role" }]);
      await db.insert(schema.partners).values({
        id: "P-1",
        name: "テスト取引先",
        createdBy: "applicant-1",
        createdAt: now,
        updatedBy: "applicant-1",
        updatedAt: now,
      });
      await db.insert(schema.partnerContacts).values({
        id: "C-1",
        partnerId: "P-1",
        contactType: "CUSTOMER_CONTACT",
        name: "山田太郎",
        status: "temporary",
        isEmailTarget: true,
        createdBy: "applicant-1",
        createdAt: now,
        updatedBy: "applicant-1",
        updatedAt: now,
      });
      await db.insert(schema.partnerContactDocumentTypes).values({ contactId: "C-1", documentType: "quote" });
      await seedMasterApprovalRequest({
        id: reqId,
        targetType: "master_contacts",
        targetId: "C-1",
        requestType: "UPDATE",
        applicantId: "applicant-1",
        generalMemo: JSON.stringify({
          partnerId: "P-1",
          contactType: "CUSTOMER_CONTACT",
          name: "山田太郎",
          status: "active",
          ...snapshot,
        }),
      });
      await seedWorkflowLog({
        id: `log-${reqId}`,
        targetType: "master_contacts",
        targetId: "C-1",
        approverRoleId: "approver_role",
        layer: 1,
      });
      const res = await callApprove({ logId: `log-${reqId}`, requestId: reqId, userId: "approver-1" });
      expect(res.status).toBe(200);
      const rows = await db
        .select({ t: schema.partnerContactDocumentTypes.documentType })
        .from(schema.partnerContactDocumentTypes)
        .where(eq(schema.partnerContactDocumentTypes.contactId, "C-1"));
      return rows.map((r) => r.t).sort();
    }

    it("退避データに帳票(documentTypes)があれば、承認確定で置き換わる(定義にないキーは無視)", async () => {
      expect(await approveContactUpdate("req-dt1", { documentTypes: ["billing", "purchase_order", "unknown"] })).toEqual([
        "billing",
        "purchase_order",
      ]);
    });

    it("退避データに帳票が無い旧い申請では、既存の設定を変えない", async () => {
      expect(await approveContactUpdate("req-dt2", {})).toEqual(["quote"]);
    });
  });

  it("master_prices: REGISTER申請の最終承認でstatusがactiveへ反映される", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-prices", "master_prices", [
      { order: 1, roleId: "approver_role" },
    ]);
    await db.insert(schema.units).values({
      code: "PCS",
      name: "個",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.items).values({
      id: "ITEM-A",
      name: "品目A",
      baseUnitCode: "PCS",
      status: "active",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.itemPrices).values({
      id: "PRC-1",
      itemId: "ITEM-A",
      priceType: "SALES",
      minQuantity: 0,
      unitPrice: 100,
      unitCode: "PCS",
      status: "temporary",
      validFrom: now,
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-5",
      targetType: "master_prices",
      targetId: "PRC-1",
      requestType: "REGISTER",
      applicantId: "applicant-1",
    });
    await seedWorkflowLog({
      id: "log-5",
      targetType: "master_prices",
      targetId: "PRC-1",
      approverRoleId: "approver_role",
      layer: 1,
    });

    const res = await callApprove({
      logId: "log-5",
      requestId: "req-5",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const price = await db
      .select()
      .from(schema.itemPrices)
      .where(eq(schema.itemPrices.id, "PRC-1"));
    expect(price[0].status).toBe("active");
  });

  it("master_prices: 無効化(suspend)申請の最終承認でstatusがsuspendedへ反映される(activeに戻らない)", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-prices-suspend", "master_prices", [
      { order: 1, roleId: "approver_role" },
    ]);
    await db.insert(schema.units).values({
      code: "PCS",
      name: "個",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.items).values({
      id: "ITEM-A",
      name: "品目A",
      baseUnitCode: "PCS",
      status: "active",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.itemPrices).values({
      id: "PRC-1",
      itemId: "ITEM-A",
      priceType: "SALES",
      minQuantity: 0,
      unitPrice: 100,
      unitCode: "PCS",
      status: "temporary",
      validFrom: now,
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-5s",
      targetType: "master_prices",
      targetId: "PRC-1",
      requestType: "UPDATE",
      applicantId: "applicant-1",
      generalMemo: JSON.stringify({
        minQuantity: 0,
        unitPrice: 100,
        unitCode: "PCS",
        status: "suspended",
      }),
    });
    await seedWorkflowLog({
      id: "log-5s",
      targetType: "master_prices",
      targetId: "PRC-1",
      approverRoleId: "approver_role",
      layer: 1,
    });

    const res = await callApprove({
      logId: "log-5s",
      requestId: "req-5s",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const price = await db
      .select()
      .from(schema.itemPrices)
      .where(eq(schema.itemPrices.id, "PRC-1"));
    expect(price[0].status).toBe("suspended");
  });

  it("master_products: REGISTER申請の最終承認でstatusがactiveへ反映される", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-products", "master_products", [
      { order: 1, roleId: "approver_role" },
    ]);
    await db.insert(schema.units).values({
      code: "PCS",
      name: "個",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.items).values({
      id: "ITEM-A",
      name: "品目A",
      baseUnitCode: "PCS",
      status: "temporary",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-6",
      targetType: "master_products",
      targetId: "ITEM-A",
      requestType: "REGISTER",
      applicantId: "applicant-1",
    });
    await seedWorkflowLog({
      id: "log-6",
      targetType: "master_products",
      targetId: "ITEM-A",
      approverRoleId: "approver_role",
      layer: 1,
    });

    const res = await callApprove({
      logId: "log-6",
      requestId: "req-6",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const product = await db
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, "ITEM-A"));
    expect(product[0].status).toBe("active");
  });

  it("master_products: 無効化(suspend)申請の最終承認でstatusがsuspendedへ反映される(activeに戻らない)", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-products-suspend", "master_products", [
      { order: 1, roleId: "approver_role" },
    ]);
    await db.insert(schema.units).values({
      code: "PCS",
      name: "個",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.items).values({
      id: "ITEM-A",
      name: "品目A",
      baseUnitCode: "PCS",
      status: "temporary",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-6s",
      targetType: "master_products",
      targetId: "ITEM-A",
      requestType: "UPDATE",
      applicantId: "applicant-1",
      generalMemo: JSON.stringify({
        name: "品目A",
        baseUnitCode: "PCS",
        status: "suspended",
      }),
    });
    await seedWorkflowLog({
      id: "log-6s",
      targetType: "master_products",
      targetId: "ITEM-A",
      approverRoleId: "approver_role",
      layer: 1,
    });

    const res = await callApprove({
      logId: "log-6s",
      requestId: "req-6s",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const product = await db
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, "ITEM-A"));
    expect(product[0].status).toBe("suspended");
  });

  it("master_accounts: REGISTER申請の最終承認でstatusがactiveへ反映される", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-accounts", "master_accounts", [
      { order: 1, roleId: "approver_role" },
    ]);
    await db.insert(schema.accounts).values({
      code: "1000",
      name: "現金",
      status: "temporary",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-7",
      targetType: "master_accounts",
      targetId: "1000",
      requestType: "REGISTER",
      applicantId: "applicant-1",
    });
    await seedWorkflowLog({
      id: "log-7",
      targetType: "master_accounts",
      targetId: "1000",
      approverRoleId: "approver_role",
      layer: 1,
    });

    const res = await callApprove({
      logId: "log-7",
      requestId: "req-7",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const account = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.code, "1000"));
    expect(account[0].status).toBe("active");
  });

  it("master_accounts: 無効化(suspend)申請の最終承認でstatusがsuspendedへ反映される(activeに戻らない)", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-accounts-suspend", "master_accounts", [
      { order: 1, roleId: "approver_role" },
    ]);
    await db.insert(schema.accounts).values({
      code: "1000",
      name: "現金",
      status: "temporary",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-7s",
      targetType: "master_accounts",
      targetId: "1000",
      requestType: "UPDATE",
      applicantId: "applicant-1",
      generalMemo: JSON.stringify({
        name: "現金",
        status: "suspended",
      }),
    });
    await seedWorkflowLog({
      id: "log-7s",
      targetType: "master_accounts",
      targetId: "1000",
      approverRoleId: "approver_role",
      layer: 1,
    });

    const res = await callApprove({
      logId: "log-7s",
      requestId: "req-7s",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const account = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.code, "1000"));
    expect(account[0].status).toBe("suspended");
  });

  it("master_warehouses: REGISTER申請の最終承認でstatusがactiveへ反映される", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-warehouses", "master_warehouses", [
      { order: 1, roleId: "approver_role" },
    ]);
    await db.insert(schema.warehouses).values({
      id: "WH1",
      name: "東京倉庫",
      email: null,
      status: "temporary",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-8",
      targetType: "master_warehouses",
      targetId: "WH1",
      requestType: "REGISTER",
      applicantId: "applicant-1",
    });
    await seedWorkflowLog({
      id: "log-8",
      targetType: "master_warehouses",
      targetId: "WH1",
      approverRoleId: "approver_role",
      layer: 1,
    });

    const res = await callApprove({
      logId: "log-8",
      requestId: "req-8",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const warehouse = await db
      .select()
      .from(schema.warehouses)
      .where(eq(schema.warehouses.id, "WH1"));
    expect(warehouse[0].status).toBe("active");
  });

  it("master_warehouses: 無効化(suspend)申請の最終承認でstatusがsuspendedへ反映される(activeに戻らない)", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-warehouses-suspend", "master_warehouses", [
      { order: 1, roleId: "approver_role" },
    ]);
    await db.insert(schema.warehouses).values({
      id: "WH1",
      name: "東京倉庫",
      email: null,
      status: "temporary",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await seedMasterApprovalRequest({
      id: "req-8s",
      targetType: "master_warehouses",
      targetId: "WH1",
      requestType: "UPDATE",
      applicantId: "applicant-1",
      generalMemo: JSON.stringify({
        name: "東京倉庫",
        status: "suspended",
      }),
    });
    await seedWorkflowLog({
      id: "log-8s",
      targetType: "master_warehouses",
      targetId: "WH1",
      approverRoleId: "approver_role",
      layer: 1,
    });

    const res = await callApprove({
      logId: "log-8s",
      requestId: "req-8s",
      userId: "approver-1",
    });

    expect(res.status).toBe(200);
    const warehouse = await db
      .select()
      .from(schema.warehouses)
      .where(eq(schema.warehouses.id, "WH1"));
    expect(warehouse[0].status).toBe("suspended");
  });
});
