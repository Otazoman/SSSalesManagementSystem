import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import type { Env } from "../../../types/env";
import { BillingRepository } from "./billing.repository";
import { BillingCsvService } from "./billing-csv.service";

const db = drizzle(env.DB, { schema });
const now = new Date();

function buildTestApp() {
  return new Hono<{ Bindings: Env }>();
}

async function withContext<T>(fn: (c: any) => Promise<T>): Promise<T> {
  const app = buildTestApp();
  let result!: T;
  app.get("/run", async (c) => {
    result = await fn(c);
    return c.json({});
  });
  const ctx = createExecutionContext();
  await app.request("/run", {}, env, ctx);
  await waitOnExecutionContext(ctx);
  return result;
}

beforeEach(async () => {
  await db.delete(schema.paymentReceipts);
  await db.delete(schema.billingItems);
  await db.delete(schema.billingHeaders);
  await db.delete(schema.salesInvoices);
  await db.delete(schema.partners);
  await db.delete(schema.users);

  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.partners).values({
    id: "P-1",
    name: "取引先1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.salesInvoices).values({
    id: "SI-1",
    partnerId: "P-1",
    invoiceDate: now,
    status: "APPROVED",
    documentType: "SALE",
    totalAmount: 11000,
    taxAmount: 1000,
    billingStatus: "BILLED",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
});

describe("BillingCsvService: 請求データのエクスポート・インポートの往復", () => {
  it("エクスポートしたCSVを再インポートすると同じ内容が復元される", async () => {
    await db.insert(schema.billingHeaders).values({
      id: "BL-CSV-1",
      partnerId: "P-1",
      title: "9月度請求",
      billingDate: now,
      mode: "PER_TRANSACTION",
      status: "DRAFT",
      totalAmount: 11000,
      taxAmount: 1000,
      reconciledAmount: 0,
      reconciliationStatus: "UNRECONCILED",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.billingItems).values({
      id: "BL-CSV-1-ITEM-1",
      billingHeaderId: "BL-CSV-1",
      salesInvoiceId: "SI-1",
      amount: 10000,
      taxAmount: 1000,
      sortOrder: 0,
    });

    const csvText = await withContext((c) => {
      const service = new BillingCsvService(new BillingRepository(c.env.DB));
      return service.exportCsv(c);
    });
    expect(csvText).toContain("BL-CSV-1");
    expect(csvText).toContain("SI-1");

    await db.delete(schema.billingItems);
    await db.delete(schema.billingHeaders);

    const file = new File([csvText], "export.csv", { type: "text/csv" });
    const importResult = await withContext((c) => {
      const service = new BillingCsvService(new BillingRepository(c.env.DB));
      return service.bulkImportCsv(c, file);
    });
    expect(importResult.success).toBe(true);

    const headers = await db.select().from(schema.billingHeaders).where(eq(schema.billingHeaders.id, "BL-CSV-1"));
    expect(headers).toHaveLength(1);
    expect(headers[0].totalAmount).toBe(11000);
    expect(headers[0].mode).toBe("PER_TRANSACTION");

    const items = await db.select().from(schema.billingItems).where(eq(schema.billingItems.billingHeaderId, "BL-CSV-1"));
    expect(items).toHaveLength(1);
    expect(items[0].salesInvoiceId).toBe("SI-1");
  });
});

describe("BillingCsvService: 入金消込データのエクスポート・インポートの往復", () => {
  it("エクスポートしたCSVを再インポートすると入金消込データが復元され、集計も更新される", async () => {
    await db.insert(schema.billingHeaders).values({
      id: "BL-CSV-2",
      partnerId: "P-1",
      billingDate: now,
      mode: "PER_TRANSACTION",
      // BUG-051: 未発行(下書き)の請求には入金を取り込めないため、発行済みにする
      status: "ISSUED",
      totalAmount: 10000,
      taxAmount: 1000,
      reconciledAmount: 0,
      reconciliationStatus: "UNRECONCILED",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.paymentReceipts).values({
      id: "PR-1",
      billingHeaderId: "BL-CSV-2",
      receivedDate: now,
      amount: 10000,
      method: "BANK_TRANSFER",
      reconciledById: "EMP001",
      reconciledAt: now,
    });

    const csvText = await withContext((c) => {
      const service = new BillingCsvService(new BillingRepository(c.env.DB));
      return service.exportPaymentReceiptsCsv(c);
    });
    expect(csvText).toContain("PR-1");

    await db.delete(schema.paymentReceipts);

    const file = new File([csvText], "receipts.csv", { type: "text/csv" });
    const importResult = await withContext((c) => {
      const service = new BillingCsvService(new BillingRepository(c.env.DB));
      return service.bulkImportPaymentReceiptsCsv(c, file);
    });
    expect(importResult.success).toBe(true);

    const receipts = await db
      .select()
      .from(schema.paymentReceipts)
      .where(eq(schema.paymentReceipts.billingHeaderId, "BL-CSV-2"));
    expect(receipts).toHaveLength(1);
    expect(receipts[0].amount).toBe(10000);

    const header = await db
      .select()
      .from(schema.billingHeaders)
      .where(eq(schema.billingHeaders.id, "BL-CSV-2"));
    expect(header[0].reconciledAmount).toBe(10000);
    expect(header[0].reconciliationStatus).toBe("RECONCILED");
  });
});

// 消込CSVは「記録を追加する」取込のため、二重取込・存在しない請求・不正な行は、1件も登録せずエラーにする
describe("入金消込CSVインポート: 二重インポート・不正な行の検証", () => {
  const NL = String.fromCharCode(10);
  const HEADER = "billingHeaderId,receivedDate,amount,method,memo";
  const csv = (...lines: string[]) => [HEADER, ...lines].join(NL);

  async function seedHeader(id = "BL-DUP-1") {
    await db.insert(schema.billingHeaders).values({
      id,
      partnerId: "P-1",
      billingDate: now,
      mode: "PER_TRANSACTION",
      status: "ISSUED",
      totalAmount: 10000,
      taxAmount: 1000,
      reconciledAmount: 0,
      reconciliationStatus: "UNRECONCILED",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
  }

  // このファイルのwithContextは例外を握りつぶすため、取込の例外(BadRequestError)を捕捉して投げ直す
  const run = async (text: string) => {
    const app = new Hono<{ Bindings: Env }>();
    let result: Awaited<ReturnType<BillingCsvService["bulkImportPaymentReceiptsCsv"]>> | undefined;
    let error: unknown = null;
    app.get("/run", async (c) => {
      try {
        const service = new BillingCsvService(new BillingRepository(c.env.DB));
        result = await service.bulkImportPaymentReceiptsCsv(c, new File([text], "recon.csv", { type: "text/csv" }));
      } catch (e) {
        error = e;
      }
      return c.json({});
    });
    const ctx = createExecutionContext();
    await app.request("/run", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    if (error) throw error;
    return result!;
  };
  const rowsOf = async () => db.select().from(schema.paymentReceipts);

  it("同じファイルを2回取り込むと、2回目はエラーになり、記録は増えない(消込額も二重にならない)", async () => {
    await seedHeader();
    const text = csv('"BL-DUP-1","2026-09-25","6000","BANK_TRANSFER","内金"');

    const first = await run(text);
    expect(first.success).toBe(true);

    await expect(run(text)).rejects.toThrow("二重にインポートしている可能性があります");

    expect(await rowsOf()).toHaveLength(1);
    const [header] = await db.select().from(schema.billingHeaders).where(eq(schema.billingHeaders.id, "BL-DUP-1"));
    expect(header.reconciledAmount).toBe(6000);
  });

  it("同日・同額でも、メモが違えば別の記録として登録できる", async () => {
    await seedHeader();

    await run(csv('"BL-DUP-1","2026-09-25","3000","BANK_TRANSFER","1回目"'));
    await run(csv('"BL-DUP-1","2026-09-25","3000","BANK_TRANSFER","2回目"'));

    expect(await rowsOf()).toHaveLength(2);
  });

  it("存在しない請求・不正な日付・不正な金額は、行番号つきでまとめて報告し、1件も登録しない", async () => {
    await seedHeader();
    const text = csv(
      '"BL-DUP-1","2026-09-25","4000","BANK_TRANSFER","有効な行"',
      '"NOPE","2026-09-25","1000","BANK_TRANSFER",""',
      '"BL-DUP-1","2026-13-40","1000","BANK_TRANSFER",""',
      '"BL-DUP-1","2026-09-26","abc","BANK_TRANSFER",""',
      '"BL-DUP-1","2026-09-27","0","BANK_TRANSFER",""',
      '"BL-DUP-1","","1000","BANK_TRANSFER",""',
    );

    const error = await run(text).then(
      () => null,
      (e: Error) => e,
    );

    expect(error).not.toBeNull();
    const message = String(error?.message);
    expect(message).toContain("3行目: 請求[NOPE]が見つかりません");
    expect(message).toContain("4行目: 日付「2026-13-40」が正しくありません");
    expect(message).toContain("5行目: 金額「abc」は1以上の数値");
    expect(message).toContain("6行目: 金額「0」は1以上の数値");
    expect(message).toContain("7行目: 日付は必須です");
    expect(await rowsOf()).toHaveLength(0);
  });

  it("CSV内に同じ記録が2行あると、重複としてエラーにする", async () => {
    await seedHeader();
    const attempt = run(
      csv('"BL-DUP-1","2026-09-25","2000","BANK_TRANSFER","同じ"', '"BL-DUP-1","2026-09-25","2000","BANK_TRANSFER","同じ"'),
    );

    await expect(attempt).rejects.toThrow("がCSV内で重複しています");
    expect(await rowsOf()).toHaveLength(0);
  });

  it("BUG-051: 既存の入金とCSVの入金の合計が請求額を超えると、行番号つきでエラーにし、1件も登録しない", async () => {
    await seedHeader();
    await run(csv('"BL-DUP-1","2026-09-20","6000","BANK_TRANSFER","内金"'));

    const attempt = run(
      csv('"BL-DUP-1","2026-09-25","3000","BANK_TRANSFER","2回目"', '"BL-DUP-1","2026-09-26","2000","BANK_TRANSFER","3回目"'),
    );

    await expect(attempt).rejects.toThrow("3行目: 請求[BL-DUP-1]の入金の合計");
    expect(await rowsOf()).toHaveLength(1);
  });

  it("BUG-051: 未発行(下書き)の請求への入金は、行番号つきでエラーにする", async () => {
    await seedHeader();
    await db.update(schema.billingHeaders).set({ status: "DRAFT" }).where(eq(schema.billingHeaders.id, "BL-DUP-1"));

    await expect(run(csv('"BL-DUP-1","2026-09-25","1000","BANK_TRANSFER",""'))).rejects.toThrow("2行目: 請求[BL-DUP-1]は未発行");
    expect(await rowsOf()).toHaveLength(0);
  });
});
