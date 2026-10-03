import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";
import { salesOrdersRouter } from "./index";
import { WorkflowTasksService } from "../../workflow/workflow-tasks/workflow-tasks.service";

// #14-2⑥: 元々2401行あったsales-order.service.test.tsから、承認ワークフロー(下書き保存時の
// 与信確認・在庫不足警告、申請提出、削除申請、承認確定/差戻し確定によるsales-orders.adapter.ts
// の反映)の部分を分割したもの。ロジック変更なし。ヘルパー関数は既存の慣習(payment-crud.test.ts/
// payment-csv.test.ts、purchase-requisition-crud/csv.service.test.ts)にならい、分割後の各
// ファイルにそのまま複製している(共通ファイル化はしない)。

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
  const res = await salesOrdersRouter.request(
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
  const res = await salesOrdersRouter.request(
    `/${id}/request-deletion`,
    { method: "POST", headers: { Cookie: await buildSessionCookieHeader(actorUserId) } },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function callCreateOrder(actorUserId: string, payload: unknown) {
  const formData = new FormData();
  formData.append("orderData", JSON.stringify(payload));
  const ctx = createExecutionContext();
  const res = await salesOrdersRouter.request(
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

async function callUpdateOrder(id: string, actorUserId: string, payload: unknown) {
  const formData = new FormData();
  formData.append("orderData", JSON.stringify(payload));
  const ctx = createExecutionContext();
  const res = await salesOrdersRouter.request(
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

async function seedPartner(id: string, overrides: Partial<typeof schema.partners.$inferInsert> = {}) {
  await db.insert(schema.partners).values({
    id,
    name: `取引先${id}`,
    creditLimit: 0,
    createdBy: id,
    createdAt: now,
    updatedBy: id,
    updatedAt: now,
    ...overrides,
  });
}

async function seedApprovalFlow(
  id: string,
  requestType: string,
  steps: Array<{ order: number; roleId: string }>,
  amountRange: { min: number; max: number } = { min: 0, max: 999999999 },
) {
  await db.insert(schema.approvalFlows).values({
    id,
    name: id,
    requestType,
    minAmount: amountRange.min,
    maxAmount: amountRange.max,
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

async function seedOrder(
  id: string,
  overrides: Partial<typeof schema.salesOrders.$inferInsert> = {},
) {
  await db.insert(schema.salesOrders).values({
    id,
    title: `受注${id}`,
    partnerId: "partner-1",
    orderDate: now,
    status: "DRAFT",
    totalAmount: 10000,
    taxAmount: 1000,
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
    ...overrides,
  });
}

async function seedOrderItem(
  salesOrderId: string,
  overrides: Partial<typeof schema.salesOrderItems.$inferInsert> = {},
) {
  await db.insert(schema.salesOrderItems).values({
    id: crypto.randomUUID(),
    salesOrderId,
    itemId: "ITEM-1",
    itemName: "テスト品目",
    quantity: 1,
    unitPrice: 1000,
    amount: 1000,
    sortOrder: 0,
    ...overrides,
  });
}

async function seedItemMasterAndStock(itemId: string, stockQuantity: number) {
  await db.insert(schema.units).values({
    code: "PCS",
    name: "個",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.accounts).values({
    code: "ACC1",
    name: "品目",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.warehouses).values({
    id: "WH1",
    name: "本社倉庫",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.locations).values({
    id: "LOC1",
    warehouseId: "WH1",
    name: "A-1",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.items).values({
    id: itemId,
    name: `テスト品目${itemId}`,
    baseUnitCode: "PCS",
    accountCode: "ACC1",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.stocks).values({
    id: `STOCK-${itemId}`,
    itemId,
    warehouseId: "WH1",
    locationId: "LOC1",
    lotNumber: "NONE",
    accountCode: "ACC1",
    qualityStatus: "NORMAL",
    quantity: stockQuantity,
    updatedAt: now,
  });
}

// Item7残課題2-5: 倉庫単位引当への切替に伴い、warehouseStockReservationsを全倉庫合算で参照する
// Item7残課題2-5: 複数倉庫にまたがるテスト用に、既存の品目に対して別倉庫の在庫を追加する
async function seedStockAtWarehouse(itemId: string, warehouseId: string, warehouseName: string, quantity: number) {
  await db.insert(schema.warehouses).values({
    id: warehouseId,
    name: warehouseName,
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.locations).values({
    id: `LOC-${warehouseId}`,
    warehouseId,
    name: "A-1",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.stocks).values({
    id: `STOCK-${itemId}-${warehouseId}`,
    itemId,
    warehouseId,
    locationId: `LOC-${warehouseId}`,
    lotNumber: "NONE",
    accountCode: "ACC1",
    qualityStatus: "NORMAL",
    quantity,
    updatedAt: now,
  });
}

async function findReservedQuantity(itemId: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.warehouseStockReservations)
    .where(eq(schema.warehouseStockReservations.itemId, itemId));
  return rows.reduce((sum, r) => sum + r.reservedQuantity, 0);
}

async function findOrderItemBackorder(salesOrderId: string, itemId: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.salesOrderItems)
    .where(
      and(
        eq(schema.salesOrderItems.salesOrderId, salesOrderId),
        eq(schema.salesOrderItems.itemId, itemId),
      ),
    );
  return rows.reduce((sum, r) => sum + (r.backorderedQuantity ?? 0), 0);
}

async function enableSalesOrderApprovalWorkflow() {
  await env.COMPANY_SETTINGS.put(
    "config",
    JSON.stringify({ is_sales_order_approval_enabled: true }),
  );
}

async function findOrder(id: string) {
  const rows = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, id));
  return rows[0] ?? null;
}

async function findPendingRequestByTarget(targetId: string) {
  return await db
    .select()
    .from(schema.masterApprovalRequests)
    .where(eq(schema.masterApprovalRequests.targetId, targetId));
}

beforeEach(async () => {
  await db.delete(schema.salesOrderHistoryLogs);
  await db.delete(schema.salesOrderAttachments);
  // Item7残課題6: 受注→出荷指示/出庫の消込連携テスト用の後始末(salesOrderItemsを消す前に削除する必要がある)
  await db.delete(schema.itemShipmentItems);
  await db.delete(schema.itemShipmentHeaders);
  await db.delete(schema.itemShipmentInstructionItems);
  await db.delete(schema.itemShipmentInstructions);
  // 追加要望対応: 売上計上済みの受注明細を再インポートしてもエラーにならないことのテスト用
  // (salesInvoiceItems.sourceOrderItemIdがsalesOrderItems.idをFK参照するため、
  // salesOrderItemsを消す前に削除する必要がある)
  await db.delete(schema.salesInvoiceItems);
  await db.delete(schema.salesInvoices);
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  await db.delete(schema.quoteItems);
  await db.delete(schema.quotes);
  await db.delete(schema.itemStockReservations);
  await db.delete(schema.salesOrderItemReservations);
  await db.delete(schema.warehouseStockReservations);
  await db.delete(schema.stocks);
  await db.delete(schema.locations);
  await db.delete(schema.warehouses);
  await db.delete(schema.items);
  // journal_posting_rulesがaccountsをFK参照するため、accountsの削除より先に消す必要がある
  await db.delete(schema.journalPostingEvents);
  await db.delete(schema.journalPostingRules);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
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

  await seedUser("applicant-1");
  await seedPartner("partner-1");
});

describe("下書き保存時の与信確認(警告のみ、承認機能の有効無効に関わらず実施)", () => {
  it("POST /register 時、与信限度を超えていても保存自体は成功し、warningフィールドが返る", async () => {
    await seedPartner("partner-low", { creditLimit: 100 });
    const res = await callCreateOrder("applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-low",
      title: "新規受注",
      totalAmount: 999999,
      items: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warning?: string; id: string };
    expect(body.warning).toContain("与信限度額を超過しています");
    expect(await findOrder(body.id)).not.toBeNull();
  });

  it("PUT /:id 時、与信限度を超えていても更新自体は成功し、warningフィールドが返る", async () => {
    await seedPartner("partner-low", { creditLimit: 100 });
    await seedOrder("O-1", { status: "DRAFT", partnerId: "partner-low", totalAmount: 100 });
    const res = await callUpdateOrder("O-1", "applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-low",
      title: "更新後タイトル",
      totalAmount: 999999,
      items: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warning?: string };
    expect(body.warning).toContain("与信限度額を超過しています");
    expect((await findOrder("O-1"))?.title).toBe("更新後タイトル");
  });

  it("与信限度内であればwarningは含まれない", async () => {
    await seedPartner("partner-ok", { creditLimit: 10000 });
    const res = await callCreateOrder("applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-ok",
      title: "新規受注",
      totalAmount: 5000,
      items: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warning?: string };
    expect(body.warning).toBeUndefined();
  });
});

describe("Item7残課題2-5: 在庫不足の事前警告(与信警告と同じ非破壊プレビュー、承認機能の有効無効に関わらず実施)", () => {
  it("POST /register 時、在庫が不足していても保存自体は成功し、warningフィールドに在庫不足が含まれる(実際の引当は行われない)", async () => {
    await seedItemMasterAndStock("ITEM-1", 10);
    const res = await callCreateOrder("applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      title: "新規受注",
      totalAmount: 1000,
      items: [{ itemId: "ITEM-1", quantity: 30, unitPrice: 100, inputType: "MASTER" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warning?: string; id: string };
    expect(body.warning).toContain("在庫が不足している可能性がある");
    // プレビューのみで実際の引当(warehouse_stock_reservations)はまだ行われない
    expect(await findReservedQuantity("ITEM-1")).toBe(0);
  });

  it("PUT /:id 時も同様に在庫不足を警告する", async () => {
    await seedItemMasterAndStock("ITEM-1", 10);
    await seedOrder("O-1", { status: "DRAFT" });
    const res = await callUpdateOrder("O-1", "applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      title: "更新後タイトル",
      totalAmount: 1000,
      items: [{ itemId: "ITEM-1", quantity: 30, unitPrice: 100, inputType: "MASTER" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warning?: string };
    expect(body.warning).toContain("在庫が不足している可能性がある");
  });

  it("承認機能ON: フォローアップ6以降、承認申請(PENDING_APPROVAL)時点で実際に在庫が引き当てられ、不足分はバックオーダー警告になる", async () => {
    await seedItemMasterAndStock("ITEM-1", 10);
    await enableSalesOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 30, inputType: "MASTER" });

    const res = await callSubmitForApproval("O-1", "applicant-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warning?: string };
    expect(body.warning).toContain("バックオーダー");
    expect((await findOrder("O-1"))?.status).toBe("PENDING_APPROVAL");
    // 在庫は早い者勝ちの性格を持つため、与信と異なり承認フロー起動と同時に確保する
    expect(await findReservedQuantity("ITEM-1")).toBe(10);
    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(20);
  });

  it("全体では足りていても、手動指定した倉庫単体では足りない場合も警告する", async () => {
    await seedItemMasterAndStock("ITEM-1", 100); // WH1: 100(全体では十分)
    await seedStockAtWarehouse("ITEM-1", "WH2", "第二倉庫", 5);
    const res = await callCreateOrder("applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      title: "新規受注",
      totalAmount: 1000,
      items: [
        {
          itemId: "ITEM-1",
          quantity: 15,
          unitPrice: 100,
          inputType: "MASTER",
          warehouseAllocationRequest: JSON.stringify([{ warehouseId: "WH2", quantity: 15 }]),
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warning?: string };
    expect(body.warning).toContain("指定倉庫の在庫が不足");
    expect(body.warning).toContain("WH2");
  });

  it("在庫が十分であればwarningは含まれない", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    const res = await callCreateOrder("applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      title: "新規受注",
      totalAmount: 1000,
      items: [{ itemId: "ITEM-1", quantity: 30, unitPrice: 100, inputType: "MASTER" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warning?: string };
    expect(body.warning).toBeUndefined();
  });
});

describe("POST /:id/submit-for-approval", () => {
  it("DRAFT以外の受注は申請できない(400)", async () => {
    await seedOrder("O-1", { status: "APPROVED" });
    const res = await callSubmitForApproval("O-1", "applicant-1");
    expect(res.status).toBe(400);
  });

  it("承認機能OFFの場合は直接APPROVEDに確定するが、与信超過時は警告付きで返る(ブロックしない)", async () => {
    await seedPartner("partner-low", { creditLimit: 100 });
    await seedOrder("O-1", { status: "DRAFT", partnerId: "partner-low", totalAmount: 999999 });
    const res = await callSubmitForApproval("O-1", "applicant-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warning?: string };
    expect(body.warning).toContain("与信限度額を超過しています");
    const order = await findOrder("O-1");
    expect(order?.status).toBe("APPROVED");
    expect(await findPendingRequestByTarget("O-1")).toHaveLength(0);
  });

  it("承認機能ONだが合致する承認フローが無い場合は400になり、ステータスはDRAFTのまま戻る", async () => {
    await enableSalesOrderApprovalWorkflow();
    await seedOrder("O-1", { status: "DRAFT" });
    const res = await callSubmitForApproval("O-1", "applicant-1");
    expect(res.status).toBe(400);
    const order = await findOrder("O-1");
    expect(order?.status).toBe("DRAFT");
  });

  it("承認機能ONかつ承認フローが定義されている場合、PENDING_APPROVALになりPENDING申請が作られる", async () => {
    await enableSalesOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedOrder("O-1", { status: "DRAFT", totalAmount: 5000 });

    const res = await callSubmitForApproval("O-1", "applicant-1");
    expect(res.status).toBe(200);

    const order = await findOrder("O-1");
    expect(order?.status).toBe("PENDING_APPROVAL");

    const requests = await findPendingRequestByTarget("O-1");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      targetType: "sales_orders",
      requestType: "REGISTER",
      status: "PENDING",
      applicantId: "applicant-1",
    });
  });

  it("追加要望F: 申請者の実際の所属部署を指定した場合、masterApprovalRequestsにapplicantDepartmentSurrogateIdとして保存される", async () => {
    await enableSalesOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedDepartment("dept-a", "D001", "営業統括部");
    await seedUserRole("applicant-1", "approver_role", "dept-a");
    await seedApprovalFlow("flow-1", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedOrder("O-1", { status: "DRAFT", totalAmount: 5000 });

    const res = await callSubmitForApproval("O-1", "applicant-1", {
      applicantDepartmentSurrogateId: "dept-a",
    });
    expect(res.status).toBe(200);

    const requests = await findPendingRequestByTarget("O-1");
    expect(requests[0].applicantDepartmentSurrogateId).toBe("dept-a");
  });

  describe("与信確認(承認機能の有効無効に関わらず実施、警告のみでブロックしない)", () => {
    it("creditLimit未設定(0)の取引先は与信チェックをスキップし、金額に関わらず申請できる", async () => {
      await enableSalesOrderApprovalWorkflow();
      await seedRole("approver_role");
      await seedUser("approver-1");
      await seedUserRole("approver-1", "approver_role");
      await seedApprovalFlow("flow-1", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
      await seedPartner("partner-nolimit", { creditLimit: 0 });
      await seedOrder("O-1", { status: "DRAFT", partnerId: "partner-nolimit", totalAmount: 999999999 });

      const res = await callSubmitForApproval("O-1", "applicant-1");
      expect(res.status).toBe(200);
      expect((await findOrder("O-1"))?.status).toBe("PENDING_APPROVAL");
    });

    it("既存の承認済み受注合計+今回の金額がcreditLimitを超える場合、警告付きで200になり申請は進む(ブロックしない)", async () => {
      await enableSalesOrderApprovalWorkflow();
      await seedRole("approver_role");
      await seedUser("approver-1");
      await seedUserRole("approver-1", "approver_role");
      await seedApprovalFlow("flow-1", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
      await seedPartner("partner-limited", { creditLimit: 10000 });
      await seedOrder("O-existing", {
        status: "APPROVED",
        partnerId: "partner-limited",
        totalAmount: 9000,
      });
      await seedOrder("O-1", { status: "DRAFT", partnerId: "partner-limited", totalAmount: 2000 });

      const res = await callSubmitForApproval("O-1", "applicant-1");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { warning?: string };
      expect(body.warning).toContain("与信限度額を超過しています");
      expect((await findOrder("O-1"))?.status).toBe("PENDING_APPROVAL");
    });

    it("既存の承認済み受注合計+今回の金額がcreditLimit以内なら申請できる", async () => {
      await enableSalesOrderApprovalWorkflow();
      await seedRole("approver_role");
      await seedUser("approver-1");
      await seedUserRole("approver-1", "approver_role");
      await seedApprovalFlow("flow-1", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
      await seedPartner("partner-ok", { creditLimit: 10000 });
      await seedOrder("O-existing", {
        status: "APPROVED",
        partnerId: "partner-ok",
        totalAmount: 5000,
      });
      await seedOrder("O-1", { status: "DRAFT", partnerId: "partner-ok", totalAmount: 5000 });

      const res = await callSubmitForApproval("O-1", "applicant-1");
      expect(res.status).toBe(200);
      expect((await findOrder("O-1"))?.status).toBe("PENDING_APPROVAL");
    });

    it("他の取引先の承認済み受注は与信消費額に含まれない", async () => {
      await enableSalesOrderApprovalWorkflow();
      await seedRole("approver_role");
      await seedUser("approver-1");
      await seedUserRole("approver-1", "approver_role");
      await seedApprovalFlow("flow-1", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
      await seedPartner("partner-a", { creditLimit: 1000 });
      await seedPartner("partner-b", { creditLimit: 1000 });
      await seedOrder("O-other-partner", {
        status: "APPROVED",
        partnerId: "partner-b",
        totalAmount: 999999,
      });
      await seedOrder("O-1", { status: "DRAFT", partnerId: "partner-a", totalAmount: 500 });

      const res = await callSubmitForApproval("O-1", "applicant-1");
      expect(res.status).toBe(200);
    });
  });
});

describe("POST /:id/request-deletion", () => {
  it("未申請のDRAFTは承認不要で直接削除される", async () => {
    await enableSalesOrderApprovalWorkflow();
    await seedOrder("O-1", { status: "DRAFT" });
    const res = await callRequestDeletion("O-1", "applicant-1");
    expect(res.status).toBe(200);
    expect(await findOrder("O-1")).toBeNull();
  });

  it("承認機能ONの場合、APPROVED済みの受注はPENDING_DELETIONになり削除申請が作られる", async () => {
    await enableSalesOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedOrder("O-1", { status: "APPROVED" });

    const res = await callRequestDeletion("O-1", "applicant-1");
    expect(res.status).toBe(200);

    const order = await findOrder("O-1");
    expect(order?.status).toBe("PENDING_DELETION");

    const requests = await findPendingRequestByTarget("O-1");
    expect(requests).toHaveLength(1);
    expect(requests[0].requestType).toBe("DELETE");
  });
});

describe("承認確定(WorkflowTasksService.approveTask)によるsales-orders.adapter.tsの反映", () => {
  it("REGISTER申請(初回承認)が最終承認されると、sales_orders.statusがAPPROVEDになる", async () => {
    await enableSalesOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedOrder("O-1", { status: "DRAFT" });

    await callSubmitForApproval("O-1", "applicant-1");
    const requests = await findPendingRequestByTarget("O-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "O-1"));

    const res = await callApproveTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(res.status).toBe(200);
    expect((await findOrder("O-1"))?.status).toBe("APPROVED");
  });

  it("DELETE申請が最終承認されると、受注が物理削除される", async () => {
    await enableSalesOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedOrder("O-1", { status: "APPROVED" });

    await callRequestDeletion("O-1", "applicant-1");
    const requests = await findPendingRequestByTarget("O-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "O-1"));

    const res = await callApproveTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(res.status).toBe(200);
    expect(await findOrder("O-1")).toBeNull();
  });
});

describe("差戻し確定(WorkflowTasksService.remandTask)によるsales-orders.adapter.tsの反映", () => {
  it("REGISTER申請の差戻しで、sales_orders.statusがDRAFTへ自動的に戻る", async () => {
    await enableSalesOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedOrder("O-1", { status: "DRAFT" });

    await callSubmitForApproval("O-1", "applicant-1");
    const requests = await findPendingRequestByTarget("O-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "O-1"));

    const res = await callRemandTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(res.status).toBe(200);
    expect((await findOrder("O-1"))?.status).toBe("DRAFT");
  });
});
