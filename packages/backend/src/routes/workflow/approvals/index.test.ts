import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as logSchema from "../../../db/audit-schema";

/**
 * Item5(取引先担当者/単位/ロケーションへの承認機能展開)で新設した3件のtarget-adapter
 * (master_contacts/master_units/master_locations)が、POST /request-update経由で
 * 実際に承認申請として正しく受け付けられることを確認する、approvalsルートの初回テスト。
 * 従来approvals配下にはテストが一切存在しなかった。
 */

vi.mock("../../../workflow-engine/notifier", () => ({
  notifyApprovalRequestSubmitted: vi.fn(async () => {}),
}));

import { approvalsRouter } from "./index";

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
  matchField: string | null = null,
  matchValue: string | null = null,
) {
  await db.insert(schema.approvalFlows).values({
    id,
    name: id,
    requestType: targetType,
    minAmount: 0,
    maxAmount: 999999999,
    isActive: true,
    matchField,
    matchValue,
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
  await db.delete(schema.masterApprovalContexts);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.workflowLogs);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.locations);
  await db.delete(schema.partnerContacts);
  await db.delete(schema.partners);
  await db.delete(schema.warehouses);
  await db.delete(schema.itemStructures);
  await db.delete(schema.items);
  // items.baseUnitCodeがunits.codeを参照するため、items削除より後にunitsを削除する
  await db.delete(schema.units);
  await db.delete(schema.roles);
  await db.delete(schema.users);
  await logDb.delete(logSchema.auditLogs);
});

async function postRequestUpdate(body: unknown) {
  return approvalsRouter.request(
    "/request-update",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe("POST /request-update", () => {
  it("必須パラメータ不足時は400を返す", async () => {
    const res = await postRequestUpdate({ targetType: "master_units" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ success: false });
  });

  it("マッチする承認フローが無い場合は400を返す", async () => {
    await seedUser("applicant-1");
    const res = await postRequestUpdate({
      targetType: "master_units",
      targetId: "PCS",
      requestType: "REGISTER",
      payload: { code: "PCS", name: "個" },
      comment: "テスト申請",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
  });

  it("master_units: REGISTER申請でmasterApprovalRequests/workflowLogsが正しく作成される", async () => {
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

    const res = await postRequestUpdate({
      targetType: "master_units",
      targetId: "PCS",
      requestType: "REGISTER",
      payload: { code: "PCS", name: "個", status: "active" },
      comment: "単位マスタ[PCS] 新規登録申請",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);

    const requests = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.targetId, "PCS"));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      targetType: "master_units",
      requestType: "REGISTER",
      status: "PENDING",
    });

    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "PCS"));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      targetType: "master_units",
      approverRoleId: "approver_role",
      layer: 1,
      status: "PENDING",
    });
  });

  it("master_units: UPDATE申請では、送信したpayloadがmasterApprovalContexts.generalMemoへJSONスナップショットとして退避される", async () => {
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

    const res = await postRequestUpdate({
      targetType: "master_units",
      targetId: "PCS",
      requestType: "UPDATE",
      payload: { code: "PCS", name: "改名後の個数", status: "active" },
      comment: "単位マスタ[PCS] 情報変更申請",
    });

    expect(res.status).toBe(200);

    const requests = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.targetId, "PCS"));
    expect(requests[0].requestType).toBe("UPDATE");

    const contexts = await db
      .select()
      .from(schema.masterApprovalContexts)
      .where(eq(schema.masterApprovalContexts.requestId, requests[0].id));
    expect(contexts).toHaveLength(1);
    const snapshot = JSON.parse(contexts[0].generalMemo!);
    expect(snapshot).toMatchObject({ name: "改名後の個数", status: "active" });
  });

  it("master_locations: REGISTER申請が正しく受け付けられる", async () => {
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

    const res = await postRequestUpdate({
      targetType: "master_locations",
      targetId: "LOC1",
      requestType: "REGISTER",
      payload: { id: "LOC1", warehouseId: "WH1", name: "棚A", status: "active" },
      comment: "ロケーションマスタ[LOC1] 新規登録申請",
    });

    expect(res.status).toBe(200);
    const requests = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.targetId, "LOC1"));
    expect(requests[0]).toMatchObject({
      targetType: "master_locations",
      requestType: "REGISTER",
      status: "PENDING",
    });
  });

  it("master_contacts: REGISTER申請が正しく受け付けられる", async () => {
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

    const res = await postRequestUpdate({
      targetType: "master_contacts",
      targetId: "C-1",
      requestType: "REGISTER",
      payload: {
        id: "C-1",
        partnerId: "P-1",
        contactType: "CUSTOMER_CONTACT",
        name: "山田太郎",
        status: "active",
      },
      comment: "取引先担当者マスタ[C-1] 新規登録申請",
    });

    expect(res.status).toBe(200);
    const requests = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.targetId, "C-1"));
    expect(requests[0]).toMatchObject({
      targetType: "master_contacts",
      requestType: "REGISTER",
      status: "PENDING",
    });
  });

  it("master_structures: REGISTER申請が正しく受け付けられる(Phase6)", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedApprovalFlow("flow-structures", "master_structures", [
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
    await db.insert(schema.items).values([
      {
        id: "ITEM-A",
        name: "親品目A",
        baseUnitCode: "PCS",
        status: "active",
        createdBy: "applicant-1",
        createdAt: now,
        updatedBy: "applicant-1",
        updatedAt: now,
      },
      {
        id: "ITEM-B",
        name: "子品目B",
        baseUnitCode: "PCS",
        status: "active",
        createdBy: "applicant-1",
        createdAt: now,
        updatedBy: "applicant-1",
        updatedAt: now,
      },
    ]);
    await db.insert(schema.itemStructures).values({
      id: "BOM-1",
      parentItemId: "ITEM-A",
      childItemId: "ITEM-B",
      quantityRequired: 2,
      revision: "1.0",
      validFrom: now,
      status: "temporary",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });

    const res = await postRequestUpdate({
      targetType: "master_structures",
      targetId: "BOM-1",
      requestType: "REGISTER",
      payload: {
        parentItemId: "ITEM-A",
        childItemId: "ITEM-B",
        quantityRequired: 2,
        revision: "1.0",
        status: "active",
      },
      comment: "部品構成 新規登録申請",
    });

    expect(res.status).toBe(200);
    const requests = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.targetId, "BOM-1"));
    expect(requests[0]).toMatchObject({
      targetType: "master_structures",
      requestType: "REGISTER",
      status: "PENDING",
    });
  });

  it("Item9 Phase2: matchField/matchValueが一致する具体的フローが、未設定の汎用フローより優先してマッチする", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedRole("specific_role");
    // 同一targetType・同一金額帯に、汎用フロー(matchField未設定)と
    // 具体的フロー(matchField=status,matchValue=active)の2つを定義する。
    await seedApprovalFlow("flow-generic", "master_units", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedApprovalFlow(
      "flow-specific",
      "master_units",
      [{ order: 1, roleId: "specific_role" }],
      "status",
      "active",
    );
    await db.insert(schema.units).values({
      code: "PCS",
      name: "個",
      status: "temporary",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });

    const res = await postRequestUpdate({
      targetType: "master_units",
      targetId: "PCS",
      requestType: "REGISTER",
      payload: { code: "PCS", name: "個", status: "active" },
      comment: "単位マスタ[PCS] 新規登録申請",
    });

    expect(res.status).toBe(200);
    const requests = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.targetId, "PCS"));
    expect(requests[0].flowId).toBe("flow-specific");

    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "PCS"));
    expect(logs[0].approverRoleId).toBe("specific_role");
  });

  it("Item9 Phase2: matchValueに一致しない場合は、matchField未設定の汎用フローにフォールバックする", async () => {
    await seedUser("applicant-1");
    await seedRole("approver_role");
    await seedRole("specific_role");
    await seedApprovalFlow("flow-generic", "master_units", [
      { order: 1, roleId: "approver_role" },
    ]);
    await seedApprovalFlow(
      "flow-specific",
      "master_units",
      [{ order: 1, roleId: "specific_role" }],
      "status",
      "active",
    );
    await db.insert(schema.units).values({
      code: "PCS",
      name: "個",
      status: "temporary",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });

    const res = await postRequestUpdate({
      targetType: "master_units",
      targetId: "PCS",
      requestType: "REGISTER",
      payload: { code: "PCS", name: "個", status: "suspended" },
      comment: "単位マスタ[PCS] 新規登録申請",
    });

    expect(res.status).toBe(200);
    const requests = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.targetId, "PCS"));
    expect(requests[0].flowId).toBe("flow-generic");

    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "PCS"));
    expect(logs[0].approverRoleId).toBe("approver_role");
  });
});
