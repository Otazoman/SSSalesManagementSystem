import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { quotesRouter } from "./index";

/**
 * 2-2(エラー処理統一)前の現状挙動を固定するキャラクタリゼーションテスト。
 * PDF生成・実SMTP送信が絡む成功パスはテスト環境で再現しないため対象外とする
 * (mail-settings/admin-usersと同様の方針)。カスタムステータス分岐(404等)のみを対象とする。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.quoteAttachments);
  await db.delete(schema.quoteItems);
  await db.delete(schema.quotes);
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
    id: "sales_quote",
    name: "見積書",
    subjectTemplate: "【御中】見積書のご送付について",
    bodyTemplate: "本文",
    updatedAt: now,
    updatedBy: "user-001",
  });
});

async function seedQuote(id: string, status = "APPROVED") {
  const now = new Date();
  await db.insert(schema.quotes).values({
    id,
    partnerId: "P-1",
    quoteDate: now,
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
  it("存在しない見積の取得は404・固定メッセージを返す", async () => {
        const ctx = createExecutionContext();
    const res = await quotesRouter.request("/nope", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "対象の見積が見つかりません",
    });
  });

  it("存在する見積の取得は200・データを返す", async () => {
    await seedQuote("QT-1");
        const ctx = createExecutionContext();
    const res = await quotesRouter.request("/QT-1", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("QT-1");
  });
});

describe("POST /:id/generate-pdf", () => {
  it("存在しない見積へのPDF生成は404・固定メッセージを返す", async () => {
        const ctx = createExecutionContext();
    const res = await quotesRouter.request(
      "/nope/generate-pdf",
      { method: "POST" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "対象データがありません",
    });
  });
});

describe("GET /download/:id/:attachmentId", () => {
  it("存在しない添付ファイルのダウンロードは404・固定メッセージを返す", async () => {
    await seedQuote("QT-1");
        const ctx = createExecutionContext();
    const res = await quotesRouter.request(
      "/download/QT-1/nope-attachment",
      {},
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "指定されたファイルレコードが見つかりません",
    });
  });
});

describe("POST /bulk-send-email", () => {
  it("承認済み見積が存在しない場合は404・{success:false, message}形状を返す", async () => {
        const ctx = createExecutionContext();
    const res = await quotesRouter.request(
      "/bulk-send-email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteIds: ["nope"] }),
      },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "承認済みかつ有効な見積データが見つかりませんでした",
    });
  });
});

describe("POST /:id/send-email", () => {
  it("承認済み見積が存在しない場合は404・{success:false, message}形状を返す", async () => {
    // 旧実装は result.data が undefined のまま c.json(undefined, 404) していたため
    // 空ボディが返る既存バグがあった(2-2で修正)。bulkSendEmailと同じ{success:false, message}形状に統一する。
        const ctx = createExecutionContext();
    const res = await quotesRouter.request(
      "/nope/send-email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: "test@example.com" }),
      },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "承認済みかつ有効な見積データが見つかりませんでした",
    });
  });
});

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await seedQuote("Q-1");
        const ctx = createExecutionContext();
    const res = await quotesRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; attachments: unknown[] }>;
    expect(body.some((q) => q.id === "Q-1")).toBe(true);
    expect(body[0]).toHaveProperty("attachments");
  });

  it("page/limit指定時は既存の検索条件を維持したまま{data,pagination}形式で返す", async () => {
    await seedQuote("Q-1");
    await seedQuote("Q-2");
        const ctx = createExecutionContext();
    const res = await quotesRouter.request(
      "/?partnerId=P-1&page=1&limit=1",
      {},
      env, ctx
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
