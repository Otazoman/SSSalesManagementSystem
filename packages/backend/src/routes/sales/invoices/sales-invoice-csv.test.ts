import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

describe("SalesInvoiceCsvService: BUG-050 受注の得意先との一致", () => {
  beforeEach(async () => {
    await db.insert(schema.partners).values({
      id: "P-2",
      name: "取引先2",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.salesOrders).values({
      id: "SO-CSV-1",
      partnerId: "P-1",
      orderDate: now,
      status: "APPROVED",
      totalAmount: 1100,
      taxAmount: 100,
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.salesOrderItems).values({
      id: "SO-CSV-1-ITEM-1",
      salesOrderId: "SO-CSV-1",
      itemId: "ITEM-1",
      itemName: "品目A",
      quantity: 1,
      unitPrice: 1000,
      amount: 1000,
      taxCategoryCode: "TAX_10",
      sortOrder: 0,
    });
  });

  afterEach(async () => {
    await db.delete(schema.salesInvoiceItems);
    await db.delete(schema.salesInvoices);
    await db.delete(schema.salesOrderItems);
    await db.delete(schema.salesOrders);
  });

  const header =
    "id,partnerId,salesOrderId,invoiceDate,status,documentType,totalAmount,taxAmount,itemId,itemName,sourceOrderItemId,quantity,unitPrice,taxCategoryCode";
  const importCsv = (rows: string[]) =>
    withContext((c) => {
      const service = new SalesInvoiceCsvService(new SalesInvoiceRepository(c.env.DB));
      return service.bulkImportCsv(c, new File([[header, ...rows].join("\n")], "import.csv", { type: "text/csv" }));
    });

  it("受注の得意先と異なる取引先の行があるとエラーになり、1件も取り込まれない", async () => {
    const rows = [
      "SI-OK,P-1,SO-CSV-1,2026-10-01,DRAFT,SALE,1100,100,ITEM-1,品目A,SO-CSV-1-ITEM-1,1,1000,TAX_10",
      "SI-NG,P-2,SO-CSV-1,2026-10-01,DRAFT,SALE,1100,100,ITEM-1,品目A,SO-CSV-1-ITEM-1,1,1000,TAX_10",
    ];
    await expect(importCsv(rows)).rejects.toThrow(/得意先/);
    expect(await db.select().from(schema.salesInvoices)).toHaveLength(0);
  });

  it("受注番号が空でも、明細の受注明細が別の得意先のものならエラーになる", async () => {
    const rows = ["SI-NG,P-2,,2026-10-01,DRAFT,SALE,1100,100,ITEM-1,品目A,SO-CSV-1-ITEM-1,1,1000,TAX_10"];
    await expect(importCsv(rows)).rejects.toThrow(/得意先/);
  });

  it("受注の得意先と同じ取引先なら取り込める", async () => {
    const rows = ["SI-OK,P-1,SO-CSV-1,2026-10-01,DRAFT,SALE,1100,100,ITEM-1,品目A,SO-CSV-1-ITEM-1,1,1000,TAX_10"];
    const result = await importCsv(rows);
    expect(result.success).toBe(true);
    expect(await db.select().from(schema.salesInvoices)).toHaveLength(1);
  });
});
