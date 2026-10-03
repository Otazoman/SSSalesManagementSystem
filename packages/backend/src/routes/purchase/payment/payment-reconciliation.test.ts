import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { PaymentRepository } from "./payment.repository";
import { PaymentService } from "./payment.service";
import type { Env } from "../../../types/env";

// #14-2⑥: 元々1121行あったpayment-crud.test.tsから、PaymentReconciliationService.recordDisbursement
// (消込ロジック)の部分を分割したもの。ソース(payment-reconciliation.service.ts)に対応する専用
// テストファイルが無かったため新設。ロジック変更なし。ヘルパー関数は既存の慣習
// (payment-csv.test.ts、sales-order-crud/workflow.service.test.ts)にならい、分割後の各
// ファイルにそのまま複製している(共通ファイル化はしない)。

const db = drizzle(env.DB, { schema });
const now = new Date();

function buildTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", async (c, next) => {
    const repo = new PaymentRepository(c.env.DB);
    c.set("service" as never, new PaymentService(repo) as never);
    await next();
  });
  return app;
}

async function withContext<T>(fn: (c: any) => Promise<T>): Promise<T> {
  const app = buildTestApp();
  let result!: T;
  let caughtError: unknown;
  app.get("/run", async (c) => {
    try {
      result = await fn(c);
    } catch (err) {
      caughtError = err;
    }
    return c.json({});
  });
  const ctx = createExecutionContext();
  await app.request("/run", {}, env, ctx);
  await waitOnExecutionContext(ctx);
  if (caughtError) throw caughtError;
  return result;
}

function getService(c: any): PaymentService {
  return c.get("service" as never) as PaymentService;
}

beforeEach(async () => {
  await db.delete(schema.paymentDisbursements);
  await db.delete(schema.paymentHeaderItems);
  await db.delete(schema.paymentHeaders);
  await db.delete(schema.purchaseRecognitionReceipts);
  await db.delete(schema.purchaseRecognitionItems);
  await db.delete(schema.purchaseRecognitions);
  // K-5-1: 検収記録連携テスト用
  await db.delete(schema.itemReceiptItems);
  await db.delete(schema.itemReceiptHeaders);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
  await db.delete(schema.locations);
  await db.delete(schema.warehouses);
  await db.delete(schema.items);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
  await db.delete(schema.taxCategories);
  await db.delete(schema.partners);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.put("config", JSON.stringify({}));

  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.partners).values([
    { id: "P-1", name: "取引先1", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    { id: "P-2", name: "取引先2", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
  ]);

  // K-5-1: 検収記録連携テスト用マスタ
  await db.insert(schema.units).values({
    code: "PCS",
    name: "個",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.accounts).values({
    code: "ACC1",
    name: "仕入品目",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.items).values({
    id: "ITEM1",
    name: "テスト品目",
    baseUnitCode: "PCS",
    accountCode: "ACC1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.warehouses).values({
    id: "WH1",
    name: "本社倉庫",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.locations).values({
    id: "LOC1",
    warehouseId: "WH1",
    name: "棚A",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.taxCategories).values({
    code: "TAX_10",
    name: "10%標準税率",
    taxType: "STANDARD",
    taxRate: 0.1,
  });
});

async function seedRecognition(
  id: string,
  overrides: Partial<typeof schema.purchaseRecognitions.$inferInsert> = {},
) {
  await db.insert(schema.purchaseRecognitions).values({
    id,
    partnerId: "P-1",
    recognitionDate: now,
    status: "APPROVED",
    documentType: "PURCHASE",
    totalAmount: 11000,
    taxAmount: 1000,
    paymentStatus: "UNPAID",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
    ...overrides,
  });
}

describe("PaymentReconciliationService.recordDisbursement: 消込ロジック", () => {
  async function createTestPayment(): Promise<string> {
    await seedRecognition("SR-1", { totalAmount: 10000, taxAmount: 1000 });
    const result = await withContext((c) =>
      getService(c).createPayment(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        paymentDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: null,
        memo: null,
        purchaseRecognitionIds: ["SR-1"],
      }),
    );
    return result.id as string;
  }

  it("一部支払の場合、reconciliationStatusはPARTIALLY_RECONCILEDになる", async () => {
    const paymentId = await createTestPayment();

    const result = await withContext((c) =>
      getService(c).recordDisbursement(c, paymentId, {
        paidDate: now.toISOString(),
        amount: 5000,
        method: "BANK_TRANSFER",
        memo: null,
      }),
    );

    expect(result.reconciledAmount).toBe(5000);
    expect(result.reconciliationStatus).toBe("PARTIALLY_RECONCILED");

    const header = await db
      .select()
      .from(schema.paymentHeaders)
      .where(eq(schema.paymentHeaders.id, paymentId));
    expect(header[0].reconciledAmount).toBe(5000);
    expect(header[0].reconciliationStatus).toBe("PARTIALLY_RECONCILED");
  });

  it("累計支払額が支払額に達した場合、reconciliationStatusはRECONCILEDになる", async () => {
    const paymentId = await createTestPayment();

    await withContext((c) =>
      getService(c).recordDisbursement(c, paymentId, {
        paidDate: now.toISOString(),
        amount: 6000,
        method: "BANK_TRANSFER",
        memo: null,
      }),
    );
    const result = await withContext((c) =>
      getService(c).recordDisbursement(c, paymentId, {
        paidDate: now.toISOString(),
        amount: 5000,
        method: "CASH",
        memo: "残額支払",
      }),
    );

    expect(result.reconciledAmount).toBe(11000);
    expect(result.reconciliationStatus).toBe("RECONCILED");
  });

  it("対象の支払が存在しない場合は404", async () => {
    await expect(
      withContext((c) =>
        getService(c).recordDisbursement(c, "NOPE", {
          paidDate: now.toISOString(),
          amount: 1000,
          method: "CASH",
          memo: null,
        }),
      ),
    ).rejects.toThrow("見つかりません");
  });
});
