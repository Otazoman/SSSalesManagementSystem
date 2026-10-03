import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import { salesOrdersRouter } from "./index";

// #14-2⑥: 元々2401行あったsales-order.service.test.tsから、基本CRUD(PUT/DELETEのステータス
// ガード・伝票番号の自動採番)の部分を分割したもの。ロジック変更なし。ヘルパー関数は既存の慣習
// (payment-crud.test.ts/payment-csv.test.ts、purchase-requisition-crud/csv.service.test.ts)に
// ならい、分割後の各ファイルにそのまま複製している(共通ファイル化はしない)。

const db = drizzle(env.DB, { schema });

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

async function callDeleteOrder(id: string, actorUserId: string) {
  const ctx = createExecutionContext();
  const res = await salesOrdersRouter.request(
    `/${id}`,
    { method: "DELETE", headers: { Cookie: await buildSessionCookieHeader(actorUserId) } },
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
  // 新規要望(2026-09-23): partnersがFK参照されるため、partnersの削除より先に消す必要がある
  await db.delete(schema.partnerDeliveryDestinations);
  await db.delete(schema.partners);
  await db.delete(schema.roles);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.delete("config");

  await seedUser("applicant-1");
  await seedPartner("partner-1");
});

// 新規要望(2026-09-23): 受注の納品先(partner_delivery_destinations)選択のFK先シード
async function seedDeliveryDestination(id: string, partnerId = "partner-1") {
  await db.insert(schema.partnerDeliveryDestinations).values({
    id,
    partnerId,
    name: `納品先${id}`,
    status: "active",
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

describe("PUT /:id のステータスガード", () => {
  it("DRAFTの受注は通常通り直接更新できる", async () => {
    await seedOrder("O-1", { status: "DRAFT" });
    const res = await callUpdateOrder("O-1", "applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      title: "更新後タイトル",
      items: [],
    });
    expect(res.status).toBe(200);
    const order = await findOrder("O-1");
    expect(order?.title).toBe("更新後タイトル");
  });

  it("新規要望(2026-09-23): 納品先(deliveryDestinationId)を指定して新規登録できる", async () => {
    await seedDeliveryDestination("DD-1");
    const res = await callCreateOrder("applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      title: "納品先指定受注",
      deliveryPlace: "納品先DD-1",
      deliveryDestinationId: "DD-1",
      items: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    const order = await findOrder(body.id);
    expect(order?.deliveryPlace).toBe("納品先DD-1");
    expect(order?.deliveryDestinationId).toBe("DD-1");
  });

  it("新規要望(2026-09-23): 納品先(deliveryDestinationId)の選択を更新できる", async () => {
    await seedDeliveryDestination("DD-1");
    await seedOrder("O-1", { status: "DRAFT" });
    const res = await callUpdateOrder("O-1", "applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      title: "更新後タイトル",
      deliveryPlace: "納品先DD-1",
      deliveryDestinationId: "DD-1",
      items: [],
    });
    expect(res.status).toBe(200);
    const order = await findOrder("O-1");
    expect(order?.deliveryPlace).toBe("納品先DD-1");
    expect(order?.deliveryDestinationId).toBe("DD-1");
  });

  it("承認機能ONの場合、PENDING_APPROVAL中の受注は直接更新できない(400)", async () => {
    await enableSalesOrderApprovalWorkflow();
    await seedOrder("O-1", { status: "PENDING_APPROVAL" });
    const res = await callUpdateOrder("O-1", "applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      items: [],
    });
    expect(res.status).toBe(400);
  });

  it("承認機能ONの場合、APPROVED済みの受注は直接更新できない(400、変更申請への案内)", async () => {
    await enableSalesOrderApprovalWorkflow();
    await seedOrder("O-1", { status: "APPROVED" });
    const res = await callUpdateOrder("O-1", "applicant-1", {
      orderDate: "2026-01-01",
      items: [],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("/api/approvals/request-update");
  });
});

describe("伝票番号フォーマット統一化: idを指定しない新規登録は会社設定に基づく形式で自動採番される", () => {
  it("受注は既定でSO-YYYYMMDD-NNNN形式になる(従来のUUIDではない)", async () => {
    const res = await callCreateOrder("applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      title: "自動採番テスト",
      totalAmount: 0,
      items: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^SO-\d{4}$/);
  });

  it("会社設定でプレフィックスなし・6桁に変更すると、その形式で採番される", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({
        document_number_formats: { sales_order: { usePrefix: false, prefix: "SO", digitCount: 6 } },
      }),
    );
    const res = await callCreateOrder("applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      title: "自動採番テスト2",
      totalAmount: 0,
      items: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^\d{6}$/);
  });
});

describe("DELETE /:id のステータスガード", () => {
  it("DRAFTの受注は直接削除できる", async () => {
    await seedOrder("O-1", { status: "DRAFT" });
    const res = await callDeleteOrder("O-1", "applicant-1");
    expect(res.status).toBe(200);
    expect(await findOrder("O-1")).toBeNull();
  });

  it("APPROVED済みの受注は直接削除できない(400)", async () => {
    await seedOrder("O-1", { status: "APPROVED" });
    const res = await callDeleteOrder("O-1", "applicant-1");
    expect(res.status).toBe(400);
    expect(await findOrder("O-1")).not.toBeNull();
  });

  // Item7残課題6: item_shipment_items/item_shipment_instruction_itemsのsalesOrderItemIdは
  // salesOrderItems.idへのFK(onDelete指定なし)のため、紐づく実績がある状態で削除しようとすると
  // 以前はDB例外(500)になっていた不具合の回帰防止
  it("出庫実績が紐づく受注は削除申請時に分かりやすいエラーで止まる(500にならない)", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    await seedOrder("O-1", { status: "APPROVED" });
    await seedOrderItem("O-1", { id: "SOI-1", itemId: "ITEM-1", quantity: 5, inputType: "MASTER" });

    await db.insert(schema.itemShipmentHeaders).values({
      id: "SH-1",
      partnerId: "partner-1",
      shippedDate: now,
      status: "APPROVED",
      createdBy: "applicant-1",
      createdAt: now,
    });
    await db.insert(schema.itemShipmentItems).values({
      id: "SHI-1",
      shipmentHeaderId: "SH-1",
      itemId: "ITEM-1",
      salesOrderItemId: "SOI-1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      qualityStatus: "NORMAL",
      shippedQuantity: 5,
      accountCode: "ACC1",
    });

    const res = await callRequestDeletion("O-1", "applicant-1");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("出荷指示・出庫の実績、または売上計上と紐づいている");
    expect(await findOrder("O-1")).not.toBeNull();
  });

  it("出荷指示にのみ紐づく受注(出庫実績はまだ無い)も同様に削除申請時にブロックされる", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    await seedOrder("O-1", { status: "APPROVED" });
    await seedOrderItem("O-1", { id: "SOI-1", itemId: "ITEM-1", quantity: 5, inputType: "MASTER" });

    await db.insert(schema.warehouses).values({
      id: "WH-EXT-1",
      name: "外部倉庫",
      warehouseType: "EXTERNAL",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.itemShipmentInstructions).values({
      id: "SI-1",
      partnerId: "partner-1",
      warehouseId: "WH-EXT-1",
      instructedShipDate: now,
      status: "APPROVED",
      createdBy: "applicant-1",
      createdAt: now,
    });
    await db.insert(schema.itemShipmentInstructionItems).values({
      id: "SII-1",
      instructionHeaderId: "SI-1",
      itemId: "ITEM-1",
      salesOrderItemId: "SOI-1",
      lotNumber: "NONE",
      instructedQuantity: 5,
      accountCode: "ACC1",
    });

    const res = await callRequestDeletion("O-1", "applicant-1");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("出荷指示・出庫の実績、または売上計上と紐づいている");
    expect(await findOrder("O-1")).not.toBeNull();
  });
});
