import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import type { Env } from "../../../types/env";
import { BillingRepository } from "./billing.repository";
import { BillingPdfService } from "./billing-pdf.service";

const db = drizzle(env.DB, { schema });
const now = new Date();

function buildTestApp() {
  return new Hono<{ Bindings: Env }>();
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

beforeEach(async () => {
  await db.delete(schema.billingItems);
  await db.delete(schema.billingHeaders);
  await db.delete(schema.salesInvoices);
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
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.salesInvoices).values({
    id: "SI-1",
    partnerId: "P-1",
    invoiceDate: now,
    status: "APPROVED",
    documentType: "SALE",
    totalAmount: 11000,
    taxAmount: 1000,
    billingStatus: "BILLED",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.billingHeaders).values({
    id: "BL-1",
    partnerId: "P-1",
    billingDate: now,
    mode: "PER_TRANSACTION",
    status: "DRAFT",
    totalAmount: 11000,
    taxAmount: 1000,
    reconciledAmount: 0,
    reconciliationStatus: "UNRECONCILED",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.billingItems).values({
    id: "BL-1-ITEM-1",
    billingHeaderId: "BL-1",
    salesInvoiceId: "SI-1",
    amount: 10000,
    taxAmount: 1000,
    sortOrder: 0,
  });
});

// 追加要望(2026-09-16ユーザー確認済み): 以前はPER_TRANSACTIONの場合、対象sales_invoice自体の
// PDF(sales-invoice-pdf.service.ts、現在は"SALES_RECOGNITION"レイアウト)をそのまま
// billing側へ流用していたため、請求管理から発行したはずのPDFが「売上計上書」になってしまう
// 不具合があった。現在はPER_TRANSACTION/PERIODICとも常に自前で"INVOICE"レイアウトのPDFを
// 生成する(buildAndSaveInvoicePdf)ため、この回帰を防ぐテストに置き換える
describe("BillingPdfService.generatePdf", () => {
  it("PER_TRANSACTIONモードでも(売上自体のPDFを流用せず)自前でPDF生成を試みる(フォント未セット環境のためエラーになるが、これは自前生成パスに到達した証拠)", async () => {
    await expect(
      withContext((c) => {
        const service = new BillingPdfService(new BillingRepository(c.env.DB));
        return service.generatePdf(c, "BL-1");
      }),
    ).rejects.toThrow("日本語フォントファイルがR2に見つかりません");
  });

  it("対象の請求が存在しない場合はnullを返す", async () => {
    const result = await withContext((c) => {
      const service = new BillingPdfService(new BillingRepository(c.env.DB));
      return service.generatePdf(c, "NOPE");
    });
    expect(result).toBeNull();
  });

  it("請求に紐づく明細が無い場合はエラーになる", async () => {
    await db.delete(schema.billingItems);
    await expect(
      withContext((c) => {
        const service = new BillingPdfService(new BillingRepository(c.env.DB));
        return service.generatePdf(c, "BL-1");
      }),
    ).rejects.toThrow("請求に紐づく売上明細がありません");
  });
});
