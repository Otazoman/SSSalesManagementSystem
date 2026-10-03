import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { cashReceiptsRouter } from "./index";

const db = drizzle(env.DB, { schema });
const now = new Date("2026-09-10T00:00:00Z");
const audit = { createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now };

beforeEach(async () => {
  await db.delete(schema.paymentReceipts);
  await db.delete(schema.cashReceipts);
  await db.delete(schema.billingItems);
  await db.delete(schema.billingHeaders);
  await db.delete(schema.partners);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.put("config", JSON.stringify({}));

  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "emp001@example.com",
    name: "テスト",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.partners).values([
    { id: "P-1", name: "取引先1", type: "CUSTOMER", ...audit },
    { id: "P-2", name: "取引先2", type: "CUSTOMER", ...audit },
  ]);
});

async function seedBilling(id: string, partnerId = "P-1", totalAmount = 11000) {
  await db.insert(schema.billingHeaders).values({
    id,
    partnerId,
    billingDate: now,
    mode: "PER_TRANSACTION",
    status: "DRAFT",
    totalAmount,
    taxAmount: 0,
    reconciledAmount: 0,
    reconciliationStatus: "UNRECONCILED",
    ...audit,
  });
}

async function call(path: string, method = "GET", body?: unknown) {
  const ctx = createExecutionContext();
  const res = await cashReceiptsRouter.request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function register(overrides: Record<string, unknown> = {}) {
  const res = await call("/register", "POST", {
    partnerId: "P-1",
    receiptDate: "2026-09-10",
    amount: 5000,
    method: "BANK_TRANSFER",
    memo: "手入力の入金",
    ...overrides,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

describe("追加要望L-1-a: 単体入金", () => {
  it("請求を介さずに入金を登録でき、伝票番号が自動採番され、一覧・詳細で取得できる", async () => {
    const id = await register();
    expect(id).toMatch(/^RV/);

    const detail = (await (await call(`/${id}`)).json()) as any;
    expect(detail).toMatchObject({ id, partnerId: "P-1", amount: 5000, status: "UNLINKED", billingHeaderId: null });

    const list = (await (await call("/")).json()) as any[];
    expect(list.map((r) => r.id)).toEqual([id]);
  });

  it("入力不正(金額0以下・存在しない取引先・日付不正)は400", async () => {
    expect((await call("/register", "POST", { partnerId: "P-1", receiptDate: "2026-09-10", amount: 0 })).status).toBe(400);
    expect((await call("/register", "POST", { partnerId: "NOPE", receiptDate: "2026-09-10", amount: 100 })).status).toBe(400);
    expect((await call("/register", "POST", { partnerId: "P-1", receiptDate: "xxxx", amount: 100 })).status).toBe(400);
    expect((await call("/register", "POST", { partnerId: "P-1", amount: 100 })).status).toBe(400);
  });

  it("取引先・状態・期間で絞り込める", async () => {
    await register({ receiptDate: "2026-09-01" });
    await register({ partnerId: "P-2", receiptDate: "2026-09-15" });
    expect(((await (await call("/?partnerId=P-2")).json()) as any[]).length).toBe(1);
    expect(((await (await call("/?startDate=2026-09-10")).json()) as any[]).length).toBe(1);
    expect(((await (await call("/?endDate=2026-09-01")).json()) as any[]).length).toBe(1);
    expect(((await (await call("/?status=LINKED")).json()) as any[]).length).toBe(0);
    expect(((await (await call("/?status=UNLINKED")).json()) as any[]).length).toBe(2);
  });

  it("請求へ紐づけると既存の入金消込ロジックで消込され(一部消込→完了)、紐づけ済みになる", async () => {
    await seedBilling("BL-1", "P-1", 11000);
    const first = await register({ amount: 5000 });
    const res = await call(`/${first}/link`, "POST", { billingHeaderId: "BL-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reconciledAmount: 5000, reconciliationStatus: "PARTIALLY_RECONCILED" });

    const linked = (await (await call(`/${first}`)).json()) as any;
    expect(linked).toMatchObject({ status: "LINKED", billingHeaderId: "BL-1" });
    const receipts = await db.select().from(schema.paymentReceipts).where(eq(schema.paymentReceipts.billingHeaderId, "BL-1"));
    expect(receipts).toHaveLength(1);
    expect(receipts[0].memo).toContain(first);
    // V-4: 単体入金由来の入金消込を判別できる(仕訳では現金を二重に計上しないため)
    expect(receipts[0].cashReceiptId).toBe(first);

    const second = await register({ amount: 6000 });
    const res2 = await call(`/${second}/link`, "POST", { billingHeaderId: "BL-1" });
    expect(await res2.json()).toMatchObject({ reconciledAmount: 11000, reconciliationStatus: "RECONCILED" });
  });

  it("取引先が違う請求・存在しない請求・既に紐づけ済みの入金は紐づけできない(消込は二重に行われない)", async () => {
    await seedBilling("BL-1", "P-1");
    await seedBilling("BL-2", "P-2");
    const id = await register();

    expect((await call(`/${id}/link`, "POST", { billingHeaderId: "BL-2" })).status).toBe(400);
    expect((await call(`/${id}/link`, "POST", { billingHeaderId: "NOPE" })).status).toBe(404);
    expect((await call(`/${id}/link`, "POST", {})).status).toBe(400);

    expect((await call(`/${id}/link`, "POST", { billingHeaderId: "BL-1" })).status).toBe(200);
    expect((await call(`/${id}/link`, "POST", { billingHeaderId: "BL-1" })).status).toBe(400);
    expect((await db.select().from(schema.paymentReceipts)).length).toBe(1);
  });

  it("未紐づけの入金のみ削除でき、紐づけ済みは400、存在しなければ404", async () => {
    await seedBilling("BL-1");
    const unlinked = await register();
    const linked = await register();
    await call(`/${linked}/link`, "POST", { billingHeaderId: "BL-1" });

    expect((await call(`/${linked}`, "DELETE")).status).toBe(400);
    expect((await call(`/${unlinked}`, "DELETE")).status).toBe(200);
    expect((await call(`/${unlinked}`)).status).toBe(404);
    expect((await call("/NOPE", "DELETE")).status).toBe(404);
  });

  it("CSVを出力できる(検索条件を反映)", async () => {
    await register({ memo: "メモ" });
    await register({ partnerId: "P-2" });
    const res = await call("/csv-download?partnerId=P-1");
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.split("\n");
    expect(lines[0]).toContain("id,partnerId,receiptDate,amount");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("P-1");
  });
});
