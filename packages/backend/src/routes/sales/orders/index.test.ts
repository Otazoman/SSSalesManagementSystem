import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { salesOrdersRouter } from "./index";

/**
 * quotes/index.test.tsと同じ方針のキャラクタリゼーションテスト。
 * PDF生成・実SMTP送信が絡む成功パスはテスト環境で再現しないため対象外とし、
 * ルーティング・404分岐のみを対象とする。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.salesOrderAttachments);
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  await db.delete(schema.partners);
  await db.delete(schema.users);

  const now = new Date();
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

async function seedOrder(id: string, status = "APPROVED") {
  const now = new Date();
  await db.insert(schema.salesOrders).values({
    id,
    partnerId: "P-1",
    orderDate: now,
    status,
    totalAmount: 1000,
    taxAmount: 100,
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
}

describe("GET /:id", () => {
  it("存在しない受注の取得は404・固定メッセージを返す", async () => {
    const ctx = createExecutionContext();
    const res = await salesOrdersRouter.request("/nope", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: "対象の受注が見つかりません" });
  });

  it("存在する受注の取得は200・データを返す", async () => {
    await seedOrder("SO-1");
    const ctx = createExecutionContext();
    const res = await salesOrdersRouter.request("/SO-1", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("SO-1");
  });
});

describe("POST /:id/generate-pdf", () => {
  it("存在しない受注へのPDF生成は404・固定メッセージを返す", async () => {
    const ctx = createExecutionContext();
    const res = await salesOrdersRouter.request(
      "/nope/generate-pdf",
      { method: "POST" },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: "対象データがありません" });
  });
});

describe("GET /download/:id/:attachmentId", () => {
  it("存在しない添付ファイルのダウンロードは404・固定メッセージを返す", async () => {
    await seedOrder("SO-1");
    const ctx = createExecutionContext();
    const res = await salesOrdersRouter.request(
      "/download/SO-1/nope-attachment",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});

describe("GET /csv-download", () => {
  it("受注が0件でもCSVダウンロードは200・ヘッダー行のみのCSVを返す", async () => {
    const ctx = createExecutionContext();
    const res = await salesOrdersRouter.request("/csv-download", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("id");
    expect(text).toContain("sourceQuoteId");
  });
});
