import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { receiptInstructionsRouter } from "./index";
import { stockReceiptsRouter } from "../receipts/index";

/**
 * Item6 Phase6-4: 入荷指示⇔入荷実績の消込(reconciliation)を検証する統合テスト。
 * shipment-instructions/reconciliation.test.tsと対称。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.itemReceiptItems);
  await db.delete(schema.itemReceiptHeaders);
  await db.delete(schema.itemReceiptInstructionItems);
  await db.delete(schema.itemReceiptInstructions);
  await db.delete(schema.locations);
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
    id: "WH2",
    name: "外部倉庫",
    warehouseType: "EXTERNAL",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.locations).values({
    id: "LOC2",
    warehouseId: "WH2",
    name: "外部倉庫代表ロケーション",
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

async function postReceipt(body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockReceiptsRouter.request(
    "/register",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("入荷指示⇔入荷実績の消込", () => {
  it("一部数量のみ実績登録すると指示がPARTIALLY_FULFILLEDになり、残数を登録するとFULFILLEDになる", async () => {
    const instructionRes = await postInstruction({
      partnerId: "PARTNER1",
      warehouseId: "WH2",
      instructedReceiveDate: "2026-08-25",
      items: [{ itemId: "ITEM1", instructedQuantity: 10 }],
    });
    const { headerId: instructionId } = (await instructionRes.json()) as { headerId: string };

    const firstReceiptRes = await postReceipt({
      receivedDate: "2026-08-25",
      items: [{ itemId: "ITEM1", warehouseId: "WH2", locationId: "LOC2", quantity: 4 }],
      receiptInstructionId: instructionId,
    });
    expect(firstReceiptRes.status).toBe(200);

    let instruction = await db
      .select()
      .from(schema.itemReceiptInstructions)
      .where(eq(schema.itemReceiptInstructions.id, instructionId));
    expect(instruction[0].status).toBe("PARTIALLY_FULFILLED");

    const secondReceiptRes = await postReceipt({
      receivedDate: "2026-08-25",
      items: [{ itemId: "ITEM1", warehouseId: "WH2", locationId: "LOC2", quantity: 6 }],
      receiptInstructionId: instructionId,
    });
    expect(secondReceiptRes.status).toBe(200);
    const secondBody = (await secondReceiptRes.json()) as { headerId: string };

    instruction = await db
      .select()
      .from(schema.itemReceiptInstructions)
      .where(eq(schema.itemReceiptInstructions.id, instructionId));
    expect(instruction[0].status).toBe("FULFILLED");

    const secondHeader = await db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(eq(schema.itemReceiptHeaders.id, secondBody.headerId));
    expect(secondHeader[0].receiptInstructionId).toBe(instructionId);
    expect(secondHeader[0].partnerId).toBe("PARTNER1"); // 指示側からの自動コピー

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.locationId, "LOC2"));
    expect(stockRows[0].quantity).toBe(10);
  });

  it("発行済みでない入荷指示IDを指定すると400を返す", async () => {
    const now = new Date();
    await db.insert(schema.itemReceiptInstructions).values({
      id: "INSTR-UNAPPROVED",
      partnerId: "PARTNER1",
      warehouseId: "WH2",
      instructedReceiveDate: now,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });

    const res = await postReceipt({
      receivedDate: "2026-08-25",
      items: [{ itemId: "ITEM1", warehouseId: "WH2", locationId: "LOC2", quantity: 1 }],
      receiptInstructionId: "INSTR-UNAPPROVED",
    });
    expect(res.status).toBe(400);
  });
});
