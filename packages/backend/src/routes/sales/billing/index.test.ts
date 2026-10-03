import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { billingRouter } from "./index";
import { grantAllDocumentTypesToEmailTargets } from "../../../../test/support/contact-document-types";

/**
 * sales-invoices/index.test.tsと同じ方針のキャラクタリゼーションテスト。
 * PDF生成の成功パスはテスト環境で再現しないため対象外(404分岐のみ)。
 */

const db = drizzle(env.DB, { schema });
const now = new Date();

beforeEach(async () => {
  await db.delete(schema.paymentReceipts);
  await db.delete(schema.billingItems);
  await db.delete(schema.billingHeaders);
  await db.delete(schema.salesInvoiceItems);
  await db.delete(schema.salesInvoices);
  // 追加要望: 一括メール送信テストで登録するpartnerContactsは、partnersのFK参照元のため
  // partnersを消す前に削除する必要がある
  await db.delete(schema.partnerContacts);
  await db.delete(schema.partners);
  await db.delete(schema.users);
  await db.delete(schema.mailTemplateSettings);

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

async function seedInvoice(id: string, status = "APPROVED") {
  await db.insert(schema.salesInvoices).values({
    id,
    partnerId: "P-1",
    invoiceDate: now,
    status,
    documentType: "SALE",
    totalAmount: 11000,
    taxAmount: 1000,
    billingStatus: "UNBILLED",
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
}

async function seedBilling(id: string) {
  await db.insert(schema.billingHeaders).values({
    id,
    partnerId: "P-1",
    billingDate: now,
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
  it("存在しない請求の取得は404・固定メッセージを返す", async () => {
    const ctx = createExecutionContext();
    const res = await billingRouter.request("/nope", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: "対象の請求が見つかりません" });
  });

  it("存在する請求の取得は200・データを返す", async () => {
    await seedBilling("BL-1");
    const ctx = createExecutionContext();
    const res = await billingRouter.request("/BL-1", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("BL-1");
  });
});

describe("POST /register", () => {
  it("バリデーションエラー(必須項目未送信)は400", async () => {
    const ctx = createExecutionContext();
    const res = await billingRouter.request(
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

  it("対象の売上を束ねて請求を作成できる", async () => {
    await seedInvoice("SI-1");
    const ctx = createExecutionContext();
    const res = await billingRouter.request(
      "/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerId: "P-1",
          mode: "PER_TRANSACTION",
          billingDate: now.toISOString(),
          salesInvoiceIds: ["SI-1"],
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

describe("POST /:id/payment-receipts", () => {
  it("存在しない請求への消込記録は404", async () => {
    const ctx = createExecutionContext();
    const res = await billingRouter.request(
      "/nope/payment-receipts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receivedDate: now.toISOString(), amount: 1000 }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });

  it("存在する請求への消込記録は200・集計を返す", async () => {
    await seedBilling("BL-1");
    const ctx = createExecutionContext();
    const res = await billingRouter.request(
      "/BL-1/payment-receipts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receivedDate: now.toISOString(), amount: 11000, method: "CASH" }),
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

describe("POST /:id/generate-pdf", () => {
  it("存在しない請求へのPDF生成は404・固定メッセージを返す", async () => {
    const ctx = createExecutionContext();
    const res = await billingRouter.request("/nope/generate-pdf", { method: "POST" }, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: "対象データがありません" });
  });
});

describe("GET /:id/download-pdf", () => {
  it("存在しない請求は404", async () => {
    const ctx = createExecutionContext();
    const res = await billingRouter.request("/nope/download-pdf", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });

  it("PDF未発行(invoicePdfR2Path未設定)の場合は404", async () => {
    await seedBilling("BL-1");
    const ctx = createExecutionContext();
    const res = await billingRouter.request("/BL-1/download-pdf", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });

  it("PDF発行済みならR2から実体ファイルを返す", async () => {
    await seedBilling("BL-1");
    const r2Path = "billing/BL-1/generated_invoice.pdf";
    await db
      .update(schema.billingHeaders)
      .set({ status: "ISSUED", invoicePdfR2Path: r2Path })
      .where(eq(schema.billingHeaders.id, "BL-1"));
    await env.QUATES_BUCKET.put(r2Path, "dummy-pdf-content", {
      httpMetadata: { contentType: "application/pdf" },
    });

    const ctx = createExecutionContext();
    const res = await billingRouter.request("/BL-1/download-pdf", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const text = await res.text();
    expect(text).toBe("dummy-pdf-content");
  });
});

describe("POST /:id/send-email", () => {
  it("存在しない請求は404・{error}形状を返す", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ smtp_host: "smtp.example.com", smtp_port: 587 }),
    );
    await db.insert(schema.mailTemplateSettings).values({
      id: "billing_invoice",
      name: "請求書",
      subjectTemplate: "【御中】ご請求書のご送付について",
      bodyTemplate: "本文",
      updatedAt: now,
      updatedBy: "user-001",
    });
    const ctx = createExecutionContext();
    const res = await billingRouter.request(
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
  });

  it("PDF未発行の場合は400", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ smtp_host: "smtp.example.com", smtp_port: 587 }),
    );
    await db.insert(schema.mailTemplateSettings).values({
      id: "billing_invoice",
      name: "請求書",
      subjectTemplate: "【御中】ご請求書のご送付について",
      bodyTemplate: "本文",
      updatedAt: now,
      updatedBy: "user-001",
    });
    await seedBilling("BL-1");
    const ctx = createExecutionContext();
    const res = await billingRouter.request(
      "/BL-1/send-email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: "test@example.com" }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("PDF発行済みなら送信を予約する", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ smtp_host: "smtp.example.com", smtp_port: 587 }),
    );
    await db.insert(schema.mailTemplateSettings).values({
      id: "billing_invoice",
      name: "請求書",
      subjectTemplate: "【御中】ご請求書のご送付について",
      bodyTemplate: "本文",
      updatedAt: now,
      updatedBy: "user-001",
    });
    await seedBilling("BL-1");
    await db
      .update(schema.billingHeaders)
      .set({ status: "ISSUED", invoicePdfR2Path: "billing/BL-1/generated_invoice.pdf" })
      .where(eq(schema.billingHeaders.id, "BL-1"));

    const ctx = createExecutionContext();
    const res = await billingRouter.request(
      "/BL-1/send-email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: "test@example.com" }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });
});

describe("追加要望: POST /bulk-send-email", () => {
  it("対象の請求データが1件も見つからない場合は404", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ smtp_host: "smtp.example.com", smtp_port: 587 }),
    );
    await db.insert(schema.mailTemplateSettings).values({
      id: "billing_invoice",
      name: "請求書",
      subjectTemplate: "【御中】ご請求書のご送付について",
      bodyTemplate: "本文",
      updatedAt: now,
      updatedBy: "user-001",
    });
    const ctx = createExecutionContext();
    const res = await billingRouter.request(
      "/bulk-send-email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingHeaderIds: ["nope"] }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });

  it("PDF発行済み・登録済み連絡先ありなら送信を予約する", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ smtp_host: "smtp.example.com", smtp_port: 587 }),
    );
    await db.insert(schema.mailTemplateSettings).values({
      id: "billing_invoice",
      name: "請求書",
      subjectTemplate: "【御中】ご請求書のご送付について",
      bodyTemplate: "本文",
      updatedAt: now,
      updatedBy: "user-001",
    });
    await db.insert(schema.partnerContacts).values({
      id: "PC-1",
      partnerId: "P-1",
      contactType: "PRIMARY",
      email: "contact@example.com",
      isEmailTarget: true,
      status: "active",
      createdBy: "user-001",
      createdAt: now,
      updatedBy: "user-001",
      updatedAt: now,
    });
    await grantAllDocumentTypesToEmailTargets(env.DB);
    await seedBilling("BL-1");
    await db
      .update(schema.billingHeaders)
      .set({ status: "ISSUED", invoicePdfR2Path: "billing/BL-1/generated_invoice.pdf" })
      .where(eq(schema.billingHeaders.id, "BL-1"));

    const ctx = createExecutionContext();
    const res = await billingRouter.request(
      "/bulk-send-email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingHeaderIds: ["BL-1"] }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain("予約: 1件");
    expect(body.message).toContain("失敗: 0件");
  });

  it("PDF未発行かつ自動生成にも失敗する場合、その請求だけ失敗としてカウントされる(全体は200)", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ smtp_host: "smtp.example.com", smtp_port: 587 }),
    );
    await db.insert(schema.mailTemplateSettings).values({
      id: "billing_invoice",
      name: "請求書",
      subjectTemplate: "【御中】ご請求書のご送付について",
      bodyTemplate: "本文",
      updatedAt: now,
      updatedBy: "user-001",
    });
    await seedBilling("BL-1");
    await db.insert(schema.billingItems).values({
      id: "BL-1-ITEM-1",
      billingHeaderId: "BL-1",
      salesInvoiceId: null,
      amount: 10000,
      taxAmount: 1000,
      sortOrder: 0,
      itemName: "テスト品目",
      quantity: 1,
      unitPrice: 10000,
    });

    const ctx = createExecutionContext();
    const res = await billingRouter.request(
      "/bulk-send-email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingHeaderIds: ["BL-1"] }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain("予約: 0件");
    expect(body.message).toContain("失敗: 1件");
  });
});

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await seedBilling("BL-1");
    const ctx = createExecutionContext();
    const res = await billingRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((r) => r.id === "BL-1")).toBe(true);
  });

  it("page/limit指定時は{data,pagination}形式で返す", async () => {
    await seedBilling("BL-1");
    const ctx = createExecutionContext();
    const res = await billingRouter.request("/?page=1&limit=10", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; pagination: { total: number } };
    expect(body.pagination.total).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /csv-download", () => {
  it("CSVファイルとしてダウンロードできる", async () => {
    await seedBilling("BL-1");
    const ctx = createExecutionContext();
    const res = await billingRouter.request("/csv-download", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
  });
});

describe("追加要望: DELETE /:id", () => {
  it("存在しない請求の削除は404", async () => {
    const ctx = createExecutionContext();
    const res = await billingRouter.request("/nope", { method: "DELETE" }, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });

  it("入金消込済みの請求は削除できない(400)", async () => {
    await seedBilling("BL-1");
    await db
      .update(schema.billingHeaders)
      .set({ reconciledAmount: 5000 })
      .where(eq(schema.billingHeaders.id, "BL-1"));

    const ctx = createExecutionContext();
    const res = await billingRouter.request("/BL-1", { method: "DELETE" }, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    expect(await db.select().from(schema.billingHeaders).where(eq(schema.billingHeaders.id, "BL-1"))).toHaveLength(1);
  });

  it("未消込の請求を削除すると、ヘッダー・明細が削除され、紐づく売上はUNBILLEDへ戻る", async () => {
    await seedInvoice("SI-1");
    await seedBilling("BL-1");
    await db.insert(schema.billingItems).values({
      id: "BI-1",
      billingHeaderId: "BL-1",
      salesInvoiceId: "SI-1",
      amount: 10000,
      taxAmount: 1000,
      sortOrder: 0,
    });
    await db
      .update(schema.salesInvoices)
      .set({ billingStatus: "BILLED" })
      .where(eq(schema.salesInvoices.id, "SI-1"));

    const ctx = createExecutionContext();
    const res = await billingRouter.request("/BL-1", { method: "DELETE" }, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);

    expect(await db.select().from(schema.billingHeaders).where(eq(schema.billingHeaders.id, "BL-1"))).toHaveLength(0);
    expect(await db.select().from(schema.billingItems).where(eq(schema.billingItems.billingHeaderId, "BL-1"))).toHaveLength(0);

    const invoice = (
      await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, "SI-1"))
    )[0];
    expect(invoice.billingStatus).toBe("UNBILLED");
  });
});

describe("追加要望L-2-a: 赤伝(返品/値引/赤伝(訂正))は請求額から減算する", () => {
  it("売上11,000 + 返品5,500(正の金額で保存)を束ねると請求は5,500(消費税500)、明細は返品がマイナスで保存される", async () => {
    await seedInvoice("SI-A");
    await db.insert(schema.salesInvoices).values({
      id: "SI-RET",
      partnerId: "P-1",
      invoiceDate: now,
      status: "APPROVED",
      documentType: "RETURN",
      originalInvoiceId: "SI-A",
      totalAmount: 5500,
      taxAmount: 500,
      billingStatus: "UNBILLED",
      createdBy: "user-001",
      createdAt: now,
      updatedBy: "user-001",
      updatedAt: now,
    });

    const ctx = createExecutionContext();
    const res = await billingRouter.request(
      "/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerId: "P-1",
          mode: "PERIODIC",
          billingDate: now.toISOString(),
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          salesInvoiceIds: ["SI-A", "SI-RET"],
        }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };

    const header = (await db.select().from(schema.billingHeaders)).find((h) => h.id === id)!;
    expect(header.totalAmount).toBe(5500);
    expect(header.taxAmount).toBe(500);
    const items = (await db.select().from(schema.billingItems)).filter((i) => i.billingHeaderId === id);
    expect(items.find((i) => i.salesInvoiceId === "SI-RET")?.amount).toBe(-5500);
    expect(items.find((i) => i.salesInvoiceId === "SI-A")?.amount).toBe(11000);
  });
});

describe("BUG-042: 請求書の消費税は、請求書ごと・税率ごとに1回の端数処理", () => {
  it("売上ごとの消費税の合計(100円+100円)ではなく、請求の明細全体(2,010円)から1回計算する(切り捨てで201円)", async () => {
    await env.COMPANY_SETTINGS.put("config", JSON.stringify({ tax_rounding_mode: "floor" }));
    for (const id of ["SI-T1", "SI-T2"]) {
      await db.insert(schema.salesInvoices).values({
        id,
        partnerId: "P-1",
        invoiceDate: now,
        status: "APPROVED",
        documentType: "SALE",
        totalAmount: 1105,
        taxAmount: 100,
        billingStatus: "UNBILLED",
        createdBy: "user-001",
        createdAt: now,
        updatedBy: "user-001",
        updatedAt: now,
      });
      await db.insert(schema.salesInvoiceItems).values({
        id: `${id}-L1`,
        salesInvoiceId: id,
        itemName: "品目",
        quantity: 1,
        unitPrice: 1005,
        amount: 1005,
      });
    }

    const ctx = createExecutionContext();
    const res = await billingRouter.request(
      "/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerId: "P-1",
          mode: "PERIODIC",
          billingDate: now.toISOString(),
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          salesInvoiceIds: ["SI-T1", "SI-T2"],
        }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };

    const header = (await db.select().from(schema.billingHeaders)).find((h) => h.id === id)!;
    expect(header.taxAmount).toBe(201);
    expect(header.totalAmount).toBe(2211);
  });
});
