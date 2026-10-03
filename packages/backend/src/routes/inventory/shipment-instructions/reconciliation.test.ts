import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { shipmentInstructionsRouter } from "./index";
import { stockShipmentsRouter } from "../shipments/index";

/**
 * Item6 Phase6-4: 出荷指示⇔出荷実績の消込(reconciliation)を検証する統合テスト。
 * 承認機能OFF(COMPANY_SETTINGS未設定時のデフォルト)時、出荷実績が即座に承認確定される
 * パスを経由して指示側のfulfillmentステータスが更新されることを確認する。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.itemShipmentItems);
  await db.delete(schema.itemShipmentHeaders);
  await db.delete(schema.itemShipmentInstructionItems);
  await db.delete(schema.itemShipmentInstructions);
  // Item7残課題6: 受注明細への消込連携テスト用の後始末(partners/itemsを消す前に削除する必要がある)
  await db.delete(schema.salesOrderItemReservations);
  await db.delete(schema.warehouseStockReservations);
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
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
    name: "テスト得意先",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.stocks).values({
    id: "STOCK1",
    itemId: "ITEM1",
    warehouseId: "WH2",
    locationId: "LOC2",
    lotNumber: "NONE",
    accountCode: "ACC1",
    qualityStatus: "NORMAL",
    quantity: 10,
    updatedAt: now,
  });
});

async function postInstruction(body: unknown) {
  const ctx = createExecutionContext();
  const res = await shipmentInstructionsRouter.request(
    "/register",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function postShipment(body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockShipmentsRouter.request(
    "/register",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("出荷指示⇔出荷実績の消込", () => {
  it("一部数量のみ実績登録すると指示がPARTIALLY_FULFILLEDになり、残数を登録するとFULFILLEDになる", async () => {
    const instructionRes = await postInstruction({
      partnerId: "PARTNER1",
      warehouseId: "WH2",
      instructedShipDate: "2026-08-25",
      items: [{ itemId: "ITEM1", instructedQuantity: 10 }],
    });
    const { headerId: instructionId } = (await instructionRes.json()) as { headerId: string };

    const firstShipmentRes = await postShipment({
      shippedDate: "2026-08-25",
      items: [{ locationId: "LOC2", itemId: "ITEM1", quantity: 4 }],
      shipmentInstructionId: instructionId,
    });
    expect(firstShipmentRes.status).toBe(200);

    let instruction = await db
      .select()
      .from(schema.itemShipmentInstructions)
      .where(eq(schema.itemShipmentInstructions.id, instructionId));
    expect(instruction[0].status).toBe("PARTIALLY_FULFILLED");

    const secondShipmentRes = await postShipment({
      shippedDate: "2026-08-25",
      items: [{ locationId: "LOC2", itemId: "ITEM1", quantity: 6 }],
      shipmentInstructionId: instructionId,
    });
    expect(secondShipmentRes.status).toBe(200);
    const secondBody = (await secondShipmentRes.json()) as { headerId: string };

    instruction = await db
      .select()
      .from(schema.itemShipmentInstructions)
      .where(eq(schema.itemShipmentInstructions.id, instructionId));
    expect(instruction[0].status).toBe("FULFILLED");

    const secondHeader = await db
      .select()
      .from(schema.itemShipmentHeaders)
      .where(eq(schema.itemShipmentHeaders.id, secondBody.headerId));
    expect(secondHeader[0].shipmentInstructionId).toBe(instructionId);
    expect(secondHeader[0].partnerId).toBe("PARTNER1"); // 指示側からの自動コピー
  });

  it("発行済みでない出荷指示IDを指定すると400を返す", async () => {
    // UNAPPROVED状態のダミー指示を直接DBへ作る(承認機能OFFのため通常APIからは作れない)
    const now = new Date();
    await db.insert(schema.itemShipmentInstructions).values({
      id: "INSTR-UNAPPROVED",
      partnerId: "PARTNER1",
      warehouseId: "WH2",
      instructedShipDate: now,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });

    const res = await postShipment({
      shippedDate: "2026-08-25",
      items: [{ locationId: "LOC2", itemId: "ITEM1", quantity: 1 }],
      shipmentInstructionId: "INSTR-UNAPPROVED",
    });
    expect(res.status).toBe(400);
  });

  it("存在しない出荷指示IDを指定すると404を返す", async () => {
    const res = await postShipment({
      shippedDate: "2026-08-25",
      items: [{ locationId: "LOC2", itemId: "ITEM1", quantity: 1 }],
      shipmentInstructionId: "NOPE",
    });
    expect(res.status).toBe(404);
  });
});

describe("Item7残課題6: 受注明細への消込連携(出荷指示、単独作成には影響しないこと)", () => {
  async function seedSalesOrder(quantity: number) {
    const now = new Date();
    await db.insert(schema.salesOrders).values({
      id: "SO-1",
      partnerId: "PARTNER1",
      orderDate: now,
      status: "APPROVED",
      totalAmount: 0,
      taxAmount: 0,
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.salesOrderItems).values({
      id: "SOI-1",
      salesOrderId: "SO-1",
      itemId: "ITEM1",
      inputType: "MASTER",
      quantity,
      unitPrice: 100,
      amount: 100 * quantity,
      sortOrder: 0,
    });
  }

  it("従来通り単独作成(受注に紐付けない)の出荷指示は影響を受けず、salesOrderIdはnullのまま", async () => {
    const res = await postInstruction({
      partnerId: "PARTNER1",
      warehouseId: "WH2",
      instructedShipDate: "2026-08-25",
      items: [{ itemId: "ITEM1", instructedQuantity: 5 }],
    });
    expect(res.status).toBe(200);
    const { headerId } = (await res.json()) as { headerId: string };

    const header = await db
      .select()
      .from(schema.itemShipmentInstructions)
      .where(eq(schema.itemShipmentInstructions.id, headerId));
    expect(header[0].salesOrderId).toBeNull();
  });

  it("BUG-065: サービス品目(役務)の受注明細を指定した出荷指示は400でブロックされる", async () => {
    await seedSalesOrder(5);
    const now = new Date();
    await db.insert(schema.items).values({
      id: "ITEM-SVC",
      name: "設置作業",
      baseUnitCode: "PCS",
      accountCode: "ACC1",
      isService: true,
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.salesOrderItems).values({
      id: "SOI-SVC",
      salesOrderId: "SO-1",
      itemId: "ITEM-SVC",
      inputType: "MASTER",
      quantity: 1,
      unitPrice: 100,
      amount: 100,
      sortOrder: 1,
    });

    const res = await postInstruction({
      partnerId: "PARTNER1",
      warehouseId: "WH2",
      instructedShipDate: "2026-08-25",
      items: [{ itemId: "ITEM-SVC", instructedQuantity: 1, salesOrderItemId: "SOI-SVC" }],
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("サービス");
  });

  it("受注明細の残数量を超える指示数量を指定すると400でブロックされる", async () => {
    await seedSalesOrder(5);

    const res = await postInstruction({
      partnerId: "PARTNER1",
      warehouseId: "WH2",
      instructedShipDate: "2026-08-25",
      items: [{ itemId: "ITEM1", instructedQuantity: 6, salesOrderItemId: "SOI-1" }],
    });
    expect(res.status).toBe(400);
  });

  it("残数量内であれば作成でき、ヘッダーのsalesOrderIdに紐づく受注が記録される(指示発行だけでは在庫は動かない)", async () => {
    await seedSalesOrder(5);

    const res = await postInstruction({
      partnerId: "PARTNER1",
      warehouseId: "WH2",
      instructedShipDate: "2026-08-25",
      items: [{ itemId: "ITEM1", instructedQuantity: 3, salesOrderItemId: "SOI-1" }],
    });
    expect(res.status).toBe(200);
    const { headerId } = (await res.json()) as { headerId: string };

    const header = await db
      .select()
      .from(schema.itemShipmentInstructions)
      .where(eq(schema.itemShipmentInstructions.id, headerId));
    expect(header[0].salesOrderId).toBe("SO-1");

    const items = await db
      .select()
      .from(schema.itemShipmentInstructionItems)
      .where(eq(schema.itemShipmentInstructionItems.instructionHeaderId, headerId));
    expect(items[0].salesOrderItemId).toBe("SOI-1");

    // 指示の発行だけでは在庫は動かないため、受注のshipment_statusは未出荷のまま
    const order = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, "SO-1"));
    expect(order[0].shipmentStatus).toBe("NOT_SHIPPED");
  });

  it("指示に紐づく出荷実績が確定すると、受注明細のshipment_statusが更新される(指示→実績の一連の流れ)", async () => {
    await seedSalesOrder(10);

    const instructionRes = await postInstruction({
      partnerId: "PARTNER1",
      warehouseId: "WH2",
      instructedShipDate: "2026-08-25",
      items: [{ itemId: "ITEM1", instructedQuantity: 10, salesOrderItemId: "SOI-1" }],
    });
    const { headerId: instructionId } = (await instructionRes.json()) as { headerId: string };

    const shipmentRes = await postShipment({
      shippedDate: "2026-08-25",
      items: [{ locationId: "LOC2", itemId: "ITEM1", quantity: 10, salesOrderItemId: "SOI-1" }],
      shipmentInstructionId: instructionId,
    });
    expect(shipmentRes.status).toBe(200);

    const order = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, "SO-1"));
    expect(order[0].shipmentStatus).toBe("SHIPPED");
  });
});
