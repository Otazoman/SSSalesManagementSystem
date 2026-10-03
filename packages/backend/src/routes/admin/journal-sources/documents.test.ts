import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { pairJournalLines } from "../../../platform/journal/pair-journal-lines";
import * as journalSchema from "../../../db/journal-schema";
import { journalSourcesRouter } from "./index";

/**
 * V-4: 前払(発注)・前受(受注)・売上・仕入を選んで仕訳にする。売上は前受金(単体入金)の充当つき。
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
const getJson = async (path: string) => {
  const res = await request(path);
  return { res, body: (await res.json()) as any };
};
const post = async (body: Record<string, unknown>) => {
  const res = await request("/post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, body: (await res.json()) as any };
};

async function lineSummary(sourceRefId: string) {
  const batches = await journalDb.select().from(journalSchema.journalBatches);
  const batch = batches.find((b) => b.sourceRefId === sourceRefId)!;
  const lines = await journalDb.select().from(journalSchema.journalLines);
  return {
    batch,
    lines: lines
      .filter((l) => l.batchId === batch.id)
      .map((l) => [l.side, l.accountCode, l.amount] as const)
      .sort((a, b) => a.join().localeCompare(b.join())),
    // V-5: 「借方〇〇/貸方〇〇」の組([借方科目, 貸方科目, 金額])。保存順に借方行・貸方行が並ぶ
    pairs: pairJournalLines(
      lines.filter((l) => l.batchId === batch.id).sort((a, b) => a.lineNo - b.lineNo),
    ).map((p) => [p.debit?.accountCode, p.credit?.accountCode, p.amount]),
  };
}

async function seedSalesInvoice(id: string, overrides: Record<string, unknown> = {}) {
  await mainDb.insert(schema.salesInvoices).values({
    id,
    partnerId: "P-1",
    invoiceDate: new Date("2026-09-08"),
    status: "APPROVED",
    documentType: "SALE",
    // totalAmount は税込(BUG-047。明細 1,000円 + 消費税 100円)
    totalAmount: 1100,
    taxAmount: 100,
    ...audit,
    ...overrides,
  });
  await mainDb.insert(schema.salesInvoiceItems).values({
    id: `${id}-L1`,
    salesInvoiceId: id,
    itemName: "品目1",
    quantity: 1,
    unitPrice: 1000,
    amount: 1000,
    accountCode: "4101",
  });
}

beforeEach(async () => {
  await journalDb.delete(journalSchema.journalLines);
  await journalDb.delete(journalSchema.journalBatches);
  await mainDb.delete(schema.cashReceiptAdvanceApplications);
  await mainDb.delete(schema.journalPostingEvents);
  await mainDb.delete(schema.journalPostingRules);
  await mainDb.delete(schema.cashReceipts);
  await mainDb.delete(schema.salesInvoiceItems);
  await mainDb.delete(schema.salesInvoices);
  await mainDb.delete(schema.purchaseRecognitionItems);
  await mainDb.delete(schema.purchaseRecognitions);
  await mainDb.delete(schema.orders);
  await mainDb.delete(schema.salesOrders);
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
      ["1151", "前渡金"],
      ["1181", "仮払消費税"],
      ["2101", "買掛金"],
      ["2201", "前受金"],
      ["2301", "仮受消費税"],
      ["4101", "売上高"],
      ["5101", "仕入高"],
    ].map(([code, name]) => ({ code, name, status: "active", ...audit })),
  );
  await mainDb.insert(schema.partners).values([
    { id: "P-1", name: "得意先A", ...audit },
    { id: "P-2", name: "得意先B", ...audit },
  ]);
  await mainDb.insert(schema.journalPostingRules).values([
    { eventType: "SALES", receivableAccountCode: "1131", advanceReceivedAccountCode: "2201", taxAccountCode: "2301", variableAccountFallbackCode: "4101", enabled: true },
    { eventType: "PURCHASE", payableAccountCode: "2101", prepaidAccountCode: "1151", taxAccountCode: "1181", variableAccountFallbackCode: "5101", enabled: true },
    { eventType: "PREPAYMENT", prepaidAccountCode: "1151", cashAccountCode: "1111", enabled: true },
    { eventType: "ADVANCE_RECEIPT", advanceReceivedAccountCode: "2201", cashAccountCode: "1111", enabled: true },
  ]);
});

describe("売上(sales_invoice)", () => {
  it("承認済みの売上だけが一覧に出る(下書きは出ない)。区分・税込金額つき", async () => {
    await seedSalesInvoice("SI-1");
    await seedSalesInvoice("SI-2", { status: "DRAFT" });
    const { body } = await getJson("/?kind=sales_invoice");
    expect(body.map((r: any) => r.sourceRefId)).toEqual(["SI-1"]);
    expect(body[0]).toMatchObject({ amount: 1100, documentType: "SALE", eventType: "SALES", partnerName: "得意先A" });
  });

  it("売上を仕訳にする: 明細ごとに 売掛金/売上高・売掛金/仮受消費税 の組、計上日は売上日", async () => {
    await seedSalesInvoice("SI-1");
    const { res, body } = await post({ kind: "sales_invoice", sourceRefId: "SI-1" });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, status: "POSTED" });
    const { batch, pairs } = await lineSummary("SI-1");
    expect(batch.entryDate.toISOString().slice(0, 10)).toBe("2026-09-08");
    expect(batch.description).toBe("売上[SI-1]");
    expect(pairs).toEqual([
      ["1131", "4101", 1000],
      ["1131", "2301", 100],
    ]);
    expect((await getJson("/?kind=sales_invoice")).body).toHaveLength(0);
  });

  it.each([
    ["RETURN", "返品"],
    ["DISCOUNT", "値引"],
    ["CORRECTION", "赤伝(訂正)"],
  ])("%sは区分の組(既定は借方・貸方が逆)で作る", async (documentType, label) => {
    await seedSalesInvoice("SI-R", { documentType });
    expect((await post({ kind: "sales_invoice", sourceRefId: "SI-R" })).body.status).toBe("POSTED");
    const { batch, pairs } = await lineSummary("SI-R");
    expect(batch.description).toBe(`${label}[SI-R]`);
    expect(pairs).toEqual([
      ["4101", "1131", 1000],
      ["2301", "1131", 100],
    ]);
  });

  it("承認済みでない売上・存在しない売上は仕訳にできない", async () => {
    await seedSalesInvoice("SI-D", { status: "DRAFT" });
    expect((await post({ kind: "sales_invoice", sourceRefId: "SI-D" })).res.status).toBe(400);
    expect((await post({ kind: "sales_invoice", sourceRefId: "NOPE" })).res.status).toBe(404);
  });

  it("受注が前受済みの売上は、売掛金で計上したうえで全額を 前受金/売掛金 で振り替える", async () => {
    await mainDb.insert(schema.salesOrders).values({
      id: "SO-1",
      partnerId: "P-1",
      orderDate: now,
      isPrepaid: true,
      totalAmount: 1100,
      ...audit,
    });
    await seedSalesInvoice("SI-1", { salesOrderId: "SO-1" });
    expect((await post({ kind: "sales_invoice", sourceRefId: "SI-1" })).body.status).toBe("POSTED");
    expect((await lineSummary("SI-1")).pairs).toEqual([
      ["1131", "4101", 1000],
      ["1131", "2301", 100],
      ["2201", "1131", 1100],
    ]);
  });

  it("仕訳の確認(preview)は、組を返すだけで保存しない", async () => {
    await seedSalesInvoice("SI-1");
    const res = await request("/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "sales_invoice", sourceRefId: "SI-1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.description).toBe("売上[SI-1]");
    expect(body.pairs.map((p: any) => [p.debit.accountName, p.credit.accountName, p.amount])).toEqual([
      ["売掛金", "売上高", 1000],
      ["売掛金", "仮受消費税", 100],
    ]);
    expect(await journalDb.select().from(journalSchema.journalBatches)).toHaveLength(0);
    expect(await mainDb.select().from(schema.journalPostingEvents)).toHaveLength(0);
  });
});

describe("単体入金の前受金の充当", () => {
  beforeEach(async () => {
    await mainDb.insert(schema.cashReceipts).values([
      { id: "CR-1", partnerId: "P-1", receiptDate: new Date("2026-09-01"), amount: 3000, ...audit },
      { id: "CR-2", partnerId: "P-2", receiptDate: new Date("2026-09-01"), amount: 3000, ...audit },
    ]);
  });

  const apply = (cashReceiptId: string, amount: number) => ({ cashReceiptId, amount });

  it("前受金として仕訳済みの単体入金だけが、充当できる候補として未充当残つきで出る", async () => {
    expect((await getJson("/advance-candidates?partnerId=P-1")).body).toEqual([]);
    await post({ kind: "cash_receipt", sourceRefId: "CR-1" });
    const { body } = await getJson("/advance-candidates?partnerId=P-1");
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ cashReceiptId: "CR-1", amount: 3000, appliedAmount: 0, remainingAmount: 3000 });
    expect((await getJson("/advance-candidates?partnerId=P-2")).body).toEqual([]);
  });

  it("一部を充当すると、前受金/売掛金 の組(充当分)が付き、充当が記録され、未充当残が減る", async () => {
    await post({ kind: "cash_receipt", sourceRefId: "CR-1" });
    await seedSalesInvoice("SI-1");
    const { body } = await post({ kind: "sales_invoice", sourceRefId: "SI-1", advanceApplications: [apply("CR-1", 800)] });
    expect(body.status).toBe("POSTED");
    expect((await lineSummary("SI-1")).pairs).toEqual([
      ["1131", "4101", 1000],
      ["1131", "2301", 100],
      ["2201", "1131", 800],
    ]);
    const applications = await mainDb.select().from(schema.cashReceiptAdvanceApplications);
    expect(applications).toHaveLength(1);
    expect(applications[0]).toMatchObject({ cashReceiptId: "CR-1", salesInvoiceId: "SI-1", amount: 800 });
    expect((await getJson("/advance-candidates?partnerId=P-1")).body[0]).toMatchObject({ appliedAmount: 800, remainingAmount: 2200 });
  });

  it("売上の税込金額と同額を充当すると、全額を 前受金/売掛金 で振り替える", async () => {
    await post({ kind: "cash_receipt", sourceRefId: "CR-1" });
    await seedSalesInvoice("SI-1");
    await post({ kind: "sales_invoice", sourceRefId: "SI-1", advanceApplications: [apply("CR-1", 1100)] });
    expect((await lineSummary("SI-1")).pairs.at(-1)).toEqual(["2201", "1131", 1100]);
  });

  it("未充当残を超える充当・売上金額を超える充当・仕訳済みでない/他の取引先の単体入金は400で、何も記録しない", async () => {
    await post({ kind: "cash_receipt", sourceRefId: "CR-1" });
    await post({ kind: "cash_receipt", sourceRefId: "CR-2" });
    await seedSalesInvoice("SI-1");
    await seedSalesInvoice("SI-2", { totalAmount: 5500, taxAmount: 500 });

    // 売上金額(1100円)を超える
    expect((await post({ kind: "sales_invoice", sourceRefId: "SI-1", advanceApplications: [apply("CR-1", 1200)] })).res.status).toBe(400);
    // 他の取引先の単体入金
    expect((await post({ kind: "sales_invoice", sourceRefId: "SI-1", advanceApplications: [apply("CR-2", 100)] })).res.status).toBe(400);
    // 存在しない(前受金として仕訳済みでない)単体入金
    expect((await post({ kind: "sales_invoice", sourceRefId: "SI-1", advanceApplications: [apply("NOPE", 100)] })).res.status).toBe(400);
    // 未充当残(3000円)を超える
    expect((await post({ kind: "sales_invoice", sourceRefId: "SI-2", advanceApplications: [apply("CR-1", 3500)] })).res.status).toBe(400);
    expect(await mainDb.select().from(schema.cashReceiptAdvanceApplications)).toHaveLength(0);
    expect(await journalDb.select().from(journalSchema.journalBatches)).toHaveLength(2); // 単体入金の前受2件だけ
  });

  it("同じ単体入金を2回指定した場合は合算して検証し、返品・値引・赤伝や売上以外では充当できない", async () => {
    await post({ kind: "cash_receipt", sourceRefId: "CR-1" });
    await seedSalesInvoice("SI-1");
    await seedSalesInvoice("SI-R", { documentType: "RETURN" });
    expect(
      (await post({ kind: "sales_invoice", sourceRefId: "SI-R", advanceApplications: [apply("CR-1", 100)] })).res.status,
    ).toBe(400);
    expect(
      (await post({ kind: "sales_order", sourceRefId: "SI-1", advanceApplications: [apply("CR-1", 100)] })).res.status,
    ).toBe(400);
    await post({ kind: "sales_invoice", sourceRefId: "SI-1", advanceApplications: [apply("CR-1", 300), apply("CR-1", 200)] });
    const applications = await mainDb.select().from(schema.cashReceiptAdvanceApplications);
    expect(applications.map((a) => a.amount)).toEqual([500]);
  });

  it("既に仕訳済みの売上へ、もう一度充当を付けて呼んでも充当は記録されない", async () => {
    await post({ kind: "cash_receipt", sourceRefId: "CR-1" });
    await seedSalesInvoice("SI-1");
    await post({ kind: "sales_invoice", sourceRefId: "SI-1" });
    const again = await post({ kind: "sales_invoice", sourceRefId: "SI-1", advanceApplications: [apply("CR-1", 500)] });
    expect(again.body.status).toBe("ALREADY_POSTED");
    expect(await mainDb.select().from(schema.cashReceiptAdvanceApplications)).toHaveLength(0);
  });
});

describe("仕入(purchase_recognition)", () => {
  async function seedRecognition(id: string, overrides: Record<string, unknown> = {}) {
    await mainDb.insert(schema.purchaseRecognitions).values({
      id,
      partnerId: "P-2",
      recognitionDate: new Date("2026-09-09"),
      status: "APPROVED",
      documentType: "PURCHASE",
      // totalAmount は税込(BUG-047。明細 2,000円 + 消費税 200円)
      totalAmount: 2200,
      taxAmount: 200,
      ...audit,
      ...overrides,
    });
    await mainDb.insert(schema.purchaseRecognitionItems).values({
      id: `${id}-L1`,
      purchaseRecognitionId: id,
      itemName: "部材",
      quantity: 1,
      unitPrice: 2000,
      amount: 2000,
      accountCode: "5101",
    });
  }

  it("仕入を仕訳にする: 明細ごとに 仕入高/買掛金・仮払消費税/買掛金 の組", async () => {
    await seedRecognition("PR-1");
    expect((await getJson("/?kind=purchase_recognition")).body[0]).toMatchObject({ sourceRefId: "PR-1", amount: 2200 });
    expect((await post({ kind: "purchase_recognition", sourceRefId: "PR-1" })).body.status).toBe("POSTED");
    expect((await lineSummary("PR-1")).pairs).toEqual([
      ["5101", "2101", 2000],
      ["1181", "2101", 200],
    ]);
  });

  it("値引は区分の組(既定は借方・貸方が逆)で作る。承認済みでない仕入は仕訳にできない", async () => {
    await seedRecognition("PR-D", { documentType: "DISCOUNT" });
    await post({ kind: "purchase_recognition", sourceRefId: "PR-D" });
    expect((await lineSummary("PR-D")).pairs).toEqual([
      ["2101", "5101", 2000],
      ["2101", "1181", 200],
    ]);
    await seedRecognition("PR-X", { status: "DRAFT" });
    expect((await post({ kind: "purchase_recognition", sourceRefId: "PR-X" })).res.status).toBe(400);
  });
});

describe("前払(purchase_order)・前受(sales_order)", () => {
  it("前払済みの発注を仕訳にする: 借方=前渡金/貸方=現金預金。計上日は支払日", async () => {
    await mainDb.insert(schema.orders).values([
      { id: "PO-1", partnerId: "P-2", orderDate: new Date("2026-09-01"), isPaid: true, paidAt: new Date("2026-09-02"), totalAmount: 5000, ...audit },
      { id: "PO-2", partnerId: "P-2", orderDate: new Date("2026-09-01"), isPaid: false, totalAmount: 5000, ...audit },
    ]);
    expect((await getJson("/?kind=purchase_order")).body.map((r: any) => r.sourceRefId)).toEqual(["PO-1"]);
    expect((await post({ kind: "purchase_order", sourceRefId: "PO-1" })).body.status).toBe("POSTED");
    const { batch, lines } = await lineSummary("PO-1");
    expect(batch.entryDate.toISOString().slice(0, 10)).toBe("2026-09-02");
    expect(lines).toEqual([
      ["CREDIT", "1111", 5000],
      ["DEBIT", "1151", 5000],
    ]);
    // 前払済みでない発注は仕訳にできない
    expect((await post({ kind: "purchase_order", sourceRefId: "PO-2" })).res.status).toBe(400);
  });

  it("前受済みの受注を仕訳にする: 借方=現金預金/貸方=前受金", async () => {
    await mainDb.insert(schema.salesOrders).values({
      id: "SO-1",
      partnerId: "P-1",
      orderDate: new Date("2026-09-01"),
      isPrepaid: true,
      prepaidAt: new Date("2026-09-03"),
      totalAmount: 4000,
      ...audit,
    });
    expect((await getJson("/?kind=sales_order")).body[0]).toMatchObject({ sourceRefId: "SO-1", amount: 4000 });
    expect((await post({ kind: "sales_order", sourceRefId: "SO-1" })).body.status).toBe("POSTED");
    expect((await lineSummary("SO-1")).lines).toEqual([
      ["CREDIT", "2201", 4000],
      ["DEBIT", "1111", 4000],
    ]);
  });
});
