import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { renderReportPdf, type ReportPdfSource } from "report-renderer";
import { signSessionToken } from "../../../platform/auth/session-token";
import { Hono } from "hono";
import { quotesRouter } from "./index";
import { QuotePdfService } from "./quote-pdf.service";
import { QuoteRepository } from "./quote.repository";
import { loadReportAssets } from "../../../platform/report-templates/load-report-assets";
import type { Env } from "../../../types/env";

// PERF-07 B-3・B-4: 見積書 PDF をブラウザで作るための API(GET /:id/pdf-source・POST /:id/pdf)

const db = drizzle(env.DB, { schema });
const FIXED_NOW = new Date("2026-11-14T00:00:00Z");

function fontBuffer(): ArrayBuffer {
  const bin = atob((env as unknown as { TEST_FONT_BASE64: string }).TEST_FONT_BASE64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function cookieOf(userId: string) {
  const token = await signSessionToken(
    { userId, employeeNumber: userId, name: userId, role: "general_user", deptName: "", companyName: "", isAuditEnabled: false },
    await env.SESSION_SECRET.get(),
    3600,
  );
  return `session_token=${token}`;
}

async function request(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await quotesRouter.request(path, init, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function pdfForm(bytes: Uint8Array | string) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), "quote.pdf");
  return form;
}

async function storedPdfs(quoteId: string) {
  const rows = await db.select().from(schema.quoteAttachments).where(eq(schema.quoteAttachments.quoteId, quoteId));
  const result: Uint8Array[] = [];
  for (const row of rows) {
    const obj = await env.QUATES_BUCKET.get(row.attachmentR2Path!);
    result.push(new Uint8Array(await obj!.arrayBuffer()));
  }
  return result;
}

beforeEach(async () => {
  for (const table of [
    schema.quoteAttachments,
    schema.quoteItems,
    schema.quotes,
    schema.rolePermissions,
    schema.permissions,
    schema.userRoles,
    schema.roles,
    schema.partners,
    schema.users,
    schema.mailTemplateSettings,
  ]) {
    await db.delete(table);
  }
  await env.KV_PERMISSIONS.delete("role_permissions:sales");
  await env.KV_PERMISSIONS.delete("role_permissions:viewer");
  await env.COMPANY_SETTINGS.delete("config");
  await env.SYSTEM_BUCKET.delete(["company/company_logo.png", "company/company_seal.png"]);
  await env.SYSTEM_BUCKET.put("fonts/company_fonts.ttf", fontBuffer());

  const now = new Date();
  await db.insert(schema.users).values([
    { id: "u-sales", employeeNumber: "E-SALES", email: "sales@example.com", name: "営業", createdAt: now, updatedAt: now },
    { id: "u-viewer", employeeNumber: "E-VIEW", email: "view@example.com", name: "閲覧", createdAt: now, updatedAt: now },
    { id: "u-none", employeeNumber: "E-NONE", email: "none@example.com", name: "権限なし", createdAt: now, updatedAt: now },
  ]);
  await db.insert(schema.roles).values([
    { id: "sales", name: "営業", createdAt: now },
    { id: "viewer", name: "閲覧", createdAt: now },
  ]);
  await db.insert(schema.permissions).values([
    { id: "sales_quotes:read", resource: "sales_quotes", action: "read", name: "見積の参照" },
    { id: "sales_quotes:update", resource: "sales_quotes", action: "update", name: "見積の更新" },
  ]);
  await db.insert(schema.rolePermissions).values([
    { roleId: "sales", permissionId: "sales_quotes:read" },
    { roleId: "sales", permissionId: "sales_quotes:update" },
    { roleId: "viewer", permissionId: "sales_quotes:read" },
  ]);
  await db.insert(schema.userRoles).values([
    { userId: "u-sales", roleId: "sales", departmentSurrogateId: null },
    { userId: "u-viewer", roleId: "viewer", departmentSurrogateId: null },
  ]);
  await db.insert(schema.partners).values({
    id: "P-1",
    name: "取引先1",
    createdBy: "u-sales",
    createdAt: now,
    updatedBy: "u-sales",
    updatedAt: now,
  });
  await db.insert(schema.quotes).values({
    id: "QT-1",
    partnerId: "P-1",
    quoteDate: now,
    status: "APPROVED",
    totalAmount: 1100,
    taxAmount: 100,
    createdBy: "u-sales",
    createdAt: now,
    updatedBy: "u-sales",
    updatedAt: now,
  });
  await db.insert(schema.quoteItems).values({
    id: "QI-1",
    quoteId: "QT-1",
    itemName: "テスト品目",
    quantity: 2,
    unitPrice: 500,
    amount: 1000,
  } as typeof schema.quoteItems.$inferInsert);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /:id/pdf-source(PERF-07 B-3)", () => {
  it("ログインしていなければ 401、参照の権限が無ければ 403", async () => {
    expect((await request("/QT-1/pdf-source")).status).toBe(401);
    expect((await request("/QT-1/pdf-source", { headers: { Cookie: await cookieOf("u-none") } })).status).toBe(403);
  });

  it("存在しない見積は 404", async () => {
    expect((await request("/nope/pdf-source", { headers: { Cookie: await cookieOf("u-viewer") } })).status).toBe(404);
  });

  it("参照の権限があれば、既定のレイアウト用のデータを返す。includeOrderForm=true ならご発注書を付ける", async () => {
    const res = await request("/QT-1/pdf-source", { headers: { Cookie: await cookieOf("u-viewer") } });
    expect(res.status).toBe(200);
    const source = (await res.json()) as ReportPdfSource;
    expect(source).toMatchObject({ documentType: "sales_quote", customLayout: null, appendDocuments: [] });
    expect(source.fallback).toMatchObject({ kind: "document", data: { templateType: "QUOTATION", code: "QT-1", customerName: "取引先1" } });

    const withForm = (await (
      await request("/QT-1/pdf-source?includeOrderForm=true", { headers: { Cookie: await cookieOf("u-viewer") } })
    ).json()) as ReportPdfSource;
    expect(withForm.appendDocuments).toHaveLength(1);
    expect(withForm.appendDocuments![0]).toMatchObject({ templateType: "CUSTOMER_ORDER_FORM", sourceQuoteNumber: "QT-1" });
  });
});

describe("POST /:id/pdf(PERF-07 B-4)", () => {
  it("更新の権限が無ければ 403(参照だけの権限も不可)", async () => {
    const res = await request("/QT-1/pdf", {
      method: "POST",
      headers: { Cookie: await cookieOf("u-viewer") },
      body: pdfForm("%PDF-1.7 test"),
    });
    expect(res.status).toBe(403);
    expect(await storedPdfs("QT-1")).toHaveLength(0);
  });

  it("PDF でない・ファイルが無い・大きすぎる時は 400 で、保存しない", async () => {
    const cookie = await cookieOf("u-sales");
    const notPdf = await request("/QT-1/pdf", { method: "POST", headers: { Cookie: cookie }, body: pdfForm("hello") });
    expect(notPdf.status).toBe(400);
    expect(((await notPdf.json()) as { message: string }).message).toBe("PDF のファイルではありません");

    const noFile = await request("/QT-1/pdf", { method: "POST", headers: { Cookie: cookie }, body: new FormData() });
    expect(noFile.status).toBe(400);

    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(new TextEncoder().encode("%PDF-"));
    const tooBig = await request("/QT-1/pdf", { method: "POST", headers: { Cookie: cookie }, body: pdfForm(big) });
    expect(tooBig.status).toBe(400);
    expect(((await tooBig.json()) as { message: string }).message).toBe("PDF が大きすぎます(5MB まで)");

    expect(await storedPdfs("QT-1")).toHaveLength(0);
  });

  it("存在しない見積は 404", async () => {
    const res = await request("/nope/pdf", {
      method: "POST",
      headers: { Cookie: await cookieOf("u-sales") },
      body: pdfForm("%PDF-1.7 test"),
    });
    expect(res.status).toBe(404);
  });

  // サーバー側でデータを組み立て、R2 のフォントで描いた PDF(以前の generate-pdf と同じ処理。generate-pdf は PERF-07 B-6 で廃止)
  async function serverRenderedPdf(id: string) {
    const app = new Hono<{ Bindings: Env }>();
    let pdf: Uint8Array | null = null;
    app.get("/", async (c) => {
      const built = await new QuotePdfService(new QuoteRepository(c.env.DB)).buildPdfSource(c, id);
      pdf = await renderReportPdf(built!.source, await loadReportAssets(c.env));
      return c.text("ok");
    });
    const ctx = createExecutionContext();
    await app.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    return pdf!;
  }

  it("ブラウザで pdf-source から作って上げた PDF は、サーバーで組み立てて描いた PDF(以前の generate-pdf)と同じものが保存される", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const cookie = await cookieOf("u-sales");
      // サーバーで組み立てて描く(以前の generate-pdf と同じ)
      const serverPdf = await serverRenderedPdf("QT-1");

      // ブラウザの流れ: データを受け取り → 共有パッケージで描く → 上げる
      const source = (await (await request("/QT-1/pdf-source", { headers: { Cookie: cookie } })).json()) as ReportPdfSource;
      const browserPdf = await renderReportPdf(source, { fontBuffer: fontBuffer(), logoBuffer: null, sealBuffer: null });
      const upload = await request("/QT-1/pdf", { method: "POST", headers: { Cookie: cookie }, body: pdfForm(browserPdf) });
      expect(upload.status).toBe(200);
      expect(await upload.json()).toEqual({ success: true, message: "画面編集内容を反映したPDFを見積履歴に生成しました" });

      const [browserStored] = await storedPdfs("QT-1");
      expect(browserStored.byteLength).toBeGreaterThan(1000);
      expect(browserStored).toEqual(serverPdf);
    } finally {
      random.mockRestore();
    }
  });
});
