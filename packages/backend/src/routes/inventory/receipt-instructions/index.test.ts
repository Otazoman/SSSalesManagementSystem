import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { receiptInstructionsRouter } from "./index";

/**
 * Item6 Phase6-4: 外部倉庫向け入荷指示API。承認機能OFF(COMPANY_SETTINGS未設定時のデフォルト)時の
 * 即時発行パスを中心に検証する(shipment-instructions/index.test.tsと対称)。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.itemReceiptInstructionItems);
  await db.delete(schema.itemReceiptInstructions);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
  await db.delete(schema.warehouses);
  await db.delete(schema.items);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
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
  await db.insert(schema.units).values({
    code: "PCS",
    name: "個",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.accounts).values({
    code: "ACC1",
    name: "品目",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.items).values({
    id: "ITEM1",
    name: "テスト品目",
    baseUnitCode: "PCS",
    accountCode: "ACC1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.warehouses).values({
    id: "WH1",
    name: "本社倉庫",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.warehouses).values({
    id: "WH2",
    name: "外部倉庫",
    warehouseType: "EXTERNAL",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.partners).values({
    id: "PARTNER1",
    name: "テスト仕入先",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
});

async function postInstruction(body: unknown) {
  const ctx = createExecutionContext();
  const res = await receiptInstructionsRouter.request(
    "/register",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const validBody = {
  partnerId: "PARTNER1",
  warehouseId: "WH2",
  instructedReceiveDate: "2026-08-25",
  items: [{ itemId: "ITEM1", instructedQuantity: 10 }],
};

describe("POST / (入荷指示作成)", () => {
  it("承認機能OFF時は即座にAPPROVED(発行済み)として作成される", async () => {
    const res = await postInstruction(validBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; headerId: string };
    expect(body.success).toBe(true);

    const header = await db
      .select()
      .from(schema.itemReceiptInstructions)
      .where(eq(schema.itemReceiptInstructions.id, body.headerId));
    expect(header[0].status).toBe("APPROVED");
    expect(header[0].partnerId).toBe("PARTNER1");
    expect(header[0].warehouseId).toBe("WH2");

    const items = await db
      .select()
      .from(schema.itemReceiptInstructionItems)
      .where(eq(schema.itemReceiptInstructionItems.instructionHeaderId, body.headerId));
    expect(items).toHaveLength(1);
    expect(items[0].instructedQuantity).toBe(10);
  });

  it("自社倉庫(INTERNAL)を指定すると400を返す", async () => {
    const res = await postInstruction({ ...validBody, warehouseId: "WH1" });
    expect(res.status).toBe(400);
  });

  it("存在しない取引先を指定すると404を返す", async () => {
    const res = await postInstruction({ ...validBody, partnerId: "NOPE" });
    expect(res.status).toBe(404);
  });
});

// BUG-071: 発注から作った入荷指示は、発注・発注明細とのつながりを記録する
describe("POST / (発注から作った入荷指示)", () => {
  beforeEach(async () => {
    const now = new Date();
    await db.insert(schema.partners).values({
      id: "PARTNER2",
      name: "別の仕入先",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    for (const [orderId, orderItemId] of [
      ["PO-1", "POI-1"],
      ["PO-2", "POI-2"],
    ]) {
      await db.insert(schema.orders).values({
        id: orderId,
        title: "テスト発注",
        partnerId: "PARTNER1",
        orderDate: now,
        status: "APPROVED",
        totalAmount: 10000,
        taxAmount: 0,
        createdBy: "EMP001",
        createdAt: now,
        updatedBy: "EMP001",
        updatedAt: now,
      });
      await db.insert(schema.orderItems).values({
        id: orderItemId,
        orderId,
        itemId: "ITEM1",
        itemName: "テスト品目",
        inputType: "MASTER",
        quantity: 10,
        unitPrice: 1000,
        sortOrder: 0,
      });
    }
  });

  const fromOrderBody = {
    ...validBody,
    orderId: "PO-1",
    items: [{ itemId: "ITEM1", instructedQuantity: 10, orderItemId: "POI-1" }],
  };

  it("発注・発注明細を記録する", async () => {
    const res = await postInstruction(fromOrderBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { headerId: string };

    const header = await db
      .select()
      .from(schema.itemReceiptInstructions)
      .where(eq(schema.itemReceiptInstructions.id, body.headerId));
    expect(header[0].orderId).toBe("PO-1");
    const items = await db
      .select()
      .from(schema.itemReceiptInstructionItems)
      .where(eq(schema.itemReceiptInstructionItems.instructionHeaderId, body.headerId));
    expect(items[0].orderItemId).toBe("POI-1");
  });

  it("仕入先が発注の仕入先と異なると400を返す", async () => {
    const res = await postInstruction({ ...fromOrderBody, partnerId: "PARTNER2" });
    expect(res.status).toBe(400);
  });

  it("別の発注の明細を指定すると400を返す", async () => {
    const res = await postInstruction({
      ...fromOrderBody,
      items: [{ itemId: "ITEM1", instructedQuantity: 10, orderItemId: "POI-2" }],
    });
    expect(res.status).toBe(400);
  });

  it("発注を指定せずに発注明細を指定すると400を返す", async () => {
    const res = await postInstruction({ ...fromOrderBody, orderId: undefined });
    expect(res.status).toBe(400);
  });

  it("存在しない発注を指定すると404を返す", async () => {
    const res = await postInstruction({ ...fromOrderBody, orderId: "PO-NOPE" });
    expect(res.status).toBe(404);
  });
});

describe("GET /:id (入荷指示詳細)", () => {
  it("ヘッダー+明細を返す", async () => {
    const createRes = await postInstruction(validBody);
    const { headerId } = (await createRes.json()) as { headerId: string };

    const ctx = createExecutionContext();
    const res = await receiptInstructionsRouter.request(`/${headerId}`, {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { header: { id: string }; items: unknown[] };
    expect(body.header.id).toBe(headerId);
    expect(body.items).toHaveLength(1);
  });
});

describe("GET / (入荷指示一覧) / GET /csv-download", () => {
  it("CSVを返す", async () => {
    await postInstruction(validBody);
    const ctx = createExecutionContext();
    const res = await receiptInstructionsRouter.request("/csv-download", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("PARTNER1");
    expect(text).toContain("ITEM1");
  });
});

describe("POST /:id/generate-pdf", () => {
  it("存在しない入荷指示へのPDF生成は404を返す", async () => {
    const ctx = createExecutionContext();
    const res = await receiptInstructionsRouter.request(
      "/NOPE/generate-pdf",
      { method: "POST" },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});

describe("GET /:id/csv (社内向け、1指示分のみのCSVダウンロード)", () => {
  it("対象指示のCSVを返す", async () => {
    const createRes = await postInstruction(validBody);
    const created = (await createRes.json()) as { headerId: string };

    const ctx = createExecutionContext();
    const res = await receiptInstructionsRouter.request(
      `/${created.headerId}/csv`,
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("PARTNER1");
    expect(text).toContain("ITEM1");
  });

  it("存在しない入荷指示は404を返す", async () => {
    const ctx = createExecutionContext();
    const res = await receiptInstructionsRouter.request("/NOPE/csv", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});
