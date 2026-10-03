import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import { quotesRouter } from "./index";

// #14-2⑥: 元々1233行あったquote.service.test.tsから、基本CRUD(PUT/DELETEのステータスガード・
// 伝票番号の自動採番とVer.UP機構・見積明細更新時のFK制約回帰)の部分を分割したもの。ロジック
// 変更なし。ヘルパー関数は既存の慣習(payment-crud.test.ts/payment-csv.test.ts、
// sales-order-crud/workflow.service.test.ts)にならい、分割後の各ファイルにそのまま複製している
// (共通ファイル化はしない)。

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

async function callCreateQuote(actorUserId: string, payload: unknown) {
  const formData = new FormData();
  formData.append("quoteData", JSON.stringify(payload));
    const ctx = createExecutionContext();
  const _res = await quotesRouter.request(
    "/register",
    {
      method: "POST",
      headers: { Cookie: await buildSessionCookieHeader(actorUserId) },
      body: formData,
    },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

async function callUpdateQuote(id: string, actorUserId: string, payload: unknown) {
  const formData = new FormData();
  formData.append("quoteData", JSON.stringify(payload));
    const ctx = createExecutionContext();
  const _res = await quotesRouter.request(
    `/${id}`,
    {
      method: "PUT",
      headers: { Cookie: await buildSessionCookieHeader(actorUserId) },
      body: formData,
    },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

async function callDeleteQuote(id: string, actorUserId: string) {
    const ctx = createExecutionContext();
  const _res = await quotesRouter.request(
    `/${id}`,
    { method: "DELETE", headers: { Cookie: await buildSessionCookieHeader(actorUserId) } },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
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

async function seedPartner(id: string) {
  await db.insert(schema.partners).values({
    id,
    name: `取引先${id}`,
    createdBy: id,
    createdAt: now,
    updatedBy: id,
    updatedAt: now,
  });
}

async function seedQuote(
  id: string,
  overrides: Partial<typeof schema.quotes.$inferInsert> = {},
) {
  await db.insert(schema.quotes).values({
    id,
    title: `見積${id}`,
    partnerId: "partner-1",
    quoteDate: now,
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

async function seedQuoteItem(
  quoteId: string,
  overrides: Partial<typeof schema.quoteItems.$inferInsert> = {},
) {
  await db.insert(schema.quoteItems).values({
    id: `${quoteId}-item-1`,
    quoteId,
    itemId: "ITEM-1",
    itemName: "テスト品目",
    quantity: 1,
    unitPrice: 10000,
    amount: 10000,
    sortOrder: 0,
    ...overrides,
  });
}

async function enableQuoteApprovalWorkflow() {
  await env.COMPANY_SETTINGS.put(
    "config",
    JSON.stringify({ is_quote_approval_enabled: true }),
  );
}

async function findQuote(id: string) {
  const rows = await db.select().from(schema.quotes).where(eq(schema.quotes.id, id));
  return rows[0] ?? null;
}

beforeEach(async () => {
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  await db.delete(schema.quoteHistoryLogs);
  await db.delete(schema.quoteAttachments);
  await db.delete(schema.quoteItems);
  await db.delete(schema.quotes);
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

// 2026-08-27回帰: 受注が既に作成済みの見積を編集してもFK制約違反にならないこと。
// 以前は明細を全件入れ替えるため、受注明細からの参照(sourceQuoteItemId)をNULLへ退避していたが、
// 見積の既受注数量(BUG-059)の計算に使うようになったため、明細IDを保ったまま更新し、参照を保つ方式に変えた
describe("見積の明細更新: 受注が既に作成済みの見積を編集しても、受注明細とのつながりが保たれる", () => {
  async function seedOrderFromQuote() {
    await seedQuote("Q-1", { status: "DRAFT" });
    await seedQuoteItem("Q-1");
    await seedQuoteItem("Q-1", { id: "Q-1-item-2", itemId: "ITEM-2", itemName: "未受注の品目", sortOrder: 1 });
    await db.insert(schema.salesOrders).values({
      id: "SO-1",
      partnerId: "partner-1",
      sourceQuoteId: "Q-1",
      orderDate: now,
      status: "DRAFT",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.salesOrderItems).values({
      id: "SO-1-item-1",
      salesOrderId: "SO-1",
      sourceQuoteItemId: "Q-1-item-1",
      itemId: "ITEM-1",
      itemName: "テスト品目",
      quantity: 1,
      unitPrice: 10000,
      amount: 10000,
      sortOrder: 0,
    });
  }
  const update = (items: unknown[]) =>
    callUpdateQuote("Q-1", "applicant-1", {
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      title: "受注作成後の見積編集",
      items,
    });
  const quoteItemsOf = async () =>
    (await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.quoteId, "Q-1"))).sort((a, b) => a.sortOrder - b.sortOrder);
  const orderItemSource = async () =>
    (await db.select().from(schema.salesOrderItems).where(eq(schema.salesOrderItems.id, "SO-1-item-1")))[0]?.sourceQuoteItemId;

  it("明細IDを付けて更新すると、明細IDが変わらずに内容が更新され、受注明細からの参照も保たれる。新しい明細は追加される", async () => {
    await seedOrderFromQuote();

    const res = await update([
      { id: "Q-1-item-1", itemId: "ITEM-1", itemName: "テスト品目", quantity: 2, unitPrice: 10000 },
      { id: "Q-1-item-2", itemId: "ITEM-2", itemName: "未受注の品目", quantity: 1, unitPrice: 500 },
      { itemId: "ITEM-3", itemName: "追加の品目", quantity: 1, unitPrice: 300 },
    ]);

    expect(res.status).toBe(200);
    const items = await quoteItemsOf();
    expect(items.map((i) => [i.itemId, i.quantity])).toEqual([["ITEM-1", 2], ["ITEM-2", 1], ["ITEM-3", 1]]);
    expect(items[0].id).toBe("Q-1-item-1");
    expect(items[1].unitPrice).toBe(500);
    expect(await orderItemSource()).toBe("Q-1-item-1");
  });

  it("受注から参照されていない明細は削除できる", async () => {
    await seedOrderFromQuote();

    const res = await update([{ id: "Q-1-item-1", itemId: "ITEM-1", itemName: "テスト品目", quantity: 1, unitPrice: 10000 }]);

    expect(res.status).toBe(200);
    expect((await quoteItemsOf()).map((i) => i.id)).toEqual(["Q-1-item-1"]);
  });

  it("受注から参照されている明細を削除しようとすると400で、見積は変わらない(明細IDを送らない更新も同じ)", async () => {
    await seedOrderFromQuote();

    const res = await update([{ itemId: "ITEM-1", itemName: "テスト品目", quantity: 5, unitPrice: 10000 }]);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("SO-1");
    expect((await quoteItemsOf()).map((i) => [i.id, i.quantity])).toEqual([["Q-1-item-1", 1], ["Q-1-item-2", 1]]);
    expect(await orderItemSource()).toBe("Q-1-item-1");
  });

  it("別の見積の明細IDを送っても、その明細は書き換えず新しい明細として追加する", async () => {
    await seedOrderFromQuote();
    await seedQuote("Q-OTHER");
    await seedQuoteItem("Q-OTHER", { id: "Q-OTHER-item-1", quantity: 9 });

    const res = await update([
      { id: "Q-1-item-1", itemId: "ITEM-1", itemName: "テスト品目", quantity: 1, unitPrice: 10000 },
      { id: "Q-OTHER-item-1", itemId: "ITEM-9", itemName: "流用", quantity: 1, unitPrice: 1 },
    ]);

    expect(res.status).toBe(200);
    const other = await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.id, "Q-OTHER-item-1"));
    expect(other[0].quantity).toBe(9);
    expect((await quoteItemsOf()).map((i) => i.itemId)).toEqual(["ITEM-1", "ITEM-9"]);
  });
});

describe("BUG-049: 見積の保存は、ヘッダー・明細・添付・履歴を1回の batch で書き込む", () => {
  it("明細の登録が途中で失敗した場合は何も書き込まず、元のヘッダー・明細が残る", async () => {
    await seedQuote("Q-1", { status: "DRAFT" });
    await seedQuoteItem("Q-1");

    const res = await callUpdateQuote("Q-1", "applicant-1", {
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      title: "失敗する更新",
      // 存在しない税区分を指定して、明細の登録を外部キーの制約で失敗させる
      items: [{ itemId: "ITEM-1", itemName: "新しい明細", quantity: 1, unitPrice: 500, taxCategoryCode: "NO_SUCH_TAX" }],
    });

    expect(res.status).toBe(500);
    const [quote] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, "Q-1"));
    expect(quote.title).toBe("見積Q-1");
    const items = await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.quoteId, "Q-1"));
    expect(items.map((i) => i.id)).toEqual(["Q-1-item-1"]);
  });
});

describe("PUT /:id のステータスガード", () => {
  it("DRAFTの見積は通常通り直接更新できる", async () => {
    await seedQuote("Q-1", { status: "DRAFT" });
    const res = await callUpdateQuote("Q-1", "applicant-1", {
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      title: "更新後タイトル",
      items: [],
    });
    expect(res.status).toBe(200);
    const quote = await findQuote("Q-1");
    expect(quote?.title).toBe("更新後タイトル");
  });

  it("承認機能ONの場合、PENDING_APPROVAL中の見積は直接更新できない(400)", async () => {
    await enableQuoteApprovalWorkflow();
    await seedQuote("Q-1", { status: "PENDING_APPROVAL" });
    const res = await callUpdateQuote("Q-1", "applicant-1", {
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      items: [],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("承認処理中");
  });

  it("承認機能ONの場合、PENDING_DELETION中の見積は直接更新できない(400)", async () => {
    await enableQuoteApprovalWorkflow();
    await seedQuote("Q-1", { status: "PENDING_DELETION" });
    const res = await callUpdateQuote("Q-1", "applicant-1", {
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      items: [],
    });
    expect(res.status).toBe(400);
  });

  it("承認機能OFFの場合、会社設定で無効化した時点でPENDING_APPROVAL中だった見積も直接更新できる(取り下げ不要)", async () => {
    await seedQuote("Q-1", { status: "PENDING_APPROVAL" });
    const res = await callUpdateQuote("Q-1", "applicant-1", {
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      title: "OFF化後は直接編集可",
      status: "DRAFT",
      items: [],
    });
    expect(res.status).toBe(200);
    const quote = await findQuote("Q-1");
    expect(quote?.title).toBe("OFF化後は直接編集可");
    expect(quote?.status).toBe("DRAFT");
  });

  it("承認機能ONの場合、APPROVED済みの見積は直接更新できない(400、変更申請への案内)", async () => {
    await enableQuoteApprovalWorkflow();
    await seedQuote("Q-1", { status: "APPROVED" });
    const res = await callUpdateQuote("Q-1", "applicant-1", {
      quoteDate: "2026-01-01",
      items: [],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("/api/approvals/request-update");
  });

  it("承認機能OFFの場合、APPROVED済みの見積も直接更新できる", async () => {
    await seedQuote("Q-1", { status: "APPROVED" });
    const res = await callUpdateQuote("Q-1", "applicant-1", {
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      title: "OFF時は直接更新可",
      items: [],
    });
    expect(res.status).toBe(200);
    const quote = await findQuote("Q-1");
    expect(quote?.title).toBe("OFF時は直接更新可");
  });
});

describe("DELETE /:id のステータスガード", () => {
  it("DRAFTの見積は直接削除できる", async () => {
    await seedQuote("Q-1", { status: "DRAFT" });
    const res = await callDeleteQuote("Q-1", "applicant-1");
    expect(res.status).toBe(200);
    expect(await findQuote("Q-1")).toBeNull();
  });

  it("APPROVED済みの見積は直接削除できない(400)", async () => {
    await seedQuote("Q-1", { status: "APPROVED" });
    const res = await callDeleteQuote("Q-1", "applicant-1");
    expect(res.status).toBe(400);
    expect(await findQuote("Q-1")).not.toBeNull();
  });
});

describe("伝票番号フォーマット統一化: 見積の自動採番とVer.UP(改訂)機構の共存", () => {
  it("idを指定しない新規登録は、末尾-1付きの自動採番IDになる(1版から開始、見積のVer.UP機構が前提とする形式)", async () => {
    const res = await callCreateQuote("applicant-1", {
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      items: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^QT-\d{4}-1$/);
  });

  it("Ver.UP(既存IDをそのまま送って改定)しても、ランダム部分が意図せず失われず-2が正しく付与される", async () => {
    const createRes = await callCreateQuote("applicant-1", {
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      items: [],
    });
    const { id: originalId } = (await createRes.json()) as { id: string };

    // フロントのVer.UPは既存のquoteIdをそのままbody.idとして送信する(useQuoteSaveActions.ts参照)
    const revisionRes = await callCreateQuote("applicant-1", {
      id: originalId,
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      items: [],
    });
    expect(revisionRes.status).toBe(200);
    const { id: revisionId } = (await revisionRes.json()) as { id: string };

    // ランダム4桁部分を含むベース(originalIdから末尾"-1"を除いた部分)がそのまま維持され、
    // 末尾だけが"-2"に置き換わっていることを確認する(誤ってランダム部分ごと捨てられていないこと)
    const expectedBase = originalId.slice(0, originalId.lastIndexOf("-"));
    expect(revisionId).toBe(`${expectedBase}-2`);
  });
});
