import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { StockRepository } from "./stocks.repository";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";

const db = drizzle(env.DB, { schema });
const now = new Date();
const audit = { createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now };

async function seedStock(id: string, itemId: string, quantity: number) {
  await db.insert(schema.units).values({ code: "PCS", name: "個", ...audit }).onConflictDoNothing();
  await db.insert(schema.accounts).values({ code: "ACC-S", name: "商品", ...audit }).onConflictDoNothing();
  await db.insert(schema.warehouses).values({ id: "WH-S", name: "倉庫", ...audit }).onConflictDoNothing();
  await db.insert(schema.locations).values({ id: "LOC-S", warehouseId: "WH-S", name: "A-1", ...audit }).onConflictDoNothing();
  await db.insert(schema.items).values({ id: itemId, name: itemId, baseUnitCode: "PCS", accountCode: "ACC-S", ...audit }).onConflictDoNothing();
  await db.insert(schema.stocks).values({
    id,
    itemId,
    warehouseId: "WH-S",
    locationId: "LOC-S",
    lotNumber: "NONE",
    accountCode: "ACC-S",
    qualityStatus: "NORMAL",
    quantity,
    updatedAt: now,
  });
}

const quantityOf = async (id: string) => (await db.select().from(schema.stocks).where(eq(schema.stocks.id, id)))[0].quantity;

describe("StockRepository.decreaseQuantityOrFail(BUG-049)", () => {
  beforeEach(async () => {
    await db.delete(schema.stockTransactions);
    await db.delete(schema.stocks);
  });

  it("足りる場合は減算する", async () => {
    await seedStock("S-1", "ITEM-S1", 10);
    await new StockRepository(env.DB).decreaseQuantityOrFail("S-1", 4, now);
    expect(await quantityOf("S-1")).toBe(6);
  });

  it("足りない場合はエラーになり、数量は変わらない", async () => {
    await seedStock("S-1", "ITEM-S1", 1);
    await expect(new StockRepository(env.DB).decreaseQuantityOrFail("S-1", 3, now)).rejects.toThrow();
    expect(await quantityOf("S-1")).toBe(1);
  });

  it("batch の中で足りない場合は、同じ batch の他の減算も取り消される", async () => {
    await seedStock("S-1", "ITEM-S1", 10);
    await seedStock("S-2", "ITEM-S2", 1);
    const tx = recordWritesForBatch(new StockRepository(env.DB));
    await tx.repo.decreaseQuantityOrFail("S-1", 5, now);
    await tx.repo.decreaseQuantityOrFail("S-2", 3, now);
    await expect(tx.commit()).rejects.toThrow();
    expect(await quantityOf("S-1")).toBe(10);
    expect(await quantityOf("S-2")).toBe(1);
  });
});

describe("StocksService.applyShipmentItems(BUG-049)", () => {
  beforeEach(async () => {
    await db.delete(schema.stockTransactions);
    await db.delete(schema.stocks);
  });

  const line = (itemId: string, shippedQuantity: number) => ({
    itemId,
    warehouseId: "WH-S",
    locationId: "LOC-S",
    lotNumber: "NONE",
    accountCode: "ACC-S",
    qualityStatus: "NORMAL",
    shippedQuantity,
  });

  it("2行目の在庫が足りない場合は、1行目の在庫も減らさず、取引の記録も残さない", async () => {
    const { StocksService } = await import("./stocks.service");
    await seedStock("S-1", "ITEM-S1", 10);
    await seedStock("S-2", "ITEM-S2", 1);
    await expect(
      StocksService.fromDb(db).applyShipmentItems([line("ITEM-S1", 5), line("ITEM-S2", 3)], "SH-1", "EMP001", now),
    ).rejects.toThrow("出庫数量が在庫残数を超えています");
    expect(await quantityOf("S-1")).toBe(10);
    expect(await quantityOf("S-2")).toBe(1);
    expect(await db.select().from(schema.stockTransactions)).toHaveLength(0);
  });

  it("同じ在庫を複数の明細で使う場合は、合計で足りるかを確かめる", async () => {
    const { StocksService } = await import("./stocks.service");
    await seedStock("S-1", "ITEM-S1", 5);
    await expect(
      StocksService.fromDb(db).applyShipmentItems([line("ITEM-S1", 3), line("ITEM-S1", 3)], "SH-1", "EMP001", now),
    ).rejects.toThrow("出庫数量が在庫残数を超えています");
    expect(await quantityOf("S-1")).toBe(5);
  });

  it("足りる場合は、全ての明細の在庫を減らして取引を記録する", async () => {
    const { StocksService } = await import("./stocks.service");
    await seedStock("S-1", "ITEM-S1", 10);
    await seedStock("S-2", "ITEM-S2", 4);
    await StocksService.fromDb(db).applyShipmentItems([line("ITEM-S1", 5), line("ITEM-S2", 3)], "SH-1", "EMP001", now);
    expect(await quantityOf("S-1")).toBe(5);
    expect(await quantityOf("S-2")).toBe(1);
    expect(await db.select().from(schema.stockTransactions)).toHaveLength(2);
  });
});
