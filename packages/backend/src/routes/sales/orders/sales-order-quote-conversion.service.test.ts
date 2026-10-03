import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import { salesOrdersRouter } from "./index";

// #14-2⑥: 元々2401行あったsales-order.service.test.tsから、見積からの受注作成(スナップショット
// 方式)の部分を分割したもの。ロジック変更なし。ヘルパー関数は既存の慣習(payment-crud.test.ts/
// payment-csv.test.ts、purchase-requisition-crud/csv.service.test.ts)にならい、分割後の各
// ファイルにそのまま複製している(共通ファイル化はしない)。

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
  await db.delete(schema.partners);
  await db.delete(schema.roles);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.delete("config");

  await seedUser("applicant-1");
  await seedPartner("partner-1");
});

describe("Item7: 見積からの受注作成(スナップショット方式)", () => {
  it("sourceQuoteIdを指定して作成すると、受注ヘッダーに記録される(数量消込は行わない)", async () => {
    await db.insert(schema.quotes).values({
      id: "Q-1",
      partnerId: "partner-1",
      quoteDate: now,
      status: "APPROVED",
      totalAmount: 20000,
      taxAmount: 2000,
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.quoteItems).values({
      id: "Q-1-item-1",
      quoteId: "Q-1",
      itemId: "ITEM-1",
      itemName: "テスト品目",
      quantity: 10,
      unitPrice: 2000,
      amount: 20000,
      sortOrder: 0,
    });

    const res = await callCreateOrder("applicant-1", {
      id: "O-FROM-Q",
      partnerId: "partner-1",
      sourceQuoteId: "Q-1",
      orderDate: "2026-01-01",
    });
    expect(res.status).toBe(200);

    const order = await findOrder("O-FROM-Q");
    expect(order?.sourceQuoteId).toBe("Q-1");

    const items = await db
      .select()
      .from(schema.salesOrderItems)
      .where(eq(schema.salesOrderItems.salesOrderId, "O-FROM-Q"));
    expect(items).toHaveLength(1);
    expect(items[0].sourceQuoteItemId).toBe("Q-1-item-1");
    expect(items[0].quantity).toBe(10);

    // 同じ見積から2件目を作成しても妨げられない(スナップショット方式、数量消込なし)
    const res2 = await callCreateOrder("applicant-1", {
      id: "O-FROM-Q-2",
      partnerId: "partner-1",
      sourceQuoteId: "Q-1",
      orderDate: "2026-01-01",
    });
    expect(res2.status).toBe(200);
  });

  it("quoteItemSelectionsで選択した明細のみ、指定数量でコピーされる(明細単位・一部数量)", async () => {
    await db.insert(schema.quotes).values({
      id: "Q-2",
      partnerId: "partner-1",
      quoteDate: now,
      status: "APPROVED",
      totalAmount: 30000,
      taxAmount: 3000,
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.quoteItems).values([
      {
        id: "Q-2-item-1",
        quoteId: "Q-2",
        itemId: "ITEM-1",
        itemName: "品目A",
        quantity: 100,
        unitPrice: 100,
        amount: 10000,
        sortOrder: 0,
      },
      {
        id: "Q-2-item-2",
        quoteId: "Q-2",
        itemId: "ITEM-2",
        itemName: "品目B",
        quantity: 50,
        unitPrice: 400,
        amount: 20000,
        sortOrder: 1,
      },
    ]);

    const res = await callCreateOrder("applicant-1", {
      id: "O-PARTIAL",
      partnerId: "partner-1",
      sourceQuoteId: "Q-2",
      orderDate: "2026-01-01",
      quoteItemSelections: [{ quoteItemId: "Q-2-item-1", quantity: 60 }],
    });
    expect(res.status).toBe(200);

    const items = await db
      .select()
      .from(schema.salesOrderItems)
      .where(eq(schema.salesOrderItems.salesOrderId, "O-PARTIAL"));
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe("ITEM-1");
    expect(items[0].quantity).toBe(60);
  });
});
