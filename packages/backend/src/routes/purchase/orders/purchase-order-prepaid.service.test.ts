import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import { purchaseOrdersRouter } from "./index";
import * as journalSchema from "../../../db/journal-schema";
import { listUnpostedJournalSources, postJournalFromSource } from "../../../platform/journal/journal-sources";

// #14-2⑥: 元々1189行あったpurchase-order.service.test.tsから、前払(isPaid)の仕訳(V-4: 自動転記は
// 廃止し、伝票を選んで仕訳を作成する)の部分を分割したもの。ロジック変更なし。ヘルパー関数は
// 既存の慣習(payment-crud.test.ts/payment-csv.test.ts、sales-order-crud/workflow.service.test.ts)
// にならい、分割後の各ファイルにそのまま複製している(共通ファイル化はしない)。

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
  const res = await purchaseOrdersRouter.request(
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
  const res = await purchaseOrdersRouter.request(
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

async function findOrder(id: string) {
  const rows = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
  return rows[0] ?? null;
}

beforeEach(async () => {
  await db.delete(schema.orderAttachments);
  // 追加要望対応: purchaseRecognitionItems.sourceOrderItemIdがorderItems.idをFK参照するため、
  // orderItemsを消す前に削除する必要がある
  await db.delete(schema.purchaseRecognitionItems);
  await db.delete(schema.purchaseRecognitions);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
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
  // journal_posting_rulesがaccountsをFK参照するため、accountsの削除より先に消す必要がある
  await db.delete(schema.journalPostingEvents);
  await db.delete(schema.journalPostingRules);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
  await db.delete(schema.partners);
  await db.delete(schema.taxCategories);
  await env.COMPANY_SETTINGS.delete("config");

  await seedUser("buyer-1");
  await seedDepartment("dept-a", "D001", "資材部");
});

describe("前払(isPaid)の仕訳(V-4: 自動転記はせず、伝票を選んで仕訳を作成する)", () => {
  const journalDb = drizzle(env.DB_JOURNAL, { schema: journalSchema });

  // journalPostingRules/journalPostingEventsはグローバルなbeforeEach(accountsのFK制約の都合で
  // そちらに集約済み)で既にクリアされている。ここではDB_JOURNAL側(別DB)のみ掃除する
  beforeEach(async () => {
    await journalDb.delete(journalSchema.journalLines);
    await journalDb.delete(journalSchema.journalBatches);
  });

  async function enablePrepaymentRule() {
    await seedAccount("1151"); // 前渡金
    await seedAccount("1111"); // 現金預金
    await db.insert(schema.journalPostingRules).values({
      eventType: "PREPAYMENT",
      variableAccountPriority: "ITEM_MASTER_FIRST",
      prepaidAccountCode: "1151",
      cashAccountCode: "1111",
      enabled: true,
      updatedBy: "system",
      updatedAt: now,
    });
  }

  it("PUT /:id でisPaidをfalse→trueに更新しても自動転記されず、選択して仕訳にすると前渡金/現金預金の複式仕訳が作られる", async () => {
    await enablePrepaymentRule();
    await seedPartner("SUPP-1");
    await callCreateOrder("buyer-1", {
      id: "PO-PREPAY-1",
      partnerId: "SUPP-1",
      orderDate: now.toISOString(),
      totalAmount: 55000,
      items: [],
    });

    const res = await callUpdateOrder("PO-PREPAY-1", "buyer-1", {
      partnerId: "SUPP-1",
      orderDate: now.toISOString(),
      totalAmount: 55000,
      items: [],
      isPaid: true,
      paidAt: now.toISOString(),
    });
    expect(res.status).toBe(200);

    // 保存しただけでは仕訳にならない
    expect(await db.select().from(schema.journalPostingEvents)).toHaveLength(0);
    expect(await journalDb.select().from(journalSchema.journalBatches)).toHaveLength(0);

    // 未転記の一覧に出る
    const candidates = await listUnpostedJournalSources(env.DB, "purchase_order", {});
    expect(candidates.map((c) => c.sourceRefId)).toEqual(["PO-PREPAY-1"]);

    // 選んで仕訳にする
    const posted = await postJournalFromSource({
      db: env.DB,
      dbJournal: env.DB_JOURNAL,
      kind: "purchase_order",
      sourceRefId: "PO-PREPAY-1",
      performedById: "EMP001",
    });
    expect(posted.ok && posted.result.status).toBe("POSTED");

    const events = await db.select().from(schema.journalPostingEvents);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("POSTED");
    expect(events[0].sourceType).toBe("purchase_order");
    expect(events[0].sourceRefId).toBe("PO-PREPAY-1");

    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches).toHaveLength(1);
    expect(batches[0].totalDebitAmount).toBe(55000);
    expect(batches[0].totalCreditAmount).toBe(55000);

    const lines = await journalDb
      .select()
      .from(journalSchema.journalLines)
      .where(eq(journalSchema.journalLines.batchId, batches[0].id));
    const debitLine = lines.find((l) => l.side === "DEBIT");
    const creditLine = lines.find((l) => l.side === "CREDIT");
    expect(debitLine?.accountCode).toBe("1151");
    expect(creditLine?.accountCode).toBe("1111");
  });

  it("isPaid=trueの発注を作成・再保存しても、自動転記されない(仕訳は選択して作る)", async () => {
    await enablePrepaymentRule();
    await seedPartner("SUPP-1");
    await callCreateOrder("buyer-1", {
      id: "PO-PREPAY-2",
      partnerId: "SUPP-1",
      orderDate: now.toISOString(),
      totalAmount: 20000,
      items: [],
      isPaid: true,
    });

    // 既にisPaid=trueの状態でもう一度保存する(false→trueの遷移ではない)
    await callUpdateOrder("PO-PREPAY-2", "buyer-1", {
      partnerId: "SUPP-1",
      orderDate: now.toISOString(),
      totalAmount: 20000,
      items: [],
      isPaid: true,
    });

    expect(await db.select().from(schema.journalPostingEvents)).toHaveLength(0);
    expect(await journalDb.select().from(journalSchema.journalBatches)).toHaveLength(0);
  });

  it("仕訳ルールが無効化(enabled=false)の場合は転記しない", async () => {
    await seedAccount("1151");
    await seedAccount("1111");
    await db.insert(schema.journalPostingRules).values({
      eventType: "PREPAYMENT",
      variableAccountPriority: "ITEM_MASTER_FIRST",
      prepaidAccountCode: "1151",
      cashAccountCode: "1111",
      enabled: false,
      updatedBy: "system",
      updatedAt: now,
    });
    await seedPartner("SUPP-1");
    await callCreateOrder("buyer-1", {
      id: "PO-PREPAY-3",
      partnerId: "SUPP-1",
      orderDate: now.toISOString(),
      totalAmount: 20000,
      items: [],
    });

    const res = await callUpdateOrder("PO-PREPAY-3", "buyer-1", {
      partnerId: "SUPP-1",
      orderDate: now.toISOString(),
      totalAmount: 20000,
      items: [],
      isPaid: true,
    });
    expect(res.status).toBe(200);

    const events = await db.select().from(schema.journalPostingEvents);
    expect(events).toHaveLength(0);
    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches).toHaveLength(0);
  });

  it("仕訳ルールが未設定の場合は転記しない(発注の保存自体は成功する)", async () => {
    await seedPartner("SUPP-1");
    await callCreateOrder("buyer-1", {
      id: "PO-PREPAY-4",
      partnerId: "SUPP-1",
      orderDate: now.toISOString(),
      totalAmount: 20000,
      items: [],
    });

    const res = await callUpdateOrder("PO-PREPAY-4", "buyer-1", {
      partnerId: "SUPP-1",
      orderDate: now.toISOString(),
      totalAmount: 20000,
      items: [],
      isPaid: true,
    });
    expect(res.status).toBe(200);
    expect((await findOrder("PO-PREPAY-4"))?.isPaid).toBe(true);

    const events = await db.select().from(schema.journalPostingEvents);
    expect(events).toHaveLength(0);
  });
});
