import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { paymentRouter } from "./index";

/**
 * sales/billing/index.test.tsと同じ方針のキャラクタリゼーションテスト。
 */

const db = drizzle(env.DB, { schema });
const now = new Date();

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
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
});

async function seedRecognition(id: string, status = "APPROVED") {
  await db.insert(schema.purchaseRecognitions).values({
    id,
    partnerId: "P-1",
    recognitionDate: now,
    status,
    documentType: "PURCHASE",
    totalAmount: 11000,
    taxAmount: 1000,
    paymentStatus: "UNPAID",
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
}

async function seedPayment(id: string) {
  await db.insert(schema.paymentHeaders).values({
    id,
    partnerId: "P-1",
    paymentDate: now,
    mode: "PER_TRANSACTION",
    status: "DRAFT",
    totalAmount: 11000,
    taxAmount: 1000,
    reconciledAmount: 0,
    reconciliationStatus: "UNRECONCILED",
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
}

describe("GET /:id", () => {
  it("存在しない支払の取得は404・固定メッセージを返す", async () => {
    const ctx = createExecutionContext();
    const res = await paymentRouter.request("/nope", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: "対象の支払が見つかりません" });
  });

  it("存在する支払の取得は200・データを返す", async () => {
    await seedPayment("PM-1");
    const ctx = createExecutionContext();
    const res = await paymentRouter.request("/PM-1", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("PM-1");
  });
});

describe("POST /register", () => {
  it("バリデーションエラー(必須項目未送信)は400", async () => {
    const ctx = createExecutionContext();
    const res = await paymentRouter.request(
      "/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("対象の仕入を束ねて支払を作成できる", async () => {
    await seedRecognition("SR-1");
    const ctx = createExecutionContext();
    const res = await paymentRouter.request(
      "/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerId: "P-1",
          mode: "PER_TRANSACTION",
          paymentDate: now.toISOString(),
          purchaseRecognitionIds: ["SR-1"],
        }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; id: string };
    expect(body.success).toBe(true);
    expect(body.id).toBeTruthy();
  });
});

describe("POST /:id/disbursements", () => {
  it("存在しない支払への消込記録は404", async () => {
    const ctx = createExecutionContext();
    const res = await paymentRouter.request(
      "/nope/disbursements",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidDate: now.toISOString(), amount: 1000 }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });

  it("存在する支払への消込記録は200・集計を返す", async () => {
    await seedPayment("PM-1");
    const ctx = createExecutionContext();
    const res = await paymentRouter.request(
      "/PM-1/disbursements",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidDate: now.toISOString(), amount: 11000, method: "CASH" }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reconciliationStatus: string };
    expect(body.reconciliationStatus).toBe("RECONCILED");
  });
});

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await seedPayment("PM-1");
    const ctx = createExecutionContext();
    const res = await paymentRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((r) => r.id === "PM-1")).toBe(true);
  });

  it("page/limit指定時は{data,pagination}形式で返す", async () => {
    await seedPayment("PM-1");
    const ctx = createExecutionContext();
    const res = await paymentRouter.request("/?page=1&limit=10", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; pagination: { total: number } };
    expect(body.pagination.total).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /csv-download", () => {
  it("CSVファイルとしてダウンロードできる", async () => {
    await seedPayment("PM-1");
    const ctx = createExecutionContext();
    const res = await paymentRouter.request("/csv-download", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
  });
});
