import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { ProductsRepository } from "./products.repository";

// BUG-048: 品目の登録・削除は、品目と標準単価を1回の batch で書き込む
const db = drizzle(env.DB, { schema });
const now = new Date();
const repo = new ProductsRepository(env.DB);

beforeEach(async () => {
  await db.delete(schema.stocks);
  await db.delete(schema.itemPrices);
  await db.delete(schema.itemStructures);
  await db.delete(schema.itemAttachments);
  await db.delete(schema.items);
  await db.delete(schema.units);
  await db.insert(schema.units).values({ code: "pcs", name: "個", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now });
});

async function register(id: string) {
  await repo.createProduct(
    { id, name: `品目${id}`, baseUnitCode: "pcs", standardSalesPrice: 1000, standardPurchasePrice: 600 } as any,
    "EMP001",
    now,
  );
}

const pricesOf = (id: string) => db.select().from(schema.itemPrices).where(eq(schema.itemPrices.itemId, id));

describe("ProductsRepository(BUG-048)", () => {
  it("登録: 品目と標準単価(販売・仕入)をまとめて登録する", async () => {
    await register("ITEM-A");
    expect((await pricesOf("ITEM-A")).map((p) => p.priceType).sort()).toEqual(["PURCHASE", "SALES"]);
  });

  it("削除: 他のデータ(品目構成)で使われている品目は削除に失敗し、標準単価も消えずに残る", async () => {
    await register("ITEM-A");
    await register("ITEM-B");
    await db.insert(schema.itemStructures).values({
      id: "ST-1",
      parentItemId: "ITEM-A",
      childItemId: "ITEM-B",
      validFrom: now,
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    } as any);

    await expect(repo.deleteProduct("ITEM-B", env.SYSTEM_BUCKET)).rejects.toThrow();
    expect(await db.select().from(schema.items).where(eq(schema.items.id, "ITEM-B"))).toHaveLength(1);
    expect(await pricesOf("ITEM-B")).toHaveLength(2);
  });

  it("削除: 使われていない品目は、標準単価ごと削除する", async () => {
    await register("ITEM-A");
    expect(await repo.deleteProduct("ITEM-A", env.SYSTEM_BUCKET)).toBe(1);
    expect(await pricesOf("ITEM-A")).toHaveLength(0);
  });
});
