import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { purchaseRecognitionsRouter } from "./index";

/**
 * sales/invoices/index.test.tsと同じ方針のキャラクタリゼーションテスト。
 * PDF生成の成功パスはテスト環境で再現しないため対象外(404分岐のみ)。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.purchaseRecognitionAttachments);
  await db.delete(schema.purchaseRecognitionItems);
  await db.delete(schema.purchaseRecognitions);
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
    name: "仕入先1",
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
});

async function seedRecognition(id: string, status = "APPROVED") {
  const now = new Date();
  await db.insert(schema.purchaseRecognitions).values({
    id,
    partnerId: "P-1",
    recognitionDate: now,
    status,
    documentType: "PURCHASE",
    totalAmount: 1000,
    taxAmount: 100,
    paymentStatus: "UNPAID",
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
}

describe("GET /:id", () => {
  it("存在しない仕入の取得は404・固定メッセージを返す", async () => {
    const ctx = createExecutionContext();
    const res = await purchaseRecognitionsRouter.request("/nope", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: "対象の仕入が見つかりません" });
  });

  it("存在する仕入の取得は200・データを返す", async () => {
    await seedRecognition("SR-1");
    const ctx = createExecutionContext();
    const res = await purchaseRecognitionsRouter.request("/SR-1", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("SR-1");
  });
});

describe("POST /:id/generate-pdf", () => {
  it("存在しない仕入へのPDF生成は404・固定メッセージを返す", async () => {
    const ctx = createExecutionContext();
    const res = await purchaseRecognitionsRouter.request(
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
    await seedRecognition("SR-1");
    const ctx = createExecutionContext();
    const res = await purchaseRecognitionsRouter.request(
      "/download/SR-1/nope-attachment",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: "指定されたファイルレコードが見つかりません" });
  });
});

describe("DELETE /:id", () => {
  it("APPROVED状態の仕入を直接削除しようとすると400", async () => {
    await seedRecognition("SR-1", "APPROVED");
    const ctx = createExecutionContext();
    const res = await purchaseRecognitionsRouter.request("/SR-1", { method: "DELETE" }, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });
});

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await seedRecognition("SR-1");
    const ctx = createExecutionContext();
    const res = await purchaseRecognitionsRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; attachments: unknown[] }>;
    expect(body.some((r) => r.id === "SR-1")).toBe(true);
    expect(body[0]).toHaveProperty("attachments");
  });

  it("page/limit指定時は{data,pagination}形式で返す", async () => {
    await seedRecognition("SR-1");
    await seedRecognition("SR-2");
    const ctx = createExecutionContext();
    const res = await purchaseRecognitionsRouter.request(
      "/?partnerId=P-1&page=1&limit=1",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });
});
