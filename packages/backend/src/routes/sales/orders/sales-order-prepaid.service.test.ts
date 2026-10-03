import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import { salesOrdersRouter } from "./index";
import * as journalSchema from "../../../db/journal-schema";
import { listUnpostedJournalSources, postJournalFromSource } from "../../../platform/journal/journal-sources";

// #14-2⑥: 元々2401行あったsales-order.service.test.tsから、前受(isPrepaid/prepaidAt)の
// 最小対応・自動仕訳連携の部分を分割したもの。ロジック変更なし。ヘルパー関数は既存の慣習
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

describe("前受(isPrepaid/prepaidAt)の最小対応", () => {
  it("POST /register でisPrepaid/prepaidAtを指定すると保存される", async () => {
    const res = await callCreateOrder("applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      title: "前受確認",
      totalAmount: 50000,
      items: [],
      isPrepaid: true,
      prepaidAt: "2026-01-05",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };

    const order = await findOrder(body.id);
    expect(order?.isPrepaid).toBe(true);
    expect(order?.prepaidAt).toEqual(new Date("2026-01-05"));
  });

  it("isPrepaid未指定で新規登録すると既定でfalseになる", async () => {
    const res = await callCreateOrder("applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      title: "前受未指定",
      totalAmount: 50000,
      items: [],
    });
    const body = (await res.json()) as { id: string };
    const order = await findOrder(body.id);
    expect(order?.isPrepaid).toBe(false);
    expect(order?.prepaidAt).toBeNull();
  });

  it("PUT /:id でisPrepaidをfalse→trueに更新できる", async () => {
    await seedOrder("O-PREPAID-1", { isPrepaid: false, prepaidAt: null });
    const res = await callUpdateOrder("O-PREPAID-1", "applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      title: "前受更新",
      totalAmount: 10000,
      items: [],
      isPrepaid: true,
      prepaidAt: "2026-01-10",
    });
    expect(res.status).toBe(200);
    const order = await findOrder("O-PREPAID-1");
    expect(order?.isPrepaid).toBe(true);
    expect(order?.prepaidAt).toEqual(new Date("2026-01-10"));
  });

  it("PUT /:id でisPrepaidを送らない場合、既存の値がそのまま維持される", async () => {
    await seedOrder("O-PREPAID-2", { isPrepaid: true, prepaidAt: new Date("2026-01-01") });
    const res = await callUpdateOrder("O-PREPAID-2", "applicant-1", {
      orderDate: "2026-01-01",
      partnerId: "partner-1",
      title: "無関係な項目のみ更新",
      totalAmount: 10000,
      items: [],
    });
    expect(res.status).toBe(200);
    const order = await findOrder("O-PREPAID-2");
    expect(order?.isPrepaid).toBe(true);
  });
});

describe("前受(isPrepaid)の自動仕訳連携", () => {
  const journalDb = drizzle(env.DB_JOURNAL, { schema: journalSchema });

  // journalPostingRules/journalPostingEventsはグローバルなbeforeEach(accountsのFK制約の都合で
  // そちらに集約済み)で既にクリアされている。ここではDB_JOURNAL側(別DB)のみ掃除する
  beforeEach(async () => {
    await journalDb.delete(journalSchema.journalLines);
    await journalDb.delete(journalSchema.journalBatches);
  });

  async function seedAccount(code: string, name: string) {
    await db.insert(schema.accounts).values({
      code,
      name,
      createdBy: "system",
      createdAt: now,
      updatedBy: "system",
      updatedAt: now,
    });
  }

  async function enableAdvanceReceiptRule() {
    await seedAccount("1111", "現金預金");
    await seedAccount("2151", "前受金");
    await db.insert(schema.journalPostingRules).values({
      eventType: "ADVANCE_RECEIPT",
      variableAccountPriority: "ITEM_MASTER_FIRST",
      cashAccountCode: "1111",
      advanceReceivedAccountCode: "2151",
      enabled: true,
      updatedBy: "system",
      updatedAt: now,
    });
  }

  it("PUT /:id でisPrepaidをfalse→trueに更新しても自動転記されず、選択して仕訳にすると現金預金/前受金の複式仕訳が作られる(V-4)", async () => {
    await enableAdvanceReceiptRule();
    await seedPartner("partner-adv-1");
    await callCreateOrder("applicant-1", {
      id: "SO-ADVANCE-1",
      partnerId: "partner-adv-1",
      orderDate: "2026-01-01",
      totalAmount: 30000,
      items: [],
    });

    const res = await callUpdateOrder("SO-ADVANCE-1", "applicant-1", {
      partnerId: "partner-adv-1",
      orderDate: "2026-01-01",
      totalAmount: 30000,
      items: [],
      isPrepaid: true,
      prepaidAt: "2026-01-10",
    });
    expect(res.status).toBe(200);

    // 保存しただけでは仕訳にならない。未転記の一覧に出る
    expect(await db.select().from(schema.journalPostingEvents)).toHaveLength(0);
    expect(await journalDb.select().from(journalSchema.journalBatches)).toHaveLength(0);
    const candidates = await listUnpostedJournalSources(env.DB, "sales_order", {});
    expect(candidates.map((c) => c.sourceRefId)).toEqual(["SO-ADVANCE-1"]);

    // 選んで仕訳にする
    const posted = await postJournalFromSource({
      db: env.DB,
      dbJournal: env.DB_JOURNAL,
      kind: "sales_order",
      sourceRefId: "SO-ADVANCE-1",
      performedById: "EMP001",
    });
    expect(posted.ok && posted.result.status).toBe("POSTED");

    const events = await db.select().from(schema.journalPostingEvents);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("POSTED");
    expect(events[0].sourceType).toBe("sales_order");
    expect(events[0].sourceRefId).toBe("SO-ADVANCE-1");

    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches).toHaveLength(1);
    expect(batches[0].totalDebitAmount).toBe(30000);
    expect(batches[0].totalCreditAmount).toBe(30000);

    const lines = await journalDb
      .select()
      .from(journalSchema.journalLines)
      .where(eq(journalSchema.journalLines.batchId, batches[0].id));
    const debitLine = lines.find((l) => l.side === "DEBIT");
    const creditLine = lines.find((l) => l.side === "CREDIT");
    expect(debitLine?.accountCode).toBe("1111");
    expect(creditLine?.accountCode).toBe("2151");
  });

  it("isPrepaid=trueの受注を作成・再保存しても、自動転記されない(仕訳は選択して作る)", async () => {
    await enableAdvanceReceiptRule();
    await seedPartner("partner-adv-1");
    await callCreateOrder("applicant-1", {
      id: "SO-ADVANCE-2",
      partnerId: "partner-adv-1",
      orderDate: "2026-01-01",
      totalAmount: 15000,
      items: [],
      isPrepaid: true,
    });

    await callUpdateOrder("SO-ADVANCE-2", "applicant-1", {
      partnerId: "partner-adv-1",
      orderDate: "2026-01-01",
      totalAmount: 15000,
      items: [],
      isPrepaid: true,
    });

    expect(await db.select().from(schema.journalPostingEvents)).toHaveLength(0);
    expect(await journalDb.select().from(journalSchema.journalBatches)).toHaveLength(0);
  });

  it("仕訳ルールが未設定の場合は転記しない(受注の保存自体は成功する)", async () => {
    await seedPartner("partner-adv-1");
    await callCreateOrder("applicant-1", {
      id: "SO-ADVANCE-3",
      partnerId: "partner-adv-1",
      orderDate: "2026-01-01",
      totalAmount: 15000,
      items: [],
    });

    const res = await callUpdateOrder("SO-ADVANCE-3", "applicant-1", {
      partnerId: "partner-adv-1",
      orderDate: "2026-01-01",
      totalAmount: 15000,
      items: [],
      isPrepaid: true,
    });
    expect(res.status).toBe(200);
    expect((await findOrder("SO-ADVANCE-3"))?.isPrepaid).toBe(true);

    const events = await db.select().from(schema.journalPostingEvents);
    expect(events).toHaveLength(0);
  });
});
