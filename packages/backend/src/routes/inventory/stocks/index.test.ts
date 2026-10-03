import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { stocksRouter } from "./index";

/**
 * 数量0の在庫行(品質区分変更・出庫等で払い出された残骸)は一覧に出す意味がないため、
 * GET /api/stocksの結果から常に除外されることを確認する。行自体はDBに残るため、
 * 再入庫時はincreaseQuantity()が同じ行を見つけて更新するだけで問題ない(削除ではなくフィルタ)。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.stocks);
  await db.delete(schema.locations);
  await db.delete(schema.warehouses);
  await db.delete(schema.items);
  await db.delete(schema.accounts);
  await db.delete(schema.units);

  const now = new Date();
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

describe("GET / (在庫現在高一覧)", () => {
  it("数量0の在庫行は結果から除外される", async () => {
    const now = new Date();
    await db.insert(schema.stocks).values([
      {
        id: "STOCK-ZERO",
        itemId: "ITEM1",
        warehouseId: "WH1",
        locationId: "LOC1",
        lotNumber: "NONE",
        accountCode: "ACC1",
        qualityStatus: "NORMAL",
        quantity: 0,
        updatedAt: now,
      },
      {
        id: "STOCK-NONZERO",
        itemId: "ITEM1",
        warehouseId: "WH1",
        locationId: "LOC1",
        lotNumber: "NONE",
        accountCode: "ACC1",
        qualityStatus: "DAMAGED",
        quantity: 3,
        updatedAt: now,
      },
    ]);

    const res = await stocksRouter.request("/", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((s) => s.id)).toEqual(["STOCK-NONZERO"]);
  });

  it("ページネーション指定時のcountも数量0の行を除外して算出される", async () => {
    const now = new Date();
    await db.insert(schema.stocks).values([
      {
        id: "STOCK-ZERO",
        itemId: "ITEM1",
        warehouseId: "WH1",
        locationId: "LOC1",
        lotNumber: "NONE",
        accountCode: "ACC1",
        qualityStatus: "NORMAL",
        quantity: 0,
        updatedAt: now,
      },
      {
        id: "STOCK-NONZERO",
        itemId: "ITEM1",
        warehouseId: "WH1",
        locationId: "LOC1",
        lotNumber: "NONE",
        accountCode: "ACC1",
        qualityStatus: "DAMAGED",
        quantity: 3,
        updatedAt: now,
      },
    ]);

    const res = await stocksRouter.request("/?page=1&limit=10", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      pagination: { total: number };
    };
    expect(body.data.map((s) => s.id)).toEqual(["STOCK-NONZERO"]);
    expect(body.pagination.total).toBe(1);
  });
});
