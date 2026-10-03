import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { inventoryAuditAdapter } from "./inventory-audit.adapter";

/**
 * Item6 Phase6-3: 棚卸の承認確定時にstocks/stock_transactionsへ反映する仕組みの検証。
 * inventory-stock.adapter.test.tsと同型(targetType="inventory_audit")。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.stockAudits);
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
});

describe("applyApproved", () => {
  it("UNAPPROVEDの棚卸を承認確定すると、差異がstocksへ反映されstatusがAPPROVEDになる(理論値0からの新規計上)", async () => {
    const now = new Date();
    await db.insert(schema.stockAudits).values({
      id: "AUDIT1",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      theoreticalQuantity: 0,
      countedQuantity: 5,
      differenceQuantity: 5,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });

    await inventoryAuditAdapter.applyApproved({
      db,
      reqParent: {
        id: "REQ1",
        targetId: "AUDIT1",
        targetType: "inventory_audit",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });

    const audit = await db
      .select()
      .from(schema.stockAudits)
      .where(eq(schema.stockAudits.id, "AUDIT1"));
    expect(audit[0].status).toBe("APPROVED");

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows).toHaveLength(1);
    expect(stockRows[0].quantity).toBe(5);

    const txRows = await db
      .select()
      .from(schema.stockTransactions)
      .where(eq(schema.stockTransactions.refId, "AUDIT1"));
    expect(txRows).toHaveLength(1);
    expect(txRows[0].type).toBe("ADJUSTMENT");
    expect(txRows[0].quantity).toBe(5);
  });

  it("マイナスの差異(実棚が理論値を下回る)を承認確定すると、stocksが減算される", async () => {
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
    await db.insert(schema.stockAudits).values({
      id: "AUDIT2",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      theoreticalQuantity: 10,
      countedQuantity: 7,
      differenceQuantity: -3,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });

    await inventoryAuditAdapter.applyApproved({
      db,
      reqParent: {
        id: "REQ2",
        targetId: "AUDIT2",
        targetType: "inventory_audit",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(7);
  });
});

describe("applyRemanded", () => {
  it("棚卸が差戻された場合、statusをREMANDEDにする(在庫には反映しない)", async () => {
    const now = new Date();
    await db.insert(schema.stockAudits).values({
      id: "AUDIT3",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      theoreticalQuantity: 0,
      countedQuantity: 4,
      differenceQuantity: 4,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });

    await inventoryAuditAdapter.applyRemanded?.({
      db,
      reqParent: {
        id: "REQ3",
        targetId: "AUDIT3",
        targetType: "inventory_audit",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });

    const audit = await db
      .select()
      .from(schema.stockAudits)
      .where(eq(schema.stockAudits.id, "AUDIT3"));
    expect(audit[0].status).toBe("REMANDED");

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows).toHaveLength(0);
  });

  it("action='CANCEL'を指定した場合、statusはREMANDEDではなくCANCELEDになる", async () => {
    const now = new Date();
    await db.insert(schema.stockAudits).values({
      id: "AUDIT4",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      theoreticalQuantity: 0,
      countedQuantity: 4,
      differenceQuantity: 4,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });

    await inventoryAuditAdapter.applyRemanded?.({
      db,
      reqParent: {
        id: "REQ4",
        targetId: "AUDIT4",
        targetType: "inventory_audit",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
      action: "CANCEL",
    });

    const audit = await db
      .select()
      .from(schema.stockAudits)
      .where(eq(schema.stockAudits.id, "AUDIT4"));
    expect(audit[0].status).toBe("CANCELED");
  });
});
