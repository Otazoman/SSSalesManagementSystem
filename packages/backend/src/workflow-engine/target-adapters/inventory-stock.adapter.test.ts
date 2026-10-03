import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { inventoryStockAdapter } from "./inventory-stock.adapter";

/**
 * Item6 Phase6-2: 承認確定時にstocks/stock_transactionsへ反映する仕組みの検証。
 * targetType="inventory_stock"の1つで入庫(item_receipt_headers)/出庫(item_shipment_headers)の
 * 両方を判定・処理できることを確認する(quotes.adapter.ts等と同じapplyApprovedパターン)。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.itemReceiptItems);
  await db.delete(schema.itemReceiptHeaders);
  await db.delete(schema.itemShipmentItems);
  await db.delete(schema.itemShipmentHeaders);
  await db.delete(schema.stockReclassifications);
  await db.delete(schema.stockDisposals);
  await db.delete(schema.stockReturns);
  await db.delete(schema.itemShipmentInstructionItems);
  await db.delete(schema.itemShipmentInstructions);
  await db.delete(schema.itemReceiptInstructionItems);
  await db.delete(schema.itemReceiptInstructions);
  await db.delete(schema.partners);
  await db.delete(schema.locations);
  await db.delete(schema.warehouses);
  await db.delete(schema.items);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
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
  await db.insert(schema.locations).values({
    id: "LOC1",
    warehouseId: "WH1",
    name: "A-1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.partners).values({
    id: "PARTNER1",
    name: "テスト取引先",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
});

describe("applyApproved (入庫)", () => {
  it("UNAPPROVEDの入庫ヘッダーを承認確定すると、stocksへ反映されstatusがAPPROVEDになる", async () => {
    const now = new Date();
    await db.insert(schema.itemReceiptHeaders).values({
      id: "RCPT1",
      receivedDate: now,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });
    await db.insert(schema.itemReceiptItems).values({
      id: "RCPTITEM1",
      receiptHeaderId: "RCPT1",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      receivedQuantity: 7,
      accountCode: "ACC1",
    });

    await inventoryStockAdapter.applyApproved({
      db,
      reqParent: {
        id: "REQ1",
        targetId: "RCPT1",
        targetType: "inventory_stock",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });

    const header = await db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(eq(schema.itemReceiptHeaders.id, "RCPT1"));
    expect(header[0].status).toBe("APPROVED");

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows).toHaveLength(1);
    expect(stockRows[0].quantity).toBe(7);
  });
});

describe("applyApproved (出庫)", () => {
  it("UNAPPROVEDの出庫ヘッダーを承認確定すると、stocksが減算されstatusがAPPROVEDになる", async () => {
    const now = new Date();
    await db.insert(schema.stocks).values({
      id: "STOCK1",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      quantity: 10,
      updatedAt: now,
    });
    await db.insert(schema.itemShipmentHeaders).values({
      id: "SHIP1",
      shippedDate: now,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });
    await db.insert(schema.itemShipmentItems).values({
      id: "SHIPITEM1",
      shipmentHeaderId: "SHIP1",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      qualityStatus: "NORMAL",
      shippedQuantity: 3,
      accountCode: "ACC1",
    });

    await inventoryStockAdapter.applyApproved({
      db,
      reqParent: {
        id: "REQ2",
        targetId: "SHIP1",
        targetType: "inventory_stock",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });

    const header = await db
      .select()
      .from(schema.itemShipmentHeaders)
      .where(eq(schema.itemShipmentHeaders.id, "SHIP1"));
    expect(header[0].status).toBe("APPROVED");

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(7);
  });
});

describe("applyRemanded", () => {
  it("入庫ヘッダーが差戻された場合、statusをREMANDEDにする(在庫には反映しない)", async () => {
    const now = new Date();
    await db.insert(schema.itemReceiptHeaders).values({
      id: "RCPT2",
      receivedDate: now,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });
    await db.insert(schema.itemReceiptItems).values({
      id: "RCPTITEM2",
      receiptHeaderId: "RCPT2",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      receivedQuantity: 4,
      accountCode: "ACC1",
    });

    await inventoryStockAdapter.applyRemanded?.({
      db,
      reqParent: {
        id: "REQ3",
        targetId: "RCPT2",
        targetType: "inventory_stock",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });

    const header = await db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(eq(schema.itemReceiptHeaders.id, "RCPT2"));
    expect(header[0].status).toBe("REMANDED");

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows).toHaveLength(0);
  });

  it("action='CANCEL'を指定した場合、statusはREMANDEDではなくCANCELEDになる(取下げと差戻しの区別)", async () => {
    const now = new Date();
    await db.insert(schema.itemReceiptHeaders).values({
      id: "RCPT3",
      receivedDate: now,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });
    await db.insert(schema.itemReceiptItems).values({
      id: "RCPTITEM3",
      receiptHeaderId: "RCPT3",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      receivedQuantity: 4,
      accountCode: "ACC1",
    });

    await inventoryStockAdapter.applyRemanded?.({
      db,
      reqParent: {
        id: "REQ4",
        targetId: "RCPT3",
        targetType: "inventory_stock",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
      action: "CANCEL",
    });

    const header = await db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(eq(schema.itemReceiptHeaders.id, "RCPT3"));
    expect(header[0].status).toBe("CANCELED");
  });

  it("action未指定の場合は従来通りREMANDEDになる(後方互換)", async () => {
    const now = new Date();
    await db.insert(schema.itemShipmentHeaders).values({
      id: "SHIP2",
      shippedDate: now,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });

    await inventoryStockAdapter.applyRemanded?.({
      db,
      reqParent: {
        id: "REQ5",
        targetId: "SHIP2",
        targetType: "inventory_stock",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });

    const header = await db
      .select()
      .from(schema.itemShipmentHeaders)
      .where(eq(schema.itemShipmentHeaders.id, "SHIP2"));
    expect(header[0].status).toBe("REMANDED");
  });
});

// Item6 Phase6-3-2: 品質区分変更(破損・不良品管理)。receipts/shipmentsに続く3つ目のprobe対象
describe("applyApproved (品質区分変更)", () => {
  it("UNAPPROVEDの品質区分変更を承認確定すると、在庫がfrom→toバケットへ付け替わりstatusがAPPROVEDになる", async () => {
    const now = new Date();
    await db.insert(schema.stocks).values({
      id: "STOCK1",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      quantity: 10,
      updatedAt: now,
    });
    await db.insert(schema.stockReclassifications).values({
      id: "RECLASS1",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      fromQualityStatus: "NORMAL",
      toQualityStatus: "DAMAGED",
      quantity: 4,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });

    await inventoryStockAdapter.applyApproved({
      db,
      reqParent: {
        id: "REQ6",
        targetId: "RECLASS1",
        targetType: "inventory_stock",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });

    const record = await db
      .select()
      .from(schema.stockReclassifications)
      .where(eq(schema.stockReclassifications.id, "RECLASS1"));
    expect(record[0].status).toBe("APPROVED");

    const normalStock = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.id, "STOCK1"));
    expect(normalStock[0].quantity).toBe(6);

    const damagedStock = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.qualityStatus, "DAMAGED"));
    expect(damagedStock[0].quantity).toBe(4);
  });
});

describe("applyRemanded (品質区分変更)", () => {
  it("品質区分変更が差戻された場合、statusをREMANDEDにする(在庫には反映しない)", async () => {
    const now = new Date();
    await db.insert(schema.stockReclassifications).values({
      id: "RECLASS2",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      fromQualityStatus: "NORMAL",
      toQualityStatus: "DAMAGED",
      quantity: 4,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });

    await inventoryStockAdapter.applyRemanded?.({
      db,
      reqParent: {
        id: "REQ7",
        targetId: "RECLASS2",
        targetType: "inventory_stock",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });

    const record = await db
      .select()
      .from(schema.stockReclassifications)
      .where(eq(schema.stockReclassifications.id, "RECLASS2"));
    expect(record[0].status).toBe("REMANDED");
  });
});

// Item6 Phase6-3-3: 廃棄決定。receipts/shipments/reclassificationsに続く4つ目のprobe対象
describe("applyApproved (廃棄)", () => {
  it("UNAPPROVEDの廃棄を承認確定すると、在庫が減算されstatusがAPPROVEDになる", async () => {
    const now = new Date();
    await db.insert(schema.stocks).values({
      id: "STOCK2",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      quantity: 10,
      updatedAt: now,
    });
    await db.insert(schema.stockDisposals).values({
      id: "DISP1",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      quantity: 4,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });

    await inventoryStockAdapter.applyApproved({
      db,
      reqParent: {
        id: "REQ8",
        targetId: "DISP1",
        targetType: "inventory_stock",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });

    const record = await db
      .select()
      .from(schema.stockDisposals)
      .where(eq(schema.stockDisposals.id, "DISP1"));
    expect(record[0].status).toBe("APPROVED");

    const stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK2"));
    expect(stockRows[0].quantity).toBe(6);
  });
});

describe("applyRemanded (廃棄)", () => {
  it("廃棄が差戻された場合、statusをREMANDEDにする(在庫には反映しない)", async () => {
    const now = new Date();
    await db.insert(schema.stockDisposals).values({
      id: "DISP2",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      quantity: 4,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });

    await inventoryStockAdapter.applyRemanded?.({
      db,
      reqParent: {
        id: "REQ9",
        targetId: "DISP2",
        targetType: "inventory_stock",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });

    const record = await db
      .select()
      .from(schema.stockDisposals)
      .where(eq(schema.stockDisposals.id, "DISP2"));
    expect(record[0].status).toBe("REMANDED");
  });
});

// Item6 Phase6-3-3: 返品(仕入先へ返品/得意先から返品)。receipts/shipments/reclassifications/disposalsに
// 続く5つ目のprobe対象
describe("applyApproved (返品)", () => {
  it("UNAPPROVEDのOUTBOUND返品を承認確定すると、在庫が減算されstatusがAPPROVEDになる", async () => {
    const now = new Date();
    await db.insert(schema.stocks).values({
      id: "STOCK3",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      quantity: 10,
      updatedAt: now,
    });
    await db.insert(schema.stockReturns).values({
      id: "RET1",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      direction: "OUTBOUND",
      quantity: 4,
      returnDate: now,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });

    await inventoryStockAdapter.applyApproved({
      db,
      reqParent: {
        id: "REQ10",
        targetId: "RET1",
        targetType: "inventory_stock",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });

    const record = await db.select().from(schema.stockReturns).where(eq(schema.stockReturns.id, "RET1"));
    expect(record[0].status).toBe("APPROVED");

    const stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK3"));
    expect(stockRows[0].quantity).toBe(6);
  });

  it("UNAPPROVEDのINBOUND返品を承認確定すると、在庫が増加しstatusがAPPROVEDになる", async () => {
    const now = new Date();
    await db.insert(schema.stockReturns).values({
      id: "RET2",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      direction: "INBOUND",
      quantity: 5,
      returnDate: now,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });

    await inventoryStockAdapter.applyApproved({
      db,
      reqParent: {
        id: "REQ11",
        targetId: "RET2",
        targetType: "inventory_stock",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });

    const record = await db.select().from(schema.stockReturns).where(eq(schema.stockReturns.id, "RET2"));
    expect(record[0].status).toBe("APPROVED");

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows).toHaveLength(1);
    expect(stockRows[0].quantity).toBe(5);
  });
});

describe("applyRemanded (返品)", () => {
  it("返品が差戻された場合、statusをREMANDEDにする(在庫には反映しない)", async () => {
    const now = new Date();
    await db.insert(schema.stockReturns).values({
      id: "RET3",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      direction: "OUTBOUND",
      quantity: 4,
      returnDate: now,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });

    await inventoryStockAdapter.applyRemanded?.({
      db,
      reqParent: {
        id: "REQ12",
        targetId: "RET3",
        targetType: "inventory_stock",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });

    const record = await db.select().from(schema.stockReturns).where(eq(schema.stockReturns.id, "RET3"));
    expect(record[0].status).toBe("REMANDED");
  });
});

// 画面構成再編フェーズ5: 「修正して再提出」の遷移先パス動的解決の検証
describe("resolveEditPath", () => {
  const now = new Date();

  it("targetType=inventory_stockで入庫ヘッダーが見つかった場合、入荷ページのパスを返す", async () => {
    await db.insert(schema.itemReceiptHeaders).values({
      id: "RCPT-EDIT1",
      receivedDate: now,
      status: "REMANDED",
      createdBy: "EMP001",
      createdAt: now,
    });

    const path = await inventoryStockAdapter.resolveEditPath?.({
      db,
      targetType: "inventory_stock",
      targetId: "RCPT-EDIT1",
    });

    expect(path).toBe("/inventory/receiving");
  });

  it("targetType=inventory_stockで出庫ヘッダーが見つかった場合、出荷ページのパスを返す", async () => {
    await db.insert(schema.itemShipmentHeaders).values({
      id: "SHIP-EDIT1",
      shippedDate: now,
      status: "REMANDED",
      createdBy: "EMP001",
      createdAt: now,
    });

    const path = await inventoryStockAdapter.resolveEditPath?.({
      db,
      targetType: "inventory_stock",
      targetId: "SHIP-EDIT1",
    });

    expect(path).toBe("/inventory/shipping");
  });

  it("targetType=inventory_stockで品質区分変更IDが見つかった場合、在庫・棚卸ページのパスを返す", async () => {
    await db.insert(schema.stockReclassifications).values({
      id: "RECLASS-EDIT1",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      fromQualityStatus: "QUARANTINE",
      toQualityStatus: "NORMAL",
      quantity: 1,
      accountCode: "ACC1",
      status: "REMANDED",
      createdBy: "EMP001",
      createdAt: now,
    });

    const path = await inventoryStockAdapter.resolveEditPath?.({
      db,
      targetType: "inventory_stock",
      targetId: "RECLASS-EDIT1",
    });

    expect(path).toBe("/inventory/audit");
  });

  it("targetType=inventory_stockで廃棄IDが見つかった場合、在庫・棚卸ページのパスを返す", async () => {
    await db.insert(schema.stockDisposals).values({
      id: "DISP-EDIT1",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      quantity: 4,
      status: "REMANDED",
      createdBy: "EMP001",
      createdAt: now,
    });

    const path = await inventoryStockAdapter.resolveEditPath?.({
      db,
      targetType: "inventory_stock",
      targetId: "DISP-EDIT1",
    });

    expect(path).toBe("/inventory/audit");
  });

  it("targetType=inventory_stockで返品IDが見つかった場合、在庫・棚卸ページのパスを返す", async () => {
    await db.insert(schema.stockReturns).values({
      id: "RET-EDIT1",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      direction: "OUTBOUND",
      quantity: 4,
      returnDate: now,
      status: "REMANDED",
      createdBy: "EMP001",
      createdAt: now,
    });

    const path = await inventoryStockAdapter.resolveEditPath?.({
      db,
      targetType: "inventory_stock",
      targetId: "RET-EDIT1",
    });

    expect(path).toBe("/inventory/audit");
  });

  it("targetType=inventory_stockで存在しないIDの場合はnullを返す", async () => {
    const path = await inventoryStockAdapter.resolveEditPath?.({
      db,
      targetType: "inventory_stock",
      targetId: "NOT-EXIST",
    });

    expect(path).toBeNull();
  });

  it("targetType=inventory_instructionsで出荷指示ヘッダーが見つかった場合、出荷ページのパスを返す", async () => {
    await db.insert(schema.itemShipmentInstructions).values({
      id: "SHIPINST-EDIT1",
      partnerId: "PARTNER1",
      warehouseId: "WH1",
      instructedShipDate: now,
      memo: null,
      status: "REMANDED",
      createdBy: "EMP001",
      createdAt: now,
    });

    const path = await inventoryStockAdapter.resolveEditPath?.({
      db,
      targetType: "inventory_instructions",
      targetId: "SHIPINST-EDIT1",
    });

    expect(path).toBe("/inventory/shipping");
  });

  it("targetType=inventory_instructionsで入荷指示ヘッダーが見つかった場合、入荷ページのパスを返す", async () => {
    await db.insert(schema.itemReceiptInstructions).values({
      id: "RCPTINST-EDIT1",
      partnerId: "PARTNER1",
      warehouseId: "WH1",
      instructedReceiveDate: now,
      memo: null,
      status: "REMANDED",
      createdBy: "EMP001",
      createdAt: now,
    });

    const path = await inventoryStockAdapter.resolveEditPath?.({
      db,
      targetType: "inventory_instructions",
      targetId: "RCPTINST-EDIT1",
    });

    expect(path).toBe("/inventory/receiving");
  });

  it("targetType=inventory_instructionsで存在しないIDの場合はnullを返す", async () => {
    const path = await inventoryStockAdapter.resolveEditPath?.({
      db,
      targetType: "inventory_instructions",
      targetId: "NOT-EXIST",
    });

    expect(path).toBeNull();
  });
});
