import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { PaymentRepository } from "./payment.repository";
import { PaymentService } from "./payment.service";
import type { Env } from "../../../types/env";

// #14-2⑥: 元々1121行あったpayment-crud.test.tsから、基本的な検証(モード別バリデーション・
// 正常系・getPaymentDetail)・赤伝(追加要望L-2-a)の部分を分割したもの。ロジック変更なし。
// ヘルパー関数は既存の慣習(payment-csv.test.ts、sales-order-crud/workflow.service.test.ts)に
// ならい、分割後の各ファイルにそのまま複製している(共通ファイル化はしない)。

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

describe("PaymentCrudService.createPayment: モード別バリデーション", () => {
  it("PER_TRANSACTIONで対象仕入を2件以上指定すると400", async () => {
    await seedRecognition("SR-1");
    await seedRecognition("SR-2");

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
          purchaseRecognitionIds: ["SR-1", "SR-2"],
        }),
      ),
    ).rejects.toThrow("都度支払(PER_TRANSACTION)では対象を合計1件のみ選択してください");
  });

  it("PERIODICでperiodStart/periodEnd未指定だと400", async () => {
    await seedRecognition("SR-1");

    await expect(
      withContext((c) =>
        getService(c).createPayment(c, {
          partnerId: "P-1",
          mode: "PERIODIC",
          paymentDate: now.toISOString(),
          periodStart: null,
          periodEnd: null,
          title: null,
          memo: null,
          purchaseRecognitionIds: ["SR-1"],
        }),
      ),
    ).rejects.toThrow("締め支払(PERIODIC)では対象期間");
  });

  it("承認済みでない仕入を対象にすると400", async () => {
    await seedRecognition("SR-1", { status: "DRAFT" });

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
          purchaseRecognitionIds: ["SR-1"],
        }),
      ),
    ).rejects.toThrow("承認済み");
  });

  it("既に支払済み(PAID)の仕入を対象にすると400", async () => {
    await seedRecognition("SR-1", { paymentStatus: "PAID" });

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
          purchaseRecognitionIds: ["SR-1"],
        }),
      ),
    ).rejects.toThrow("既に支払済み");
  });

  it("取引先が支払先と一致しない仕入を対象にすると400", async () => {
    await seedRecognition("SR-1", { partnerId: "P-2" });

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
          purchaseRecognitionIds: ["SR-1"],
        }),
      ),
    ).rejects.toThrow("取引先が指定の支払先と一致しません");
  });

  it("存在しない仕入を対象にすると404", async () => {
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
          purchaseRecognitionIds: ["NOPE"],
        }),
      ),
    ).rejects.toThrow("見つかりません");
  });
});

describe("PaymentCrudService.createPayment: 正常系", () => {
  it("PER_TRANSACTIONで支払を作成し、対象仕入のpaymentStatusがPAIDに更新される", async () => {
    await seedRecognition("SR-1");

    const result = await withContext((c) =>
      getService(c).createPayment(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        paymentDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: "9月分支払",
        memo: null,
        purchaseRecognitionIds: ["SR-1"],
      }),
    );
    expect(result.success).toBe(true);

    const updatedRecognition = await db
      .select()
      .from(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.id, "SR-1"));
    expect(updatedRecognition[0].paymentStatus).toBe("PAID");

    const header = await db
      .select()
      .from(schema.paymentHeaders)
      .where(eq(schema.paymentHeaders.id, result.id));
    expect(header[0].totalAmount).toBe(11000);
    expect(header[0].taxAmount).toBe(1000);
    expect(header[0].mode).toBe("PER_TRANSACTION");
    expect(header[0].reconciliationStatus).toBe("UNRECONCILED");

    const items = await db
      .select()
      .from(schema.paymentHeaderItems)
      .where(eq(schema.paymentHeaderItems.paymentHeaderId, result.id));
    expect(items).toHaveLength(1);
    expect(items[0].purchaseRecognitionId).toBe("SR-1");
  });

  it("PERIODICで複数仕入を束ねて支払を作成できる", async () => {
    await seedRecognition("SR-1", { totalAmount: 11000, taxAmount: 1000 });
    await seedRecognition("SR-2", { totalAmount: 22000, taxAmount: 2000 });

    const result = await withContext((c) =>
      getService(c).createPayment(c, {
        partnerId: "P-1",
        mode: "PERIODIC",
        paymentDate: now.toISOString(),
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        title: "9月度締め支払",
        memo: null,
        purchaseRecognitionIds: ["SR-1", "SR-2"],
      }),
    );
    expect(result.success).toBe(true);

    const header = await db
      .select()
      .from(schema.paymentHeaders)
      .where(eq(schema.paymentHeaders.id, result.id));
    expect(header[0].totalAmount).toBe(33000);
    expect(header[0].taxAmount).toBe(3000);

    const recognitions = await db
      .select()
      .from(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.partnerId, "P-1"));
    expect(recognitions.every((r) => r.paymentStatus === "PAID")).toBe(true);
  });
});

describe("PaymentCrudService.getPaymentDetail", () => {
  it("存在しないIDはnullを返す", async () => {
    const detail = await withContext((c) => getService(c).getPaymentDetail(c, "NOPE"));
    expect(detail).toBeNull();
  });

  it("作成した支払の詳細を明細・消込履歴込みで取得できる", async () => {
    await seedRecognition("SR-1");
    const created = await withContext((c) =>
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

    const detail = await withContext((c) => getService(c).getPaymentDetail(c, created.id));
    expect(detail?.items).toHaveLength(1);
    expect(detail?.items[0].purchaseRecognition.id).toBe("SR-1");
    expect(detail?.disbursements).toEqual([]);
  });
});

describe("追加要望L-2-a: 赤伝(返品/値引/赤伝(訂正))は支払額から減算する", () => {
  it("仕入33,000 + 返品11,000(正の金額で保存)を束ねると支払は22,000(消費税2,000)", async () => {
    await seedRecognition("SR-1", { totalAmount: 33000, taxAmount: 3000 });
    await seedRecognition("SR-RET", { totalAmount: 11000, taxAmount: 1000, documentType: "RETURN", originalRecognitionId: "SR-1" });

    const result = await withContext((c) =>
      getService(c).createPayment(c, {
        partnerId: "P-1",
        mode: "PERIODIC",
        paymentDate: now.toISOString(),
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        title: null,
        memo: null,
        purchaseRecognitionIds: ["SR-1", "SR-RET"],
      }),
    );
    const header = (await db.select().from(schema.paymentHeaders)).find((h) => h.id === result.id)!;
    expect(header.totalAmount).toBe(22000);
    expect(header.taxAmount).toBe(2000);
    const items = (await db.select().from(schema.paymentHeaderItems)).filter((i) => i.paymentHeaderId === result.id);
    expect(items.find((i) => i.purchaseRecognitionId === "SR-RET")?.amount).toBe(-11000);
  });
});
