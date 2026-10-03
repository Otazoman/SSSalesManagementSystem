import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { PaymentRepository } from "./payment.repository";
import { PaymentService } from "./payment.service";
import type { Env } from "../../../types/env";

// #14-2⑥: 元々1121行あったpayment-crud.test.tsから、発注前払との統合(K-5-2)の部分を分割
// したもの。ロジック変更なし。ヘルパー関数は既存の慣習(payment-csv.test.ts、
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

// K-5-2: 前払(isPaid)の有無を指定して発注を作る
async function seedOrder(
  orderId: string,
  overrides: Partial<typeof schema.orders.$inferInsert> = {},
) {
  await db.insert(schema.orders).values({
    id: orderId,
    partnerId: "P-1",
    orderDate: now,
    status: "APPROVED",
    totalAmount: 11000,
    isPaid: false,
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
    ...overrides,
  });
}

describe("PaymentCrudService.createPayment: 発注前払との統合(K-5-2)", () => {
  it("前払済み(isPaid=true)の発注に紐づく仕入計上は、金額¥0の支払明細で作成されpaymentStatusがPAIDになる", async () => {
    await seedOrder("PO-PREPAID-1", { isPaid: true, totalAmount: 11000 });
    await seedRecognition("SR-PREPAID-1", { orderId: "PO-PREPAID-1", totalAmount: 11000, taxAmount: 1000 });

    const result = await withContext((c) =>
      getService(c).createPayment(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        paymentDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: null,
        memo: null,
        purchaseRecognitionIds: ["SR-PREPAID-1"],
      }),
    );
    expect(result.success).toBe(true);

    const header = await db
      .select()
      .from(schema.paymentHeaders)
      .where(eq(schema.paymentHeaders.id, result.id));
    expect(header[0].totalAmount).toBe(0);
    expect(header[0].taxAmount).toBe(0);

    const items = await db
      .select()
      .from(schema.paymentHeaderItems)
      .where(eq(schema.paymentHeaderItems.paymentHeaderId, result.id));
    expect(items).toHaveLength(1);
    expect(items[0].purchaseRecognitionId).toBe("SR-PREPAID-1");
    expect(items[0].amount).toBe(0);
    expect(items[0].taxAmount).toBe(0);

    const updatedRecognition = await db
      .select()
      .from(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.id, "SR-PREPAID-1"));
    expect(updatedRecognition[0].paymentStatus).toBe("PAID");
  });

  it("発注が前払していない(isPaid=false)場合は通常通り全額の支払明細になる", async () => {
    await seedOrder("PO-PREPAID-2", { isPaid: false, totalAmount: 11000 });
    await seedRecognition("SR-PREPAID-2", { orderId: "PO-PREPAID-2", totalAmount: 11000, taxAmount: 1000 });

    const result = await withContext((c) =>
      getService(c).createPayment(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        paymentDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: null,
        memo: null,
        purchaseRecognitionIds: ["SR-PREPAID-2"],
      }),
    );

    const items = await db
      .select()
      .from(schema.paymentHeaderItems)
      .where(eq(schema.paymentHeaderItems.paymentHeaderId, result.id));
    expect(items[0].amount).toBe(11000);
    expect(items[0].taxAmount).toBe(1000);
  });

  it("発注に紐づかない(orderIdなし)仕入計上は通常通り全額の支払明細になる", async () => {
    await seedRecognition("SR-PREPAID-3", { orderId: null, totalAmount: 11000, taxAmount: 1000 });

    const result = await withContext((c) =>
      getService(c).createPayment(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        paymentDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: null,
        memo: null,
        purchaseRecognitionIds: ["SR-PREPAID-3"],
      }),
    );

    const items = await db
      .select()
      .from(schema.paymentHeaderItems)
      .where(eq(schema.paymentHeaderItems.paymentHeaderId, result.id));
    expect(items[0].amount).toBe(11000);
  });

  it("PERIODICで前払済み・前払なし・発注非依存が混在する場合、前払済み分のみ¥0になり合計が正しく計算される", async () => {
    await seedOrder("PO-PREPAID-4", { isPaid: true, totalAmount: 11000 });
    await seedRecognition("SR-PREPAID-4A", { orderId: "PO-PREPAID-4", totalAmount: 11000, taxAmount: 1000 });
    await seedOrder("PO-PREPAID-5", { isPaid: false, totalAmount: 22000 });
    await seedRecognition("SR-PREPAID-4B", { orderId: "PO-PREPAID-5", totalAmount: 22000, taxAmount: 2000 });
    await seedRecognition("SR-PREPAID-4C", { orderId: null, totalAmount: 5500, taxAmount: 500 });

    const result = await withContext((c) =>
      getService(c).createPayment(c, {
        partnerId: "P-1",
        mode: "PERIODIC",
        paymentDate: now.toISOString(),
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        title: null,
        memo: null,
        purchaseRecognitionIds: ["SR-PREPAID-4A", "SR-PREPAID-4B", "SR-PREPAID-4C"],
      }),
    );

    const header = await db
      .select()
      .from(schema.paymentHeaders)
      .where(eq(schema.paymentHeaders.id, result.id));
    // 0(前払済み) + 22000(未前払) + 5500(発注非依存) = 27500
    expect(header[0].totalAmount).toBe(27500);
    expect(header[0].taxAmount).toBe(2500);

    const recognitions = await db
      .select()
      .from(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.partnerId, "P-1"));
    expect(recognitions.every((r) => r.paymentStatus === "PAID")).toBe(true);
  });

  it("getPaymentDetailは前払済みの明細にadvanceOrder(isPaid/paidAt)を添えて返す", async () => {
    const paidAt = new Date("2026-09-01T00:00:00+09:00");
    await seedOrder("PO-PREPAID-6", { isPaid: true, totalAmount: 11000, paidAt });
    await seedRecognition("SR-PREPAID-6", { orderId: "PO-PREPAID-6", totalAmount: 11000, taxAmount: 1000 });

    const created = await withContext((c) =>
      getService(c).createPayment(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        paymentDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: null,
        memo: null,
        purchaseRecognitionIds: ["SR-PREPAID-6"],
      }),
    );

    const detail = await withContext((c) => getService(c).getPaymentDetail(c, created.id));
    expect(detail?.items[0].advanceOrder?.id).toBe("PO-PREPAID-6");
    expect(detail?.items[0].advanceOrder?.isPaid).toBe(true);
  });

  describe("listCandidateRecognitions", () => {
    it("前払済みの発注に紐づく仕入計上はisAdvancePrepaid=trueで返る", async () => {
      await seedOrder("PO-CAND-1", { isPaid: true, totalAmount: 11000 });
      await seedRecognition("SR-CAND-1", { orderId: "PO-CAND-1" });
      await seedOrder("PO-CAND-2", { isPaid: false, totalAmount: 22000 });
      await seedRecognition("SR-CAND-2", { orderId: "PO-CAND-2" });
      await seedRecognition("SR-CAND-3", { orderId: null });

      const candidates = await withContext((c) => getService(c).listCandidateRecognitions(c, "P-1"));
      const byId = new Map(candidates.map((r: any) => [r.id, r]));
      expect(byId.get("SR-CAND-1").isAdvancePrepaid).toBe(true);
      expect(byId.get("SR-CAND-1").advanceOrderId).toBe("PO-CAND-1");
      expect(byId.get("SR-CAND-2").isAdvancePrepaid).toBe(false);
      expect(byId.get("SR-CAND-3").isAdvancePrepaid).toBe(false);
    });

    it("BUG-057: 赤伝(返品など)を画面で区別できるよう、伝票区分(documentType)を返す", async () => {
      await seedRecognition("SR-CAND-P", { orderId: null });
      await seedRecognition("SR-CAND-R", { orderId: null, documentType: "RETURN" });

      const candidates = await withContext((c) => getService(c).listCandidateRecognitions(c, "P-1"));
      const byId = new Map(candidates.map((r: any) => [r.id, r]));
      expect(byId.get("SR-CAND-P").documentType).toBe("PURCHASE");
      expect(byId.get("SR-CAND-R").documentType).toBe("RETURN");
    });

    it("取引先未指定の場合は空配列を返す", async () => {
      const candidates = await withContext((c) => getService(c).listCandidateRecognitions(c, ""));
      expect(candidates).toEqual([]);
    });
  });
});
