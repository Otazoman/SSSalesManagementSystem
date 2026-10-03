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

// #14-2⑥: 元々2401行あったsales-order.service.test.tsから、在庫引当(ハード引当)・バックオーダー・
// 欠品自動提案・関連する受注一覧検索(バックオーダー有無・注残有無)の部分を分割したもの。
// ロジック変更なし。ヘルパー関数は既存の慣習(payment-crud.test.ts/payment-csv.test.ts、
// purchase-requisition-crud/csv.service.test.ts)にならい、分割後の各ファイルにそのまま複製
// している(共通ファイル化はしない)。

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
  app.post("/cancel", async (c) => {
    const body = await c.req.json();
    const result = await WorkflowTasksService.cancelTask(c, db, body);
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

async function callRetryBackorder(id: string, actorUserId: string) {
  const ctx = createExecutionContext();
  const res = await salesOrdersRouter.request(
    `/${id}/retry-backorder`,
    { method: "POST", headers: { Cookie: await buildSessionCookieHeader(actorUserId) } },
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

// Item7残課題2-5フォローアップ6: 承認済み受注への変更申請は、汎用のPOST /api/approvals/request-update
// ではなく、申請提出時点で在庫を確保する専用エンドポイント(POST /:id/submit-update)を使う
async function callSubmitUpdateForApproval(
  id: string,
  actorUserId: string,
  body: {
    header: Record<string, unknown>;
    items: unknown[];
    comment?: string;
    applicantDepartmentSurrogateId?: string | null;
  },
) {
  const ctx = createExecutionContext();
  const res = await salesOrdersRouter.request(
    `/${id}/submit-update`,
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

async function callBulkImportCsv(actorUserId: string, csvContent: string) {
  const formData = new FormData();
  formData.append("file", new File([csvContent], "orders.csv", { type: "text/csv" }));
  const ctx = createExecutionContext();
  const res = await salesOrdersRouter.request(
    "/bulk-register",
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

async function callSearchOrders(actorUserId: string, query: string) {
  const ctx = createExecutionContext();
  const res = await salesOrdersRouter.request(
    `/?${query}`,
    { method: "GET", headers: { Cookie: await buildSessionCookieHeader(actorUserId) } },
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

async function findReservationsByWarehouse(itemId: string): Promise<Record<string, number>> {
  const rows = await db
    .select()
    .from(schema.warehouseStockReservations)
    .where(eq(schema.warehouseStockReservations.itemId, itemId));
  const result: Record<string, number> = {};
  for (const r of rows) result[r.warehouseId] = r.reservedQuantity;
  return result;
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

describe("Item7: 在庫引当(ハード引当)", () => {
  it("承認機能OFFで確定すると、在庫が十分な場合はreservedQuantityが加算される", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 30, inputType: "MASTER" });

    const res = await callSubmitForApproval("O-1", "applicant-1");
    expect(res.status).toBe(200);
    expect((await findOrder("O-1"))?.status).toBe("APPROVED");
    expect(await findReservedQuantity("ITEM-1")).toBe(30);
  });

  it("Item7残課題2-5: 在庫が不足している場合も承認はブロックされず、確保できた分だけ引き当てて残りはバックオーダーになる", async () => {
    await seedItemMasterAndStock("ITEM-1", 10);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 30, inputType: "MASTER" });

    const res = await callSubmitForApproval("O-1", "applicant-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warning?: string };
    expect(body.warning).toContain("バックオーダー");
    expect((await findOrder("O-1"))?.status).toBe("APPROVED");
    expect(await findReservedQuantity("ITEM-1")).toBe(10);
    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(20);
  });

  it("既存の引当済み数量を差し引いた利用可能数量で判定する(2件目の受注は残りしか確保できず、不足分はバックオーダーになる)", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 80, inputType: "MASTER" });
    await callSubmitForApproval("O-1", "applicant-1");
    expect(await findReservedQuantity("ITEM-1")).toBe(80);

    await seedOrder("O-2", { status: "DRAFT" });
    await seedOrderItem("O-2", { itemId: "ITEM-1", quantity: 30, inputType: "MASTER" });
    const res2 = await callSubmitForApproval("O-2", "applicant-1");
    expect(res2.status).toBe(200);
    expect((await findOrder("O-2"))?.status).toBe("APPROVED");
    expect(await findReservedQuantity("ITEM-1")).toBe(100);
    expect(await findOrderItemBackorder("O-2", "ITEM-1")).toBe(10);
  });

  it("DIRECT入力(itemsマスタに無い自由入力品目)は在庫チェックの対象外で、常に確定できる", async () => {
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", {
      itemId: "DIRECT-ITEM-XYZ",
      quantity: 99999,
      inputType: "DIRECT",
    });

    const res = await callSubmitForApproval("O-1", "applicant-1");
    expect(res.status).toBe(200);
    expect((await findOrder("O-1"))?.status).toBe("APPROVED");
    expect(await findReservedQuantity("DIRECT-ITEM-XYZ")).toBe(0);
  });

  it("承認済み受注が削除されると、保持していた引当が解放される", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 40, inputType: "MASTER" });
    await callSubmitForApproval("O-1", "applicant-1");
    expect(await findReservedQuantity("ITEM-1")).toBe(40);

    await enableSalesOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-del", "sales_orders", [{ order: 1, roleId: "approver_role" }]);

    const delRes = await callRequestDeletion("O-1", "applicant-1");
    expect(delRes.status).toBe(200);
    expect((await findOrder("O-1"))?.status).toBe("PENDING_DELETION");
    // 削除申請提出の時点ではまだ削除は確定していないため引当は維持される
    expect(await findReservedQuantity("ITEM-1")).toBe(40);

    const requests = await findPendingRequestByTarget("O-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "O-1"));
    const approveRes = await callApproveTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(approveRes.status).toBe(200);
    expect(await findOrder("O-1")).toBeNull();
    expect(await findReservedQuantity("ITEM-1")).toBe(0);
  });

  it("BUG-049: 承認済み受注を削除しても、他の受注の引当は減らない(削除した受注の分を二重に解放しない)", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 40, inputType: "MASTER" });
    await seedOrder("O-2", { status: "DRAFT" });
    await seedOrderItem("O-2", { itemId: "ITEM-1", quantity: 30, inputType: "MASTER" });
    await callSubmitForApproval("O-1", "applicant-1");
    await callSubmitForApproval("O-2", "applicant-1");
    expect(await findReservedQuantity("ITEM-1")).toBe(70);

    const delRes = await callRequestDeletion("O-1", "applicant-1");
    expect(delRes.status).toBe(200);
    expect(await findOrder("O-1")).toBeNull();
    expect(await findReservedQuantity("ITEM-1")).toBe(30);
  });

  it("承認機能ON: フォローアップ6以降、在庫は最終承認確定を待たず承認申請(REGISTER)時点で引き当てられ、最終承認確定後も維持される", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    await enableSalesOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 25, inputType: "MASTER" });

    await callSubmitForApproval("O-1", "applicant-1");
    expect(await findReservedQuantity("ITEM-1")).toBe(25);

    const requests = await findPendingRequestByTarget("O-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "O-1"));
    const res = await callApproveTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(res.status).toBe(200);
    expect((await findOrder("O-1"))?.status).toBe("APPROVED");
    expect(await findReservedQuantity("ITEM-1")).toBe(25);
  });

  it("Item7残課題2-5フォローアップ6: 承認機能ON、REGISTER申請が差戻しされた場合、DRAFTへ戻ると同時に申請時点の在庫引当も解放される", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    await enableSalesOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 25, inputType: "MASTER" });

    await callSubmitForApproval("O-1", "applicant-1");
    expect(await findReservedQuantity("ITEM-1")).toBe(25);

    const requests = await findPendingRequestByTarget("O-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "O-1"));
    const remandRes = await callRemandTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(remandRes.status).toBe(200);
    expect((await findOrder("O-1"))?.status).toBe("DRAFT");
    expect(await findReservedQuantity("ITEM-1")).toBe(0);
  });

  it("Item7残課題2-5フォローアップ6: 承認機能ON、REGISTER申請が申請者により取り下げられた場合も、DRAFTへ戻ると同時に在庫引当が解放される", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    await enableSalesOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-1", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 25, inputType: "MASTER" });

    await callSubmitForApproval("O-1", "applicant-1");
    expect(await findReservedQuantity("ITEM-1")).toBe(25);

    const requests = await findPendingRequestByTarget("O-1");
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "O-1"));
    const cancelRes = await callCancelTask({ targetId: "O-1", logId: logs[0].id, userId: "applicant-1" });
    expect(cancelRes.status).toBe(200);
    expect((await findOrder("O-1"))?.status).toBe("DRAFT");
    expect(await findReservedQuantity("ITEM-1")).toBe(0);
  });

  it("同一受注内に同じ品目が複数明細ある場合、明細ごとに引き当てても合計は正しく積み上がる", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 30, inputType: "MASTER", sortOrder: 0 });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 40, inputType: "MASTER", sortOrder: 1 });

    const res = await callSubmitForApproval("O-1", "applicant-1");
    expect(res.status).toBe(200);
    expect(await findReservedQuantity("ITEM-1")).toBe(70);
  });

  it("Item7残課題2-5: 倉庫指定が無い場合、在庫が多い倉庫から順に自動でFIFO割当し、複数倉庫にまたがってもよい", async () => {
    await seedItemMasterAndStock("ITEM-1", 20); // WH1: 20
    await seedStockAtWarehouse("ITEM-1", "WH2", "第二倉庫", 15);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 30, inputType: "MASTER" });

    const res = await callSubmitForApproval("O-1", "applicant-1");
    expect(res.status).toBe(200);
    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(0);
    // 在庫が多い倉庫(WH1:20)から優先的に確保し、不足分(10)をWH2から補う
    expect(await findReservationsByWarehouse("ITEM-1")).toEqual({ WH1: 20, WH2: 10 });
  });

  it("Item7残課題2-5: 手動で倉庫内訳を指定した場合はその通りに引き当てる", async () => {
    await seedItemMasterAndStock("ITEM-1", 20); // WH1: 20
    await seedStockAtWarehouse("ITEM-1", "WH2", "第二倉庫", 20);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", {
      itemId: "ITEM-1",
      quantity: 15,
      inputType: "MASTER",
      warehouseAllocationRequest: JSON.stringify([{ warehouseId: "WH2", quantity: 15 }]),
    });

    const res = await callSubmitForApproval("O-1", "applicant-1");
    expect(res.status).toBe(200);
    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(0);
    expect(await findReservationsByWarehouse("ITEM-1")).toEqual({ WH2: 15 });
  });

  it("Item7残課題2-5: 手動指定した倉庫の在庫が足りない場合、確保できる分だけ引き当てて残りはバックオーダーになる(自動で他倉庫へは振り替えない)", async () => {
    await seedItemMasterAndStock("ITEM-1", 100); // WH1: 100(十分にあるが指定していない)
    await seedStockAtWarehouse("ITEM-1", "WH2", "第二倉庫", 5);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", {
      itemId: "ITEM-1",
      quantity: 15,
      inputType: "MASTER",
      warehouseAllocationRequest: JSON.stringify([{ warehouseId: "WH2", quantity: 15 }]),
    });

    const res = await callSubmitForApproval("O-1", "applicant-1");
    expect(res.status).toBe(200);
    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(10);
    expect(await findReservationsByWarehouse("ITEM-1")).toEqual({ WH2: 5 });
  });

  it("Item7残課題2-5: バックオーダーの手動再引当(retry-backorder)で、在庫が復活した分だけ解消される", async () => {
    await seedItemMasterAndStock("ITEM-1", 10);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 30, inputType: "MASTER" });
    await callSubmitForApproval("O-1", "applicant-1");
    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(20);

    // 対象外(APPROVEDでない受注)は拒否される
    await seedOrder("O-DRAFT", { status: "DRAFT" });
    const rejectedRes = await callRetryBackorder("O-DRAFT", "applicant-1");
    expect(rejectedRes.status).toBe(400);

    // 入庫等で在庫が復活したケースを模す(WH1の在庫を追加)
    await seedStockAtWarehouse("ITEM-1", "WH2", "第二倉庫", 5);

    const retryRes = await callRetryBackorder("O-1", "applicant-1");
    expect(retryRes.status).toBe(200);
    const body = (await retryRes.json()) as { message: string; resolvedCount: number; stillBackorderedCount: number };
    expect(body.stillBackorderedCount).toBe(1);
    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(15);
    expect(await findReservedQuantity("ITEM-1")).toBe(15);

    // 再度不足分がちょうど埋まるまで在庫を追加すると完全に解消される
    await seedStockAtWarehouse("ITEM-1", "WH3", "第三倉庫", 15);
    const retryRes2 = await callRetryBackorder("O-1", "applicant-1");
    expect(retryRes2.status).toBe(200);
    const body2 = (await retryRes2.json()) as { resolvedCount: number; stillBackorderedCount: number };
    expect(body2.stillBackorderedCount).toBe(0);
    expect(body2.resolvedCount).toBe(1);
    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(0);
    expect(await findReservedQuantity("ITEM-1")).toBe(30);
  });
});

describe("Item7残課題2-5: 受注一覧の検索でバックオーダーの有無で絞り込める", () => {
  it("hasBackorder=trueを指定すると、バックオーダーが残っている受注のみ返る", async () => {
    await seedItemMasterAndStock("ITEM-1", 10);
    await seedOrder("O-backorder", { status: "DRAFT" });
    await seedOrderItem("O-backorder", { itemId: "ITEM-1", quantity: 30, inputType: "MASTER" });
    await callSubmitForApproval("O-backorder", "applicant-1");
    expect(await findOrderItemBackorder("O-backorder", "ITEM-1")).toBe(20);

    await seedItemMasterAndStock("ITEM-2", 100);
    await seedOrder("O-ok", { status: "DRAFT" });
    await seedOrderItem("O-ok", { itemId: "ITEM-2", quantity: 10, inputType: "MASTER" });
    await callSubmitForApproval("O-ok", "applicant-1");
    expect(await findOrderItemBackorder("O-ok", "ITEM-2")).toBe(0);

    const res = await callSearchOrders("applicant-1", "hasBackorder=true");
    expect(res.status).toBe(200);
    const orders = (await res.json()) as Array<{ id: string }>;
    expect(orders.map((o) => o.id)).toEqual(["O-backorder"]);
  });

  it("再現テスト: 2件の受注にバックオーダーがあり、うち1件は「1行バックオーダーあり+1行バックオーダーなし」の混在パターンでも両方とも抽出される", async () => {
    await seedItemMasterAndStock("ITEM-1", 10);
    await seedOrder("O-single", { status: "DRAFT" });
    await seedOrderItem("O-single", { itemId: "ITEM-1", quantity: 30, inputType: "MASTER" });
    await callSubmitForApproval("O-single", "applicant-1");
    expect(await findOrderItemBackorder("O-single", "ITEM-1")).toBe(20);

    await seedItemMasterAndStock("ITEM-2", 100);
    await seedItemMasterAndStock("ITEM-3", 5);
    await seedOrder("O-mixed", { status: "DRAFT" });
    await seedOrderItem("O-mixed", {
      itemId: "ITEM-2",
      quantity: 10,
      inputType: "MASTER",
      sortOrder: 0,
    });
    await seedOrderItem("O-mixed", {
      itemId: "ITEM-3",
      quantity: 30,
      inputType: "MASTER",
      sortOrder: 1,
    });
    await callSubmitForApproval("O-mixed", "applicant-1");
    expect(await findOrderItemBackorder("O-mixed", "ITEM-2")).toBe(0);
    expect(await findOrderItemBackorder("O-mixed", "ITEM-3")).toBe(25);

    const res = await callSearchOrders("applicant-1", "hasBackorder=true");
    expect(res.status).toBe(200);
    const orders = (await res.json()) as Array<{ id: string }>;
    expect(orders.map((o) => o.id).sort()).toEqual(["O-mixed", "O-single"]);

    // 実際のフロントエンドはページネーション有効時、page/limitを常に付与して検索する
    const pagedRes = await callSearchOrders("applicant-1", "hasBackorder=true&page=1&limit=20");
    expect(pagedRes.status).toBe(200);
    const pagedBody = (await pagedRes.json()) as {
      data: Array<{ id: string }>;
      pagination: { total: number };
    };
    expect(pagedBody.pagination.total).toBe(2);
    expect(pagedBody.data.map((o) => o.id).sort()).toEqual(["O-mixed", "O-single"]);
  });

  it("hasBackorderを指定しなければ全件返る", async () => {
    await seedItemMasterAndStock("ITEM-1", 10);
    await seedOrder("O-backorder", { status: "DRAFT" });
    await seedOrderItem("O-backorder", { itemId: "ITEM-1", quantity: 30, inputType: "MASTER" });
    await callSubmitForApproval("O-backorder", "applicant-1");

    await seedOrder("O-ok", { status: "DRAFT" });

    const res = await callSearchOrders("applicant-1", "");
    expect(res.status).toBe(200);
    const orders = (await res.json()) as Array<{ id: string }>;
    expect(orders.map((o) => o.id).sort()).toEqual(["O-backorder", "O-ok"]);
  });
});

describe("追加要望: 受注一覧の検索で注残(売上計上が未済)の有無で絞り込める", () => {
  async function seedApprovedInvoice(
    id: string,
    overrides: Partial<typeof schema.salesInvoices.$inferInsert> = {},
  ) {
    await db.insert(schema.salesInvoices).values({
      id,
      partnerId: "partner-1",
      invoiceDate: now,
      status: "APPROVED",
      documentType: "SALE",
      totalAmount: 0,
      taxAmount: 0,
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
      ...overrides,
    });
  }

  it("hasUnrecognizedSales=trueを指定すると、受注数量に対して売上計上(APPROVED)が満たない受注のみ返る", async () => {
    await seedOrder("O-unrecognized", { status: "APPROVED" });
    await seedOrderItem("O-unrecognized", {
      id: "SOI-unrecognized",
      salesOrderId: "O-unrecognized",
      itemId: "ITEM-1",
      quantity: 10,
    });

    await seedOrder("O-fully-recognized", { status: "APPROVED" });
    await seedOrderItem("O-fully-recognized", {
      id: "SOI-fully-recognized",
      salesOrderId: "O-fully-recognized",
      itemId: "ITEM-1",
      quantity: 10,
    });
    await seedApprovedInvoice("SI-full");
    await db.insert(schema.salesInvoiceItems).values({
      id: "SIT-full",
      salesInvoiceId: "SI-full",
      sourceOrderItemId: "SOI-fully-recognized",
      itemId: "ITEM-1",
      itemName: "テスト品目",
      quantity: 10,
      unitPrice: 100,
      amount: 1000,
      sortOrder: 0,
    });

    const res = await callSearchOrders("applicant-1", "hasUnrecognizedSales=true");
    expect(res.status).toBe(200);
    const orders = (await res.json()) as Array<{ id: string }>;
    expect(orders.map((o) => o.id)).toEqual(["O-unrecognized"]);
  });

  it("DRAFT状態の売上計上は消込に数えられず、注残ありのままになる", async () => {
    await seedOrder("O-draft-invoice", { status: "APPROVED" });
    await seedOrderItem("O-draft-invoice", {
      id: "SOI-draft-invoice",
      salesOrderId: "O-draft-invoice",
      itemId: "ITEM-1",
      quantity: 10,
    });
    await seedApprovedInvoice("SI-draft", { status: "DRAFT" });
    await db.insert(schema.salesInvoiceItems).values({
      id: "SIT-draft",
      salesInvoiceId: "SI-draft",
      sourceOrderItemId: "SOI-draft-invoice",
      itemId: "ITEM-1",
      itemName: "テスト品目",
      quantity: 10,
      unitPrice: 100,
      amount: 1000,
      sortOrder: 0,
    });

    const res = await callSearchOrders("applicant-1", "hasUnrecognizedSales=true");
    expect(res.status).toBe(200);
    const orders = (await res.json()) as Array<{ id: string }>;
    expect(orders.map((o) => o.id)).toContain("O-draft-invoice");
  });

  it("hasUnrecognizedSalesを指定しなければ全件返る", async () => {
    await seedOrder("O-a", { status: "DRAFT" });
    await seedOrder("O-b", { status: "DRAFT" });

    const res = await callSearchOrders("applicant-1", "");
    expect(res.status).toBe(200);
    const orders = (await res.json()) as Array<{ id: string }>;
    expect(orders.map((o) => o.id).sort()).toEqual(["O-a", "O-b"]);
  });
});

async function callBackorderedItems(actorUserId: string) {
  const ctx = createExecutionContext();
  const res = await salesOrdersRouter.request(
    "/backordered-items",
    { method: "GET", headers: { Cookie: await buildSessionCookieHeader(actorUserId) } },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("Item9 Phase6: 欠品自動提案①(受注紐付け方式、受注横断の欠品明細フラット一覧)", () => {
  it("複数の承認済み受注にまたがる欠品明細をフラットに返し、受注ID/受注名を含む", async () => {
    await seedItemMasterAndStock("ITEM-1", 10);
    await seedOrder("O-1", { status: "DRAFT", title: "受注1" });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 30, inputType: "MASTER" });
    await callSubmitForApproval("O-1", "applicant-1");
    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(20);

    await seedItemMasterAndStock("ITEM-2", 5);
    await seedOrder("O-2", { status: "DRAFT", title: "受注2" });
    await seedOrderItem("O-2", { itemId: "ITEM-2", quantity: 8, inputType: "MASTER" });
    await callSubmitForApproval("O-2", "applicant-1");
    expect(await findOrderItemBackorder("O-2", "ITEM-2")).toBe(3);

    const res = await callBackorderedItems("applicant-1");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{
      salesOrderId: string;
      salesOrderTitle: string | null;
      itemId: string | null;
      backorderedQuantity: number;
    }>;
    expect(rows.map((r) => r.salesOrderId).sort()).toEqual(["O-1", "O-2"]);
    const row1 = rows.find((r) => r.salesOrderId === "O-1")!;
    expect(row1.salesOrderTitle).toBe("受注1");
    expect(row1.itemId).toBe("ITEM-1");
    expect(row1.backorderedQuantity).toBe(20);
    const row2 = rows.find((r) => r.salesOrderId === "O-2")!;
    expect(row2.backorderedQuantity).toBe(3);
  });

  it("在庫が十分で欠品の無い受注・明細は結果に含まれない", async () => {
    await seedItemMasterAndStock("ITEM-3", 100);
    await seedOrder("O-ok", { status: "DRAFT" });
    await seedOrderItem("O-ok", { itemId: "ITEM-3", quantity: 10, inputType: "MASTER" });
    await callSubmitForApproval("O-ok", "applicant-1");
    expect(await findOrderItemBackorder("O-ok", "ITEM-3")).toBe(0);

    const res = await callBackorderedItems("applicant-1");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ salesOrderId: string }>;
    expect(rows.map((r) => r.salesOrderId)).not.toContain("O-ok");
  });

  it("欠品明細があってもAPPROVED以外(DRAFT)の受注は結果から除外される", async () => {
    await seedItemMasterAndStock("ITEM-4", 5);
    await seedOrder("O-draft-only", { status: "DRAFT" });
    await seedOrderItem("O-draft-only", { itemId: "ITEM-4", quantity: 20, inputType: "MASTER" });
    // submitForApprovalを呼ばないため、status=DRAFT・backorderedQuantity=0のまま
    expect(await findOrderItemBackorder("O-draft-only", "ITEM-4")).toBe(0);

    const res = await callBackorderedItems("applicant-1");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ salesOrderId: string }>;
    expect(rows.map((r) => r.salesOrderId)).not.toContain("O-draft-only");
  });

  it("1件の受注内に欠品明細・欠品でない明細が混在していても、欠品明細のみが返る", async () => {
    await seedItemMasterAndStock("ITEM-5", 100);
    await seedItemMasterAndStock("ITEM-6", 5);
    await seedOrder("O-mixed", { status: "DRAFT" });
    await seedOrderItem("O-mixed", { itemId: "ITEM-5", quantity: 10, inputType: "MASTER", sortOrder: 0 });
    await seedOrderItem("O-mixed", { itemId: "ITEM-6", quantity: 30, inputType: "MASTER", sortOrder: 1 });
    await callSubmitForApproval("O-mixed", "applicant-1");
    expect(await findOrderItemBackorder("O-mixed", "ITEM-5")).toBe(0);
    expect(await findOrderItemBackorder("O-mixed", "ITEM-6")).toBe(25);

    const res = await callBackorderedItems("applicant-1");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ salesOrderId: string; itemId: string | null }>;
    const mixedRows = rows.filter((r) => r.salesOrderId === "O-mixed");
    expect(mixedRows).toHaveLength(1);
    expect(mixedRows[0].itemId).toBe("ITEM-6");
  });
});

describe("Item7残課題2-5フォローアップ: CSVインポートでstatus=APPROVEDを直接指定した受注も在庫引当・バックオーダー検知が行われる", () => {
  it("在庫が不足しているAPPROVED受注をCSVインポートすると、通常の承認申請と同じくbackorderedQuantityが記録され、検索でも抽出される", async () => {
    await seedItemMasterAndStock("ITEM-1", 10);
    const csv = [
      "id,title,partnerId,orderDate,status,totalAmount,taxAmount,itemId,itemName,inputType,quantity,unitPrice",
      '"O-csv-1","CSV受注","partner-1","2026-01-01","APPROVED",3000,0,"ITEM-1","テスト品目","MASTER",30,100',
    ].join("\n");

    const res = await callBulkImportCsv("applicant-1", csv);
    expect(res.status).toBe(200);

    expect(await findOrderItemBackorder("O-csv-1", "ITEM-1")).toBe(20);
    expect(await findReservedQuantity("ITEM-1")).toBe(10);

    const searchRes = await callSearchOrders("applicant-1", "hasBackorder=true");
    const orders = (await searchRes.json()) as Array<{ id: string }>;
    expect(orders.map((o) => o.id)).toContain("O-csv-1");
  });

  it("在庫が十分なAPPROVED受注のCSVインポートではbackorderedQuantityは0のまま", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    const csv = [
      "id,title,partnerId,orderDate,status,totalAmount,taxAmount,itemId,itemName,inputType,quantity,unitPrice",
      '"O-csv-2","CSV受注","partner-1","2026-01-01","APPROVED",1000,0,"ITEM-1","テスト品目","MASTER",10,100',
    ].join("\n");

    const res = await callBulkImportCsv("applicant-1", csv);
    expect(res.status).toBe(200);
    expect(await findOrderItemBackorder("O-csv-2", "ITEM-1")).toBe(0);
    expect(await findReservedQuantity("ITEM-1")).toBe(10);
  });

  it("status=DRAFTのCSVインポートでは引当は行われない(backorderedQuantityは0のまま)", async () => {
    await seedItemMasterAndStock("ITEM-1", 10);
    const csv = [
      "id,title,partnerId,orderDate,status,totalAmount,taxAmount,itemId,itemName,inputType,quantity,unitPrice",
      '"O-csv-3","CSV受注","partner-1","2026-01-01","DRAFT",3000,0,"ITEM-1","テスト品目","MASTER",30,100',
    ].join("\n");

    const res = await callBulkImportCsv("applicant-1", csv);
    expect(res.status).toBe(200);
    expect(await findOrderItemBackorder("O-csv-3", "ITEM-1")).toBe(0);
    expect(await findReservedQuantity("ITEM-1")).toBe(0);
  });

  // 追加要望対応: 既に売上計上(sales_invoice_items.sourceOrderItemId)が紐づく受注をCSVで
  // 再インポートすると、明細のdelete→再insertがFK制約違反で500になっていたバグの回帰テスト
  it("既に売上計上済みの受注をCSV再インポートしても500にならず、既存明細は保持したままヘッダーのみ更新される", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    await seedOrder("O-csv-invoiced", { status: "APPROVED", title: "旧タイトル" });
    await seedOrderItem("O-csv-invoiced", {
      id: "SOI-invoiced",
      salesOrderId: "O-csv-invoiced",
      itemId: "ITEM-1",
      quantity: 5,
      inputType: "MASTER",
    });

    await db.insert(schema.salesInvoices).values({
      id: "SI-1",
      partnerId: "partner-1",
      salesOrderId: "O-csv-invoiced",
      invoiceDate: now,
      status: "APPROVED",
      totalAmount: 500,
      taxAmount: 0,
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.salesInvoiceItems).values({
      id: "SIT-1",
      salesInvoiceId: "SI-1",
      sourceOrderItemId: "SOI-invoiced",
      itemId: "ITEM-1",
      itemName: "テスト品目",
      quantity: 5,
      unitPrice: 100,
      amount: 500,
      sortOrder: 0,
    });

    const csv = [
      "id,title,partnerId,orderDate,status,totalAmount,taxAmount,itemId,itemName,inputType,quantity,unitPrice",
      '"O-csv-invoiced","再インポートされたタイトル","partner-1","2026-01-01","APPROVED",500,0,"ITEM-1","テスト品目","MASTER",5,100',
    ].join("\n");

    const res = await callBulkImportCsv("applicant-1", csv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("O-csv-invoiced");

    const order = await findOrder("O-csv-invoiced");
    expect(order?.title).toBe("再インポートされたタイトル");

    const items = await db
      .select()
      .from(schema.salesOrderItems)
      .where(eq(schema.salesOrderItems.salesOrderId, "O-csv-invoiced"));
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("SOI-invoiced");
  });
});

describe("Item7残課題2-5フォローアップ2: 承認済み受注をPUT /:idで直接編集した場合も在庫引当が再計算される", () => {
  it("承認機能OFF時、CSVインポート等で引当されていなかったAPPROVED受注をPUT /:idで編集(手動更新)すると、その時点で在庫引当・バックオーダー検知が行われる", async () => {
    // CSVインポート経由でstatus=APPROVEDを直接指定した受注を模す(引当が一切行われていない状態)
    await seedItemMasterAndStock("ITEM-1", 10);
    await seedOrder("O-1", { status: "APPROVED" });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 30, inputType: "MASTER" });
    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(0);
    expect(await findReservedQuantity("ITEM-1")).toBe(0);

    // ユーザーが画面から手動で保存(承認機能OFF時はステータスをAPPROVEDのまま直接編集できる)
    const res = await callUpdateOrder("O-1", "applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      title: "手動更新後",
      status: "APPROVED",
      totalAmount: 3000,
      items: [{ itemId: "ITEM-1", quantity: 30, unitPrice: 100, inputType: "MASTER" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warning?: string };
    expect(body.warning).toContain("バックオーダー");

    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(20);
    expect(await findReservedQuantity("ITEM-1")).toBe(10);

    const searchRes = await callSearchOrders("applicant-1", "hasBackorder=true");
    const orders = (await searchRes.json()) as Array<{ id: string }>;
    expect(orders.map((o) => o.id)).toContain("O-1");
  });

  it("DRAFTのまま更新する場合は実際の引当は行わない(プレビュー警告のみ)", async () => {
    await seedItemMasterAndStock("ITEM-1", 10);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { itemId: "ITEM-1", quantity: 1, inputType: "MASTER" });

    const res = await callUpdateOrder("O-1", "applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      title: "更新後",
      status: "DRAFT",
      totalAmount: 3000,
      items: [{ itemId: "ITEM-1", quantity: 30, unitPrice: 100, inputType: "MASTER" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warning?: string };
    expect(body.warning).toContain("在庫が不足している可能性がある");
    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(0);
    expect(await findReservedQuantity("ITEM-1")).toBe(0);
  });
});

describe("Item7残課題2-5フォローアップ4: 承認済み受注への変更申請(UPDATE)が承認確定した際、明細の数量変更に応じて在庫引当が調整される", () => {
  async function approveOrderDirectly(orderId: string, itemId: string, quantity: number) {
    await seedOrder(orderId, { status: "DRAFT" });
    await seedOrderItem(orderId, { itemId, quantity, inputType: "MASTER" });
    const res = await callSubmitForApproval(orderId, "applicant-1");
    expect(res.status).toBe(200);
  }

  async function setupUpdateApprovalFlow() {
    await enableSalesOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-update", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
  }

  async function submitUpdate(orderId: string, items: unknown[], totalAmount = 1000) {
    const updateRes = await callSubmitUpdateForApproval(orderId, "applicant-1", {
      header: { title: "変更後タイトル", partnerId: "partner-1", orderDate: "2026-01-01", totalAmount },
      items,
      comment: "数量変更",
    });
    expect(updateRes.status).toBe(200);
    return updateRes;
  }

  async function approveLatestUpdate(orderId: string) {
    const requests = await findPendingRequestByTarget(orderId);
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, orderId));
    const approveRes = await callApproveTask({ logId: logs[0].id, requestId, userId: "approver-1" });
    expect(approveRes.status).toBe(200);
  }

  async function submitAndApproveUpdate(orderId: string, items: unknown[], totalAmount = 1000) {
    await submitUpdate(orderId, items, totalAmount);
    await approveLatestUpdate(orderId);
  }

  it("数量が増え、在庫に余裕がある場合、申請時点で追加分だけ引当が増え、最終承認確定後も維持される", async () => {
    await seedItemMasterAndStock("ITEM-1", 30);
    await approveOrderDirectly("O-1", "ITEM-1", 20); // 20引当、残り10
    expect(await findReservedQuantity("ITEM-1")).toBe(20);

    await setupUpdateApprovalFlow();
    await submitUpdate("O-1", [{ itemId: "ITEM-1", quantity: 25, unitPrice: 100, inputType: "MASTER" }]);
    // フォローアップ6: 在庫調整は最終承認を待たず、申請提出時点で反映される
    expect(await findReservedQuantity("ITEM-1")).toBe(25);

    await approveLatestUpdate("O-1");
    expect(await findReservedQuantity("ITEM-1")).toBe(25);
    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(0);
  });

  it("数量が増えたが在庫が足りない場合、申請時点で確保できる分だけ引き当てられ、残りはバックオーダー警告になる", async () => {
    await seedItemMasterAndStock("ITEM-1", 30);
    await approveOrderDirectly("O-1", "ITEM-1", 20); // 20引当、残り10
    expect(await findReservedQuantity("ITEM-1")).toBe(20);

    await setupUpdateApprovalFlow();
    const updateRes = await callSubmitUpdateForApproval("O-1", "applicant-1", {
      header: { title: "変更後タイトル", partnerId: "partner-1", orderDate: "2026-01-01", totalAmount: 1000 },
      items: [{ itemId: "ITEM-1", quantity: 50, unitPrice: 100, inputType: "MASTER" }],
      comment: "数量変更",
    });
    expect(updateRes.status).toBe(200);
    const body = (await updateRes.json()) as { warning?: string };
    expect(body.warning).toContain("バックオーダー");
    expect(await findReservedQuantity("ITEM-1")).toBe(30);

    await approveLatestUpdate("O-1");
    expect(await findReservedQuantity("ITEM-1")).toBe(30);
    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(20);
  });

  it("数量が減った場合、申請時点で超過分の引当が解放され(在庫を塞ぎっぱなしにしない)、最終承認確定後も維持される", async () => {
    await seedItemMasterAndStock("ITEM-1", 30);
    await approveOrderDirectly("O-1", "ITEM-1", 20); // 20引当、残り10
    expect(await findReservedQuantity("ITEM-1")).toBe(20);

    await setupUpdateApprovalFlow();
    await submitUpdate("O-1", [{ itemId: "ITEM-1", quantity: 5, unitPrice: 100, inputType: "MASTER" }]);
    expect(await findReservedQuantity("ITEM-1")).toBe(5);

    await approveLatestUpdate("O-1");
    expect(await findReservedQuantity("ITEM-1")).toBe(5);
    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(0);

    // 解放された15個は他の受注が引き当てられるようになっているはず(この時点で承認機能は
    // 既にONのため、別受注もREGISTER申請→最終承認の一連の流れで確認する)
    await seedOrder("O-2", { status: "DRAFT" });
    await seedOrderItem("O-2", { itemId: "ITEM-1", quantity: 15, inputType: "MASTER" });
    await callSubmitForApproval("O-2", "applicant-1");
    const requests2 = await findPendingRequestByTarget("O-2");
    const requestId2 = requests2[0].id;
    const logs2 = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, "O-2"));
    const approveRes2 = await callApproveTask({ logId: logs2[0].id, requestId: requestId2, userId: "approver-1" });
    expect(approveRes2.status).toBe(200);
    expect(await findOrderItemBackorder("O-2", "ITEM-1")).toBe(0);
    expect(await findReservedQuantity("ITEM-1")).toBe(20);
  });
});

describe("Item7残課題2-5フォローアップ5: 承認済み受注への変更申請(UPDATE)が差戻し/取消された場合、元のAPPROVED状態・引当が保たれる", () => {
  async function setupApprovedOrderWithFlow(orderId: string, itemId: string, quantity: number) {
    await seedItemMasterAndStock(itemId, 100);
    await seedOrder(orderId, { status: "DRAFT" });
    await seedOrderItem(orderId, { itemId, quantity, inputType: "MASTER" });
    await callSubmitForApproval(orderId, "applicant-1"); // 承認機能OFFなので即APPROVED、引当済み

    await enableSalesOrderApprovalWorkflow();
    await seedRole("approver_role");
    await seedUser("approver-1");
    await seedUserRole("approver-1", "approver_role");
    await seedApprovalFlow("flow-update", "sales_orders", [{ order: 1, roleId: "approver_role" }]);
  }

  async function submitUpdateRequest(orderId: string, items: unknown[]) {
    const res = await callSubmitUpdateForApproval(orderId, "applicant-1", {
      header: { title: "変更後タイトル", partnerId: "partner-1", orderDate: "2026-01-01", totalAmount: 1000 },
      items,
      comment: "数量変更",
    });
    expect(res.status).toBe(200);
    const requests = await findPendingRequestByTarget(orderId);
    const requestId = requests[0].id;
    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, orderId));
    return { requestId, logId: logs[0].id };
  }

  it("変更申請の申請直後、承認確定前でも受注のステータスは元のAPPROVEDのまま変化しないが、在庫は与信と異なり申請時点で新しい数量分に調整される(フォローアップ6)", async () => {
    await setupApprovedOrderWithFlow("O-1", "ITEM-1", 20);
    expect(await findReservedQuantity("ITEM-1")).toBe(20);

    await submitUpdateRequest("O-1", [{ itemId: "ITEM-1", quantity: 50, unitPrice: 100, inputType: "MASTER" }]);

    expect((await findOrder("O-1"))?.status).toBe("APPROVED");
    expect(await findReservedQuantity("ITEM-1")).toBe(50);
    // 明細行自体はまだ承認確定まで旧数量(20)のままだが、引当カウンタだけ先行して新数量(50)になる
    expect(await findOrderItemBackorder("O-1", "ITEM-1")).toBe(0);
  });

  it("変更申請が差戻しされた場合、受注はAPPROVEDのまま(DRAFTに戻らない)で、申請時点で調整された引当も申請前の状態に復元される", async () => {
    await setupApprovedOrderWithFlow("O-1", "ITEM-1", 20);
    const { requestId, logId } = await submitUpdateRequest("O-1", [
      { itemId: "ITEM-1", quantity: 50, unitPrice: 100, inputType: "MASTER" },
    ]);
    expect(await findReservedQuantity("ITEM-1")).toBe(50);

    const remandRes = await callRemandTask({ logId, requestId, userId: "approver-1" });
    expect(remandRes.status).toBe(200);

    expect((await findOrder("O-1"))?.status).toBe("APPROVED");
    expect(await findReservedQuantity("ITEM-1")).toBe(20);
  });

  it("変更申請が申請者により取り下げられた場合も、受注はAPPROVEDのまま・申請時点で調整された引当も申請前の状態に復元される", async () => {
    await setupApprovedOrderWithFlow("O-1", "ITEM-1", 20);
    const { requestId, logId } = await submitUpdateRequest("O-1", [
      { itemId: "ITEM-1", quantity: 50, unitPrice: 100, inputType: "MASTER" },
    ]);
    expect(await findReservedQuantity("ITEM-1")).toBe(50);

    const cancelRes = await callCancelTask({ targetId: "O-1", logId, userId: "applicant-1" });
    expect(cancelRes.status).toBe(200);

    expect((await findOrder("O-1"))?.status).toBe("APPROVED");
    expect(await findReservedQuantity("ITEM-1")).toBe(20);
  });

  it("変更申請で数量が減った場合も申請時点で解放され、差戻し後は元の(より多い)数量分の引当が正しく復元される", async () => {
    await setupApprovedOrderWithFlow("O-1", "ITEM-1", 20);
    const { requestId, logId } = await submitUpdateRequest("O-1", [
      { itemId: "ITEM-1", quantity: 5, unitPrice: 100, inputType: "MASTER" },
    ]);
    expect(await findReservedQuantity("ITEM-1")).toBe(5);

    const remandRes = await callRemandTask({ logId, requestId, userId: "approver-1" });
    expect(remandRes.status).toBe(200);

    expect((await findOrder("O-1"))?.status).toBe("APPROVED");
    expect(await findReservedQuantity("ITEM-1")).toBe(20);
  });
});
