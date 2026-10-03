import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { PaymentRepository } from "./payment.repository";
import { PaymentService } from "./payment.service";
import type { Env } from "../../../types/env";

// #14-2⑥: 元々1121行あったpayment-crud.test.tsから、完全手動入力(K-5-3)の部分を分割したもの。
// ロジック変更なし。ヘルパー関数は既存の慣習(payment-csv.test.ts、
// sales-order-crud/workflow.service.test.ts)にならい、分割後の各ファイルにそのまま複製している
// (共通ファイル化はしない)。

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

describe("PaymentCrudService.createPayment: 完全手動入力(K-5-3)", () => {
  it("手動明細のみで支払を作成できる", async () => {
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
        manualItems: [{ itemName: "立替金", amount: 3300, taxAmount: 300 }],
      }),
    );
    expect(result.success).toBe(true);

    const header = await db
      .select()
      .from(schema.paymentHeaders)
      .where(eq(schema.paymentHeaders.id, result.id));
    expect(header[0].totalAmount).toBe(3300);
    expect(header[0].taxAmount).toBe(300);

    const items = await db
      .select()
      .from(schema.paymentHeaderItems)
      .where(eq(schema.paymentHeaderItems.paymentHeaderId, result.id));
    expect(items).toHaveLength(1);
    expect(items[0].itemName).toBe("立替金");
    expect(items[0].purchaseRecognitionId).toBeNull();
    expect(items[0].itemReceiptId).toBeNull();
  });

  it("仕入計上・検収記録・手動明細を組み合わせて支払を作成できる", async () => {
    await seedRecognition("SR-8", { totalAmount: 11000, taxAmount: 1000 });
    await seedOrderLinkedReceipt("SR-REC-8");

    const result = await withContext((c) =>
      getService(c).createPayment(c, {
        partnerId: "P-1",
        mode: "PERIODIC",
        paymentDate: now.toISOString(),
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        title: null,
        memo: null,
        purchaseRecognitionIds: ["SR-8"],
        itemReceipts: [{ id: "SR-REC-8" }],
        manualItems: [{ itemName: "立替金", amount: 3300, taxAmount: 300 }],
      }),
    );

    const header = await db
      .select()
      .from(schema.paymentHeaders)
      .where(eq(schema.paymentHeaders.id, result.id));
    // 11000(仕入計上) + 11000(検収記録自動計算) + 3300(手動明細)
    expect(header[0].totalAmount).toBe(25300);
    expect(header[0].taxAmount).toBe(2300);

    const items = await db
      .select()
      .from(schema.paymentHeaderItems)
      .where(eq(schema.paymentHeaderItems.paymentHeaderId, result.id));
    expect(items).toHaveLength(3);

    const detail = await withContext((c) => getService(c).getPaymentDetail(c, result.id));
    expect(detail?.items).toHaveLength(3);
    const manualRow = detail?.items.find((i) => i.itemName === "立替金");
    expect(manualRow?.purchaseRecognition).toBeNull();
    expect(manualRow?.itemReceipt).toBeNull();
    const receiptRow = detail?.items.find((i) => i.itemReceiptId === "SR-REC-8");
    expect(receiptRow?.itemReceipt?.id).toBe("SR-REC-8");
  });

  it("PER_TRANSACTIONで仕入計上+手動明細の合計2件を指定すると400", async () => {
    await seedRecognition("SR-9");

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
          purchaseRecognitionIds: ["SR-9"],
          manualItems: [{ itemName: "立替金", amount: 1000, taxAmount: 100 }],
        }),
      ),
    ).rejects.toThrow("都度支払(PER_TRANSACTION)では対象を合計1件のみ選択してください");
  });

  it("対象を1件も指定しないと400", async () => {
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
        }),
      ),
    ).rejects.toThrow("対象の仕入・検収記録、または明細を1件以上指定してください");
  });
});
