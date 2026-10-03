import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as journalSchema from "../../../db/journal-schema";
import { journalSourcesRouter } from "./index";

/**
 * V-4: 伝票を選んで仕訳を作る(入金消込・支払消込・単体入金)。
 */

const mainDb = drizzle(env.DB, { schema });
const journalDb = drizzle(env.DB_JOURNAL, { schema: journalSchema });
const now = new Date();
const audit = { createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now };

async function request(path: string, init?: RequestInit) {
  const ctx = createExecutionContext();
  const res = await journalSourcesRouter.request(path, init, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const getList = async (query: string) => {
  const res = await request(`/?${query}`);
  return { res, body: (await res.json()) as any };
};
const post = (kind: string, sourceRefId: string) =>
  request("/post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, sourceRefId }),
  });

async function enableRules() {
  await mainDb.insert(schema.journalPostingRules).values([
    { eventType: "RECEIPT", cashAccountCode: "1111", receivableAccountCode: "1131", enabled: true },
    { eventType: "DISBURSEMENT", payableAccountCode: "2101", cashAccountCode: "1111", enabled: true },
    { eventType: "ADVANCE_RECEIPT", cashAccountCode: "1111", advanceReceivedAccountCode: "2201", enabled: true },
  ]);
}

beforeEach(async () => {
  await journalDb.delete(journalSchema.journalLines);
  await journalDb.delete(journalSchema.journalBatches);
  await mainDb.delete(schema.journalPostingEvents);
  await mainDb.delete(schema.journalPostingRules);
  await mainDb.delete(schema.paymentReceipts);
  await mainDb.delete(schema.paymentDisbursements);
  await mainDb.delete(schema.cashReceipts);
  await mainDb.delete(schema.billingHeaders);
  await mainDb.delete(schema.paymentHeaders);
  await mainDb.delete(schema.accounts);
  await mainDb.delete(schema.partners);
  await mainDb.delete(schema.users);

  await mainDb.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    createdAt: now,
    updatedAt: now,
  });
  await mainDb.insert(schema.accounts).values(
    [
      ["1111", "現金預金"],
      ["1131", "売掛金"],
      ["2101", "買掛金"],
      ["2201", "前受金"],
    ].map(([code, name]) => ({ code, name, status: "active", ...audit })),
  );
  await mainDb.insert(schema.partners).values([
    { id: "P-1", name: "得意先A", ...audit },
    { id: "P-2", name: "得意先B", ...audit },
  ]);
  await mainDb.insert(schema.billingHeaders).values([
    { id: "BL-1", partnerId: "P-1", billingDate: now, mode: "PERIODIC", ...audit },
    { id: "BL-2", partnerId: "P-2", billingDate: now, mode: "PERIODIC", ...audit },
  ]);
  await mainDb.insert(schema.cashReceipts).values({
    id: "CR-1",
    partnerId: "P-1",
    receiptDate: new Date("2026-09-03"),
    amount: 3000,
    ...audit,
  });
  await mainDb.insert(schema.paymentReceipts).values([
    { id: "PR-1", billingHeaderId: "BL-1", receivedDate: new Date("2026-09-01"), amount: 10000, reconciledById: "EMP001", reconciledAt: now },
    { id: "PR-2", billingHeaderId: "BL-2", receivedDate: new Date("2026-09-10"), amount: 5000, reconciledById: "EMP001", reconciledAt: now },
    // 単体入金の紐づけで作られた入金消込(仕訳の対象外)
    { id: "PR-3", billingHeaderId: "BL-1", receivedDate: new Date("2026-09-03"), amount: 3000, cashReceiptId: "CR-1", reconciledById: "EMP001", reconciledAt: now },
    // 金額0円は対象外
    { id: "PR-4", billingHeaderId: "BL-1", receivedDate: new Date("2026-09-04"), amount: 0, reconciledById: "EMP001", reconciledAt: now },
  ]);
  await mainDb.insert(schema.paymentHeaders).values({
    id: "PAY-1",
    partnerId: "P-2",
    paymentDate: now,
    mode: "PERIODIC",
    ...audit,
  });
  await mainDb.insert(schema.paymentDisbursements).values({
    id: "PD-1",
    paymentHeaderId: "PAY-1",
    paidDate: new Date("2026-09-05"),
    amount: 7000,
    reconciledById: "EMP001",
    reconciledAt: now,
  });
});

describe("GET /: 未転記の一覧", () => {
  it("入金消込: 単体入金由来と0円を除いた伝票を、日付順に返す", async () => {
    const { res, body } = await getList("kind=payment_receipt");
    expect(res.status).toBe(200);
    expect(body.map((r: any) => r.sourceRefId)).toEqual(["PR-1", "PR-2"]);
    expect(body[0]).toMatchObject({ partnerName: "得意先A", amount: 10000, eventType: "RECEIPT", kindLabel: "入金(入金消込)" });
  });

  it("支払消込・単体入金(前受)も返す", async () => {
    expect((await getList("kind=payment_disbursement")).body.map((r: any) => r.sourceRefId)).toEqual(["PD-1"]);
    const cash = (await getList("kind=cash_receipt")).body;
    expect(cash).toHaveLength(1);
    expect(cash[0]).toMatchObject({ sourceRefId: "CR-1", eventType: "ADVANCE_RECEIPT", amount: 3000 });
  });

  it("日付(当日を含む)と取引先で絞り込める", async () => {
    expect((await getList("kind=payment_receipt&startDate=2026-09-05")).body.map((r: any) => r.sourceRefId)).toEqual(["PR-2"]);
    expect((await getList("kind=payment_receipt&endDate=2026-09-01")).body.map((r: any) => r.sourceRefId)).toEqual(["PR-1"]);
    expect((await getList("kind=payment_receipt&partnerId=P-2")).body.map((r: any) => r.sourceRefId)).toEqual(["PR-2"]);
  });

  it("不正な種別・日付は400", async () => {
    expect((await getList("kind=unknown")).res.status).toBe(400);
    expect((await getList("kind=payment_receipt&startDate=2026/09/01")).res.status).toBe(400);
  });
});

describe("POST /post: 選んだ伝票を仕訳にする", () => {
  it("入金消込: 借方=現金預金/貸方=売掛金の仕訳を作り、起票イベントを記録し、一覧から消える", async () => {
    await enableRules();
    const res = await post("payment_receipt", "PR-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ success: true, status: "POSTED" });

    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      sourceType: "payment_receipt",
      sourceRefId: "PR-1",
      eventType: "RECEIPT",
      totalDebitAmount: 10000,
      totalCreditAmount: 10000,
    });
    expect(batches[0].postedById).toBeTruthy();
    expect(batches[0].entryDate.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(batches[0].description).toContain("得意先A");
    const lines = await journalDb
      .select()
      .from(journalSchema.journalLines)
      .where(eq(journalSchema.journalLines.batchId, batches[0].id));
    expect(lines.map((l) => [l.side, l.accountCode, l.amount]).sort()).toEqual([
      ["CREDIT", "1131", 10000],
      ["DEBIT", "1111", 10000],
    ]);

    const events = await mainDb.select().from(schema.journalPostingEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sourceType: "payment_receipt", sourceRefId: "PR-1", status: "POSTED" });

    expect((await getList("kind=payment_receipt")).body.map((r: any) => r.sourceRefId)).toEqual(["PR-2"]);
  });

  it("同じ伝票をもう一度仕訳にしても二重にならない", async () => {
    await enableRules();
    await post("payment_receipt", "PR-1");
    const again = (await (await post("payment_receipt", "PR-1")).json()) as any;
    expect(again).toMatchObject({ success: true, status: "ALREADY_POSTED" });
    expect(await journalDb.select().from(journalSchema.journalBatches)).toHaveLength(1);
  });

  it("支払消込: 借方=買掛金/貸方=現金預金", async () => {
    await enableRules();
    expect(((await (await post("payment_disbursement", "PD-1")).json()) as any).status).toBe("POSTED");
    const lines = await journalDb.select().from(journalSchema.journalLines);
    expect(lines.map((l) => [l.side, l.accountCode, l.amount]).sort()).toEqual([
      ["CREDIT", "1111", 7000],
      ["DEBIT", "2101", 7000],
    ]);
  });

  it("単体入金: 借方=現金預金/貸方=前受金(前受として仕訳)", async () => {
    await enableRules();
    expect(((await (await post("cash_receipt", "CR-1")).json()) as any).status).toBe("POSTED");
    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches[0]).toMatchObject({ sourceType: "cash_receipt", eventType: "ADVANCE_RECEIPT" });
    const lines = await journalDb.select().from(journalSchema.journalLines);
    expect(lines.map((l) => [l.side, l.accountCode]).sort()).toEqual([
      ["CREDIT", "2201"],
      ["DEBIT", "1111"],
    ]);
  });

  it("単体入金由来の入金消込は、現金を二重に計上しないよう400で断る", async () => {
    await enableRules();
    const res = await post("payment_receipt", "PR-3");
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).message).toContain("CR-1");
    expect(await journalDb.select().from(journalSchema.journalBatches)).toHaveLength(0);
  });

  it("仕訳ルールが未設定・無効なら400(理由つき)で、起票イベントも作らない", async () => {
    const res = await post("payment_receipt", "PR-1");
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).message).toContain("RECEIPT");
    expect(await mainDb.select().from(schema.journalPostingEvents)).toHaveLength(0);
  });

  it("存在しない伝票は404、金額0円は400、不正な入力は400", async () => {
    await enableRules();
    expect((await post("payment_receipt", "NOPE")).status).toBe(404);
    expect((await post("payment_receipt", "PR-4")).status).toBe(400);
    expect((await post("unknown", "PR-1")).status).toBe(400);
    expect((await post("payment_receipt", "")).status).toBe(400);
  });
});

// migration 0088: 単体入金の紐づけで作られた既存の入金消込へ、cash_receipt_idを復元する
import migration0088 from "../../../../drizzle/main/0088_curious_leech.sql?raw";

describe("migration 0088: 既存の入金消込へのcash_receipt_idの復元", () => {
  it("memoの「単体入金[ID]」が実在する単体入金のものだけ復元し、それ以外は変えない", async () => {
    await mainDb.insert(schema.paymentReceipts).values([
      { id: "PR-M1", billingHeaderId: "BL-1", receivedDate: now, amount: 100, memo: "単体入金[CR-1] 手入力", reconciledById: "EMP001", reconciledAt: now },
      { id: "PR-M2", billingHeaderId: "BL-1", receivedDate: now, amount: 100, memo: "単体入金[NOPE] 存在しない", reconciledById: "EMP001", reconciledAt: now },
      { id: "PR-M3", billingHeaderId: "BL-1", receivedDate: now, amount: 100, memo: "手入力の消込", reconciledById: "EMP001", reconciledAt: now },
    ]);
    const update = migration0088
      .split("--> statement-breakpoint")
      .map((chunk) => chunk.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim())
      .find((stmt) => stmt.startsWith("UPDATE"));
    expect(update).toBeDefined();
    await env.DB.prepare(update!.replace(/\s+/g, " ")).run();

    const rows = await mainDb.select().from(schema.paymentReceipts);
    const byId = new Map(rows.map((r) => [r.id, r.cashReceiptId]));
    expect(byId.get("PR-M1")).toBe("CR-1");
    expect(byId.get("PR-M2")).toBeNull();
    expect(byId.get("PR-M3")).toBeNull();
  });
});
