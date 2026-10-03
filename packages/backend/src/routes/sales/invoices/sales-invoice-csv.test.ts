import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import type { Env } from "../../../types/env";
import { SalesInvoiceRepository } from "./sales-invoice.repository";
import { SalesInvoiceCsvService } from "./sales-invoice-csv.service";

const db = drizzle(env.DB, { schema });
const now = new Date();

function buildTestApp() {
  return new Hono<{ Bindings: Env }>();
}

async function withContext<T>(fn: (c: any) => Promise<T>): Promise<T> {
  const app = buildTestApp();
  let result!: T;
  app.get("/run", async (c) => {
    result = await fn(c);
    return c.json({});
  });
  const ctx = createExecutionContext();
  await app.request("/run", {}, env, ctx);
  await waitOnExecutionContext(ctx);
  return result;
}

beforeEach(async () => {
  await db.delete(schema.salesInvoiceItems);
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
});

describe("SalesInvoiceCsvService: エクスポート・インポートの往復", () => {
  it("エクスポートしたCSVを再インポートすると同じ内容が復元される", async () => {
    await db.insert(schema.salesInvoices).values({
      id: "SI-CSV-1",
      partnerId: "P-1",
      invoiceDate: now,
      status: "APPROVED",
      documentType: "SALE",
      totalAmount: 11000,
      taxAmount: 1000,
      billingStatus: "UNBILLED",
      salesPersonEmployeeNumber: "EMP001",
      inputPersonEmployeeNumber: "EMP001",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.salesInvoiceItems).values({
      id: "SI-CSV-1-ITEM-1",
      salesInvoiceId: "SI-CSV-1",
      itemId: "ITEM-1",
      itemName: "品目A",
      quantity: 1,
      unitPrice: 10000,
      amount: 10000,
      sortOrder: 0,
    });

    const csvText = await withContext((c) => {
      const service = new SalesInvoiceCsvService(new SalesInvoiceRepository(c.env.DB));
      return service.exportCsv(c);
    });
    expect(csvText).toContain("SI-CSV-1");
    expect(csvText).toContain("品目A");

    // 一度全削除してから再インポートし、完全に復元されることを確認する
    await db.delete(schema.salesInvoiceItems);
    await db.delete(schema.salesInvoices);

    const file = new File([csvText], "export.csv", { type: "text/csv" });
    const importResult = await withContext((c) => {
      const service = new SalesInvoiceCsvService(new SalesInvoiceRepository(c.env.DB));
      return service.bulkImportCsv(c, file);
    });
    expect(importResult.success).toBe(true);

    const invoices = await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, "SI-CSV-1"));
    expect(invoices).toHaveLength(1);
    expect(invoices[0].totalAmount).toBe(11000);
    expect(invoices[0].documentType).toBe("SALE");

    const items = await db
      .select()
      .from(schema.salesInvoiceItems)
      .where(eq(schema.salesInvoiceItems.salesInvoiceId, "SI-CSV-1"));
    expect(items).toHaveLength(1);
    expect(items[0].itemName).toBe("品目A");
    expect(items[0].quantity).toBe(1);
    expect(items[0].unitPrice).toBe(10000);
  });
});
