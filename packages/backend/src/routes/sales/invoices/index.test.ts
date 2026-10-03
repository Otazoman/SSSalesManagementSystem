import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { salesInvoicesRouter } from "./index";

/**
 * quotes/index.test.tsと同じ方針のキャラクタリゼーションテスト。
 * PDF生成の成功パスはテスト環境で再現しないため対象外(404分岐のみ)。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.salesInvoiceAttachments);
  await db.delete(schema.salesInvoiceItems);
  await db.delete(schema.salesInvoices);
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

  await env.COMPANY_SETTINGS.put(
    "config",
    JSON.stringify({
      smtp_host: "smtp.example.com",
      smtp_port: 587,
      smtp_user: "user",
      smtp_pass: "pass",
    }),
  );
  await db.delete(schema.mailTemplateSettings);
  await db.insert(schema.mailTemplateSettings).values({
    id: "sales_recognition",
    name: "売上計上",
    subjectTemplate: "【御中】売上計上書類のご送付について",
    bodyTemplate: "本文",
    updatedAt: now,
    updatedBy: "user-001",
  });
});

async function seedInvoice(id: string, status = "APPROVED") {
  const now = new Date();
  await db.insert(schema.salesInvoices).values({
    id,
    partnerId: "P-1",
    invoiceDate: now,
    status,
    documentType: "SALE",
    totalAmount: 1000,
    taxAmount: 100,
    billingStatus: "UNBILLED",
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
}

describe("GET /:id", () => {
  it("存在しない売上の取得は404・固定メッセージを返す", async () => {
    const ctx = createExecutionContext();
    const res = await salesInvoicesRouter.request("/nope", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: "対象の売上が見つかりません" });
  });

  it("存在する売上の取得は200・データを返す", async () => {
    await seedInvoice("SI-1");
    const ctx = createExecutionContext();
    const res = await salesInvoicesRouter.request("/SI-1", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("SI-1");
  });
});

describe("POST /:id/generate-pdf", () => {
  it("存在しない売上へのPDF生成は404・固定メッセージを返す", async () => {
    const ctx = createExecutionContext();
    const res = await salesInvoicesRouter.request("/nope/generate-pdf", { method: "POST" }, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: "対象データがありません" });
  });
});

describe("GET /download/:id/:attachmentId", () => {
  it("存在しない添付ファイルのダウンロードは404・固定メッセージを返す", async () => {
    await seedInvoice("SI-1");
    const ctx = createExecutionContext();
    const res = await salesInvoicesRouter.request("/download/SI-1/nope-attachment", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: "指定されたファイルレコードが見つかりません" });
  });
});

describe("POST /bulk-send-email", () => {
  it("承認済み売上が存在しない場合は404・{success:false, message}形状を返す", async () => {
    const ctx = createExecutionContext();
    const res = await salesInvoicesRouter.request(
      "/bulk-send-email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: ["nope"] }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: "承認済みかつ有効な売上データが見つかりませんでした" });
  });
});

describe("POST /:id/send-email", () => {
  it("承認済み売上が存在しない場合は404・{success:false, message}形状を返す", async () => {
    const ctx = createExecutionContext();
    const res = await salesInvoicesRouter.request(
      "/nope/send-email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: "test@example.com" }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: "承認済みかつ有効な売上データが見つかりませんでした" });
  });
});

describe("DELETE /:id", () => {
  it("APPROVED状態の売上を直接削除しようとすると400", async () => {
    await seedInvoice("SI-1", "APPROVED");
    const ctx = createExecutionContext();
    const res = await salesInvoicesRouter.request("/SI-1", { method: "DELETE" }, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });
});

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await seedInvoice("SI-1");
    const ctx = createExecutionContext();
    const res = await salesInvoicesRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; attachments: unknown[] }>;
    expect(body.some((r) => r.id === "SI-1")).toBe(true);
    expect(body[0]).toHaveProperty("attachments");
  });

  it("page/limit指定時は{data,pagination}形式で返す", async () => {
    await seedInvoice("SI-1");
    await seedInvoice("SI-2");
    const ctx = createExecutionContext();
    const res = await salesInvoicesRouter.request("/?partnerId=P-1&page=1&limit=1", {}, env, ctx);
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
