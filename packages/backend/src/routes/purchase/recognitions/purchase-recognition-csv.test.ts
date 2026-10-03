import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import type { Env } from "../../../types/env";
import { PurchaseRecognitionRepository } from "./purchase-recognition.repository";
import { PurchaseRecognitionCsvService } from "./purchase-recognition-csv.service";

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
  await db.delete(schema.purchaseRecognitionItems);
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
    name: "仕入先1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
});

describe("PurchaseRecognitionCsvService: エクスポート・インポートの往復", () => {
  it("エクスポートしたCSVを再インポートすると同じ内容が復元される", async () => {
    await db.insert(schema.purchaseRecognitions).values({
      id: "SR-CSV-1",
      partnerId: "P-1",
      recognitionDate: now,
      status: "APPROVED",
      documentType: "PURCHASE",
      totalAmount: 11000,
      taxAmount: 1000,
      paymentStatus: "UNPAID",
      purchasePersonEmployeeNumber: "EMP001",
      inputPersonEmployeeNumber: "EMP001",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.purchaseRecognitionItems).values({
      id: "SR-CSV-1-ITEM-1",
      purchaseRecognitionId: "SR-CSV-1",
      itemId: "ITEM-1",
      itemName: "品目A",
      quantity: 1,
      unitPrice: 10000,
      amount: 10000,
      sortOrder: 0,
    });

    const csvText = await withContext((c) => {
      const service = new PurchaseRecognitionCsvService(new PurchaseRecognitionRepository(c.env.DB));
      return service.exportCsv(c);
    });
    expect(csvText).toContain("SR-CSV-1");
    expect(csvText).toContain("品目A");

    // 一度全削除してから再インポートし、完全に復元されることを確認する
    await db.delete(schema.purchaseRecognitionItems);
    await db.delete(schema.purchaseRecognitions);

    const file = new File([csvText], "export.csv", { type: "text/csv" });
    const importResult = await withContext((c) => {
      const service = new PurchaseRecognitionCsvService(new PurchaseRecognitionRepository(c.env.DB));
      return service.bulkImportCsv(c, file);
    });
    expect(importResult.success).toBe(true);

    const recognitions = await db
      .select()
      .from(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.id, "SR-CSV-1"));
    expect(recognitions).toHaveLength(1);
    expect(recognitions[0].totalAmount).toBe(11000);
    expect(recognitions[0].documentType).toBe("PURCHASE");

    const items = await db
      .select()
      .from(schema.purchaseRecognitionItems)
      .where(eq(schema.purchaseRecognitionItems.purchaseRecognitionId, "SR-CSV-1"));
    expect(items).toHaveLength(1);
    expect(items[0].itemName).toBe("品目A");
    expect(items[0].quantity).toBe(1);
    expect(items[0].unitPrice).toBe(10000);
  });
});
