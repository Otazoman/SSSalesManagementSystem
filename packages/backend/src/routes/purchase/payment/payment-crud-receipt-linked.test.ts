import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { PaymentRepository } from "./payment.repository";
import { PaymentService } from "./payment.service";
import type { Env } from "../../../types/env";

// #14-2⑥: 元々1121行あったpayment-crud.test.tsから、検収記録連携(K-5-1)・検収と仕入の
// 紐づけによる二重支払の警告(L-1-b)の部分を分割したもの。ロジック変更なし。ヘルパー関数は
// 既存の慣習(payment-csv.test.ts、sales-order-crud/workflow.service.test.ts)にならい、
// 分割後の各ファイルにそのまま複製している(共通ファイル化はしない)。

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

// K-5-1: 発注紐付きの検収記録(単価情報を持ち、金額が自動計算されるケース)を作る
async function seedOrderLinkedReceipt(
  receiptId: string,
  overrides: Partial<typeof schema.itemReceiptHeaders.$inferInsert> = {},
) {
  const orderId = `${receiptId}-ORDER`;
  const orderItemId = `${receiptId}-ORDER-ITEM`;
  await db.insert(schema.orders).values({
    id: orderId,
    partnerId: "P-1",
    orderDate: now,
    status: "APPROVED",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.orderItems).values({
    id: orderItemId,
    orderId,
    itemId: "ITEM1",
    quantity: 10,
    unitPrice: 1000,
    unitCode: "PCS",
    taxCategoryCode: "TAX_10",
    sortOrder: 0,
  });
  await db.insert(schema.itemReceiptHeaders).values({
    id: receiptId,
    partnerId: "P-1",
    orderId,
    receivedDate: now,
    status: "APPROVED",
    createdBy: "EMP001",
    createdAt: now,
    ...overrides,
  });
  await db.insert(schema.itemReceiptItems).values({
    id: `${receiptId}-ITEM`,
    receiptHeaderId: receiptId,
    orderItemId,
    itemId: "ITEM1",
    warehouseId: "WH1",
    locationId: "LOC1",
    receivedQuantity: 10,
    accountCode: "ACC1",
  });
}

// K-5-1: 発注非依存の検収記録(単価情報を持たず、金額の自動計算ができないケース)を作る
async function seedStandaloneReceipt(
  receiptId: string,
  overrides: Partial<typeof schema.itemReceiptHeaders.$inferInsert> = {},
) {
  await db.insert(schema.itemReceiptHeaders).values({
    id: receiptId,
    partnerId: "P-1",
    receivedDate: now,
    status: "APPROVED",
    createdBy: "EMP001",
    createdAt: now,
    ...overrides,
  });
  await db.insert(schema.itemReceiptItems).values({
    id: `${receiptId}-ITEM`,
    receiptHeaderId: receiptId,
    orderItemId: null,
    itemId: "ITEM1",
    warehouseId: "WH1",
    locationId: "LOC1",
    receivedQuantity: 5,
    accountCode: "ACC1",
  });
}

describe("PaymentCrudService.createPayment: 検収記録連携(K-5-1)", () => {
  it("発注紐付きの検収記録は金額が自動計算される(単価1000×数量10、税10%)", async () => {
    await seedOrderLinkedReceipt("SR-REC-1");

    const result = await withContext((c) =>
      getService(c).createPayment(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        paymentDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: null,
        memo: null,
        purchaseRecognitionIds: [],
        itemReceipts: [{ id: "SR-REC-1" }],
      }),
    );
    expect(result.success).toBe(true);

    const header = await db
      .select()
      .from(schema.paymentHeaders)
      .where(eq(schema.paymentHeaders.id, result.id));
    expect(header[0].totalAmount).toBe(11000);
    expect(header[0].taxAmount).toBe(1000);

    const items = await db
      .select()
      .from(schema.paymentHeaderItems)
      .where(eq(schema.paymentHeaderItems.paymentHeaderId, result.id));
    expect(items).toHaveLength(1);
    expect(items[0].itemReceiptId).toBe("SR-REC-1");
    expect(items[0].purchaseRecognitionId).toBeNull();
    expect(items[0].amount).toBe(11000);
  });

  it("発注非依存の検収記録はamount/taxAmount未指定だと400", async () => {
    await seedStandaloneReceipt("SR-REC-2");

    await expect(
      withContext((c) =>
        getService(c).createPayment(c, {
          partnerId: "P-1",
          mode: "PER_TRANSACTION",
          paymentDate: now.toISOString(),
          periodStart: null,
          periodEnd: null,
          title: null,
          memo: null,
          purchaseRecognitionIds: [],
          itemReceipts: [{ id: "SR-REC-2" }],
        }),
      ),
    ).rejects.toThrow("単価情報を持たないため、amount/taxAmountを直接指定してください");
  });

  it("発注非依存の検収記録はamount/taxAmountを指定すれば作成できる", async () => {
    await seedStandaloneReceipt("SR-REC-3");

    const result = await withContext((c) =>
      getService(c).createPayment(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        paymentDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: null,
        memo: null,
        purchaseRecognitionIds: [],
        itemReceipts: [{ id: "SR-REC-3", amount: 5500, taxAmount: 500 }],
      }),
    );
    expect(result.success).toBe(true);

    const items = await db
      .select()
      .from(schema.paymentHeaderItems)
      .where(eq(schema.paymentHeaderItems.paymentHeaderId, result.id));
    expect(items[0].amount).toBe(5500);
    expect(items[0].taxAmount).toBe(500);
  });

  it("承認済みでない検収記録を対象にすると400", async () => {
    await seedOrderLinkedReceipt("SR-REC-4", { status: "UNAPPROVED" });

    await expect(
      withContext((c) =>
        getService(c).createPayment(c, {
          partnerId: "P-1",
          mode: "PER_TRANSACTION",
          paymentDate: now.toISOString(),
          periodStart: null,
          periodEnd: null,
          title: null,
          memo: null,
          purchaseRecognitionIds: [],
          itemReceipts: [{ id: "SR-REC-4" }],
        }),
      ),
    ).rejects.toThrow("承認済み");
  });

  it("取引先が未設定の検収記録を対象にすると400", async () => {
    await seedOrderLinkedReceipt("SR-REC-5", { partnerId: null });

    await expect(
      withContext((c) =>
        getService(c).createPayment(c, {
          partnerId: "P-1",
          mode: "PER_TRANSACTION",
          paymentDate: now.toISOString(),
          periodStart: null,
          periodEnd: null,
          title: null,
          memo: null,
          purchaseRecognitionIds: [],
          itemReceipts: [{ id: "SR-REC-5" }],
        }),
      ),
    ).rejects.toThrow("取引先が設定されていない");
  });

  it("取引先が支払先と一致しない検収記録を対象にすると400", async () => {
    await seedOrderLinkedReceipt("SR-REC-6", { partnerId: "P-2" });

    await expect(
      withContext((c) =>
        getService(c).createPayment(c, {
          partnerId: "P-1",
          mode: "PER_TRANSACTION",
          paymentDate: now.toISOString(),
          periodStart: null,
          periodEnd: null,
          title: null,
          memo: null,
          purchaseRecognitionIds: [],
          itemReceipts: [{ id: "SR-REC-6" }],
        }),
      ),
    ).rejects.toThrow("取引先が指定の支払先と一致しません");
  });

  it("存在しない検収記録を対象にすると404", async () => {
    await expect(
      withContext((c) =>
        getService(c).createPayment(c, {
          partnerId: "P-1",
          mode: "PER_TRANSACTION",
          paymentDate: now.toISOString(),
          periodStart: null,
          periodEnd: null,
          title: null,
          memo: null,
          purchaseRecognitionIds: [],
          itemReceipts: [{ id: "NOPE" }],
        }),
      ),
    ).rejects.toThrow("見つかりません");
  });

  it("既に他の支払で選択済みの検収記録を対象にすると400(二重防止)", async () => {
    await seedOrderLinkedReceipt("SR-REC-7");
    await withContext((c) =>
      getService(c).createPayment(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        paymentDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: null,
        memo: null,
        purchaseRecognitionIds: [],
        itemReceipts: [{ id: "SR-REC-7" }],
      }),
    );

    await expect(
      withContext((c) =>
        getService(c).createPayment(c, {
          partnerId: "P-1",
          mode: "PERIODIC",
          paymentDate: now.toISOString(),
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          title: null,
          memo: null,
          purchaseRecognitionIds: [],
          itemReceipts: [{ id: "SR-REC-7" }],
        }),
      ),
    ).rejects.toThrow("既に他の支払対象として選択済みです");
  });
});

describe("L-1-b: 検収と仕入の紐づけによる二重支払の警告(候補一覧)", () => {
  async function link(recognitionId: string, receiptId: string) {
    await db.insert(schema.purchaseRecognitionReceipts).values({
      id: `LINK-${recognitionId}-${receiptId}`,
      purchaseRecognitionId: recognitionId,
      itemReceiptId: receiptId,
    });
  }

  it("紐づく仕入が支払済みの検収は、候補に出るがlinkedRecognitionPaid=trueになる", async () => {
    await seedStandaloneReceipt("RCPT-L1");
    await seedRecognition("SR-L1", { paymentStatus: "PAID" });
    await link("SR-L1", "RCPT-L1");

    const candidates = await withContext((c) => getService(c).listCandidateItemReceipts(c, "P-1"));

    const target = candidates.find((r: any) => r.id === "RCPT-L1");
    expect(target?.linkedRecognitionPaid).toBe(true);
    expect(target?.linkedRecognitionIds).toEqual(["SR-L1"]);
  });

  it("紐づく仕入が未払の検収は警告なし(linkedRecognitionPaid=false)、未紐づけの検収は空", async () => {
    await seedStandaloneReceipt("RCPT-L2");
    await seedRecognition("SR-L2", { paymentStatus: "UNPAID" });
    await link("SR-L2", "RCPT-L2");
    await seedStandaloneReceipt("RCPT-L3");

    const candidates = await withContext((c) => getService(c).listCandidateItemReceipts(c, "P-1"));
    const byId = new Map(candidates.map((r: any) => [r.id, r]));

    expect(byId.get("RCPT-L2").linkedRecognitionPaid).toBe(false);
    expect(byId.get("RCPT-L2").linkedRecognitionIds).toEqual(["SR-L2"]);
    expect(byId.get("RCPT-L3").linkedRecognitionPaid).toBe(false);
    expect(byId.get("RCPT-L3").linkedRecognitionIds).toEqual([]);
  });

  it("紐づく検収が既に支払対象の仕入は、候補に出るがlinkedReceiptPaid=trueになる", async () => {
    await seedStandaloneReceipt("RCPT-L4");
    await seedRecognition("SR-L4");
    await link("SR-L4", "RCPT-L4");
    // 検収から先に支払を起票する
    await withContext((c) =>
      getService(c).createPayment(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        paymentDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: null,
        memo: null,
        purchaseRecognitionIds: [],
        itemReceipts: [{ id: "RCPT-L4", amount: 5500, taxAmount: 500 }],
      } as any),
    );

    const candidates = await withContext((c) => getService(c).listCandidateRecognitions(c, "P-1"));

    const target = candidates.find((r: any) => r.id === "SR-L4");
    expect(target?.linkedReceiptPaid).toBe(true);
    expect(target?.linkedReceiptIds).toEqual(["RCPT-L4"]);
  });

  it("紐づけのない仕入はlinkedReceiptPaid=false・linkedReceiptIds空", async () => {
    await seedRecognition("SR-L5");

    const candidates = await withContext((c) => getService(c).listCandidateRecognitions(c, "P-1"));

    const target = candidates.find((r: any) => r.id === "SR-L5");
    expect(target?.linkedReceiptPaid).toBe(false);
    expect(target?.linkedReceiptIds).toEqual([]);
  });
});
