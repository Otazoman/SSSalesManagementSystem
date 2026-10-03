import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import type { Env } from "../../../types/env";
import { PaymentRepository } from "./payment.repository";
import { PaymentCsvService } from "./payment-csv.service";

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
  await db.delete(schema.paymentDisbursements);
  await db.delete(schema.paymentHeaderItems);
  await db.delete(schema.paymentHeaders);
  await db.delete(schema.purchaseRecognitions);
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
  await db.insert(schema.purchaseRecognitions).values({
    id: "SR-1",
    partnerId: "P-1",
    recognitionDate: now,
    status: "APPROVED",
    documentType: "PURCHASE",
    totalAmount: 11000,
    taxAmount: 1000,
    paymentStatus: "PAID",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
});

describe("PaymentCsvService: 支払データのエクスポート・インポートの往復", () => {
  it("エクスポートしたCSVを再インポートすると同じ内容が復元される", async () => {
    await db.insert(schema.paymentHeaders).values({
      id: "PM-CSV-1",
      partnerId: "P-1",
      title: "9月度支払",
      paymentDate: now,
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
    await db.insert(schema.paymentHeaderItems).values({
      id: "PM-CSV-1-ITEM-1",
      paymentHeaderId: "PM-CSV-1",
      purchaseRecognitionId: "SR-1",
      amount: 10000,
      taxAmount: 1000,
      sortOrder: 0,
    });

    const csvText = await withContext((c) => {
      const service = new PaymentCsvService(new PaymentRepository(c.env.DB));
      return service.exportCsv(c);
    });
    expect(csvText).toContain("PM-CSV-1");
    expect(csvText).toContain("SR-1");

    await db.delete(schema.paymentHeaderItems);
    await db.delete(schema.paymentHeaders);

    const file = new File([csvText], "export.csv", { type: "text/csv" });
    const importResult = await withContext((c) => {
      const service = new PaymentCsvService(new PaymentRepository(c.env.DB));
      return service.bulkImportCsv(c, file);
    });
    expect(importResult.success).toBe(true);

    const headers = await db
      .select()
      .from(schema.paymentHeaders)
      .where(eq(schema.paymentHeaders.id, "PM-CSV-1"));
    expect(headers).toHaveLength(1);
    expect(headers[0].totalAmount).toBe(11000);
    expect(headers[0].mode).toBe("PER_TRANSACTION");

    const items = await db
      .select()
      .from(schema.paymentHeaderItems)
      .where(eq(schema.paymentHeaderItems.paymentHeaderId, "PM-CSV-1"));
    expect(items).toHaveLength(1);
    expect(items[0].purchaseRecognitionId).toBe("SR-1");
  });
});

describe("PaymentCsvService: 支払消込データのエクスポート・インポートの往復", () => {
  it("エクスポートしたCSVを再インポートすると支払消込データが復元され、集計も更新される", async () => {
    await db.insert(schema.paymentHeaders).values({
      id: "PM-CSV-2",
      partnerId: "P-1",
      paymentDate: now,
      mode: "PER_TRANSACTION",
      status: "DRAFT",
      totalAmount: 10000,
      taxAmount: 1000,
      reconciledAmount: 0,
      reconciliationStatus: "UNRECONCILED",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.paymentDisbursements).values({
      id: "PD-1",
      paymentHeaderId: "PM-CSV-2",
      paidDate: now,
      amount: 10000,
      method: "BANK_TRANSFER",
      reconciledById: "EMP001",
      reconciledAt: now,
    });

    const csvText = await withContext((c) => {
      const service = new PaymentCsvService(new PaymentRepository(c.env.DB));
      return service.exportDisbursementsCsv(c);
    });
    expect(csvText).toContain("PD-1");

    await db.delete(schema.paymentDisbursements);

    const file = new File([csvText], "disbursements.csv", { type: "text/csv" });
    const importResult = await withContext((c) => {
      const service = new PaymentCsvService(new PaymentRepository(c.env.DB));
      return service.bulkImportDisbursementsCsv(c, file);
    });
    expect(importResult.success).toBe(true);

    const disbursements = await db
      .select()
      .from(schema.paymentDisbursements)
      .where(eq(schema.paymentDisbursements.paymentHeaderId, "PM-CSV-2"));
    expect(disbursements).toHaveLength(1);
    expect(disbursements[0].amount).toBe(10000);

    const header = await db
      .select()
      .from(schema.paymentHeaders)
      .where(eq(schema.paymentHeaders.id, "PM-CSV-2"));
    expect(header[0].reconciledAmount).toBe(10000);
    expect(header[0].reconciliationStatus).toBe("RECONCILED");
  });
});

// 消込CSVは「記録を追加する」取込のため、二重取込・存在しない支払・不正な行は、1件も登録せずエラーにする
describe("支払消込CSVインポート: 二重インポート・不正な行の検証", () => {
  const NL = String.fromCharCode(10);
  const HEADER = "paymentHeaderId,paidDate,amount,method,memo";
  const csv = (...lines: string[]) => [HEADER, ...lines].join(NL);

  async function seedHeader(id = "PM-DUP-1") {
    await db.insert(schema.paymentHeaders).values({
      id,
      partnerId: "P-1",
      paymentDate: now,
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
    let result: Awaited<ReturnType<PaymentCsvService["bulkImportDisbursementsCsv"]>> | undefined;
    let error: unknown = null;
    app.get("/run", async (c) => {
      try {
        const service = new PaymentCsvService(new PaymentRepository(c.env.DB));
        result = await service.bulkImportDisbursementsCsv(c, new File([text], "recon.csv", { type: "text/csv" }));
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
  const rowsOf = async () => db.select().from(schema.paymentDisbursements);

  it("同じファイルを2回取り込むと、2回目はエラーになり、記録は増えない(消込額も二重にならない)", async () => {
    await seedHeader();
    const text = csv('"PM-DUP-1","2026-09-25","6000","BANK_TRANSFER","内金"');

    const first = await run(text);
    expect(first.success).toBe(true);

    await expect(run(text)).rejects.toThrow("二重にインポートしている可能性があります");

    expect(await rowsOf()).toHaveLength(1);
    const [header] = await db.select().from(schema.paymentHeaders).where(eq(schema.paymentHeaders.id, "PM-DUP-1"));
    expect(header.reconciledAmount).toBe(6000);
  });

  it("同日・同額でも、メモが違えば別の記録として登録できる", async () => {
    await seedHeader();

    await run(csv('"PM-DUP-1","2026-09-25","3000","BANK_TRANSFER","1回目"'));
    await run(csv('"PM-DUP-1","2026-09-25","3000","BANK_TRANSFER","2回目"'));

    expect(await rowsOf()).toHaveLength(2);
  });

  it("存在しない支払・不正な日付・不正な金額は、行番号つきでまとめて報告し、1件も登録しない", async () => {
    await seedHeader();
    const text = csv(
      '"PM-DUP-1","2026-09-25","4000","BANK_TRANSFER","有効な行"',
      '"NOPE","2026-09-25","1000","BANK_TRANSFER",""',
      '"PM-DUP-1","2026-13-40","1000","BANK_TRANSFER",""',
      '"PM-DUP-1","2026-09-26","abc","BANK_TRANSFER",""',
      '"PM-DUP-1","2026-09-27","0","BANK_TRANSFER",""',
      '"PM-DUP-1","","1000","BANK_TRANSFER",""',
    );

    const error = await run(text).then(
      () => null,
      (e: Error) => e,
    );

    expect(error).not.toBeNull();
    const message = String(error?.message);
    expect(message).toContain("3行目: 支払[NOPE]が見つかりません");
    expect(message).toContain("4行目: 日付「2026-13-40」が正しくありません");
    expect(message).toContain("5行目: 金額「abc」は1以上の数値");
    expect(message).toContain("6行目: 金額「0」は1以上の数値");
    expect(message).toContain("7行目: 日付は必須です");
    expect(await rowsOf()).toHaveLength(0);
  });

  it("CSV内に同じ記録が2行あると、重複としてエラーにする", async () => {
    await seedHeader();
    const attempt = run(
      csv('"PM-DUP-1","2026-09-25","2000","BANK_TRANSFER","同じ"', '"PM-DUP-1","2026-09-25","2000","BANK_TRANSFER","同じ"'),
    );

    await expect(attempt).rejects.toThrow("がCSV内で重複しています");
    expect(await rowsOf()).toHaveLength(0);
  });
});
