import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { itemReorderSettingsRouter } from "./index";

/**
 * Item9 Phase7: 発注点/安全在庫マスタ(item_reorder_settings)のCRUD・CSV往復・
 * 欠品自動提案②(発注点/安全在庫方式)の検出ロジックのテスト。
 * ワークフロー(承認)対象外の単純な設定マスタのため、admin/tax-categories/index.test.tsと
 * 同じ「実D1 + 実Hono Context、認証Cookie不要」方式を踏襲する。
 */

const db = drizzle(env.DB, { schema });
const now = new Date();

beforeEach(async () => {
  await db.delete(schema.itemReorderSettings);
  await db.delete(schema.stocks);
  await db.delete(schema.warehouseStockReservations);
  await db.delete(schema.items);
  await db.delete(schema.locations);
  await db.delete(schema.warehouses);
  await db.delete(schema.units);
  await db.delete(schema.accounts);
});

async function seedItemAndWarehouse(itemId: string, warehouseId: string) {
  await db.insert(schema.units).values({
    code: "PCS",
    name: "個",
    createdBy: "op-1",
    createdAt: now,
    updatedBy: "op-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.accounts).values({
    code: "ACC1",
    name: "品目",
    createdBy: "op-1",
    createdAt: now,
    updatedBy: "op-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.warehouses).values({
    id: warehouseId,
    name: `倉庫${warehouseId}`,
    createdBy: "op-1",
    createdAt: now,
    updatedBy: "op-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.locations).values({
    id: `LOC-${warehouseId}`,
    warehouseId,
    name: "A-1",
    createdBy: "op-1",
    createdAt: now,
    updatedBy: "op-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.items).values({
    id: itemId,
    name: `品目${itemId}`,
    baseUnitCode: "PCS",
    accountCode: "ACC1",
    createdBy: "op-1",
    createdAt: now,
    updatedBy: "op-1",
    updatedAt: now,
  }).onConflictDoNothing();
}

async function seedStock(itemId: string, warehouseId: string, quantity: number) {
  await db.insert(schema.stocks).values({
    id: `STOCK-${itemId}-${warehouseId}`,
    itemId,
    warehouseId,
    locationId: `LOC-${warehouseId}`,
    lotNumber: "NONE",
    accountCode: "ACC1",
    qualityStatus: "NORMAL",
    quantity,
    updatedAt: now,
  });
}

async function request(path: string, method: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await itemReorderSettingsRouter.request(
    path,
    {
      method,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("発注点/安全在庫マスタ CRUD", () => {
  it("新規登録→一覧取得→更新→削除の一連の操作ができる", async () => {
    await seedItemAndWarehouse("ITEM-1", "WH-1");

    const createRes = await request("/register", "POST", {
      itemId: "ITEM-1",
      warehouseId: "WH-1",
      reorderPoint: 10,
      safetyStock: 20,
      memo: "テスト",
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { id: string };
    expect(created.id).toBeTruthy();

    const listRes = await request("/", "GET");
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{ id: string; itemName: string; warehouseName: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].itemName).toBe("品目ITEM-1");
    expect(list[0].warehouseName).toBe("倉庫WH-1");

    const updateRes = await request(`/${created.id}`, "PUT", {
      itemId: "ITEM-1",
      warehouseId: "WH-1",
      reorderPoint: 15,
      safetyStock: 25,
      memo: "更新後",
    });
    expect(updateRes.status).toBe(200);

    const afterUpdateList = (await (await request("/", "GET")).json()) as Array<{ reorderPoint: number }>;
    expect(afterUpdateList[0].reorderPoint).toBe(15);

    const deleteRes = await request(`/${created.id}`, "DELETE");
    expect(deleteRes.status).toBe(200);
    const afterDeleteList = await (await request("/", "GET")).json();
    expect(afterDeleteList).toEqual([]);
  });

  it("同じ品目×倉庫の組み合わせを重複登録しようとすると400を返す", async () => {
    await seedItemAndWarehouse("ITEM-1", "WH-1");
    await request("/register", "POST", {
      itemId: "ITEM-1",
      warehouseId: "WH-1",
      reorderPoint: 10,
      safetyStock: 20,
    });

    const dupRes = await request("/register", "POST", {
      itemId: "ITEM-1",
      warehouseId: "WH-1",
      reorderPoint: 5,
      safetyStock: 10,
    });
    expect(dupRes.status).toBe(400);
    const body = (await dupRes.json()) as { message: string };
    expect(body.message).toContain("既に登録されています");
  });

  it("存在しないidの削除は404を返す", async () => {
    const res = await request("/NOPE", "DELETE");
    expect(res.status).toBe(404);
  });
});

describe("発注点/安全在庫マスタ CSV往復", () => {
  it("CSVインポート(新規)→エクスポートで登録内容が反映される", async () => {
    await seedItemAndWarehouse("ITEM-1", "WH-1");
    const csv = "itemId,warehouseId,reorderPoint,safetyStock,memo\nITEM-1,WH-1,10,20,CSVメモ\n";

    const formData = new FormData();
    formData.append("file", new File([csv], "settings.csv", { type: "text/csv" }));
    const ctx = createExecutionContext();
    const importRes = await itemReorderSettingsRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(importRes.status).toBe(200);
    const importBody = (await importRes.json()) as { message: string };
    expect(importBody.message).toContain("1件");

    const exportRes = await request("/csv-download", "GET");
    expect(exportRes.status).toBe(200);
    const exportText = await exportRes.text();
    expect(exportText).toContain("ITEM-1");
    expect(exportText).toContain("CSVメモ");
    expect(exportText).toContain("10");
    expect(exportText).toContain("20");
  });

  it("既存の品目×倉庫をCSVインポートすると更新(upsert)される", async () => {
    await seedItemAndWarehouse("ITEM-1", "WH-1");
    await request("/register", "POST", {
      itemId: "ITEM-1",
      warehouseId: "WH-1",
      reorderPoint: 5,
      safetyStock: 5,
    });

    const csv = "itemId,warehouseId,reorderPoint,safetyStock,memo\nITEM-1,WH-1,99,88,更新済み\n";
    const formData = new FormData();
    formData.append("file", new File([csv], "settings.csv", { type: "text/csv" }));
    const ctx = createExecutionContext();
    await itemReorderSettingsRouter.request("/bulk-register", { method: "POST", body: formData }, env, ctx);
    await waitOnExecutionContext(ctx);

    const list = (await (await request("/", "GET")).json()) as Array<{ reorderPoint: number; safetyStock: number }>;
    expect(list).toHaveLength(1);
    expect(list[0].reorderPoint).toBe(99);
    expect(list[0].safetyStock).toBe(88);
  });
});

describe("Item9 Phase7: 欠品自動提案②(発注点/安全在庫方式)の検出ロジック", () => {
  it("利用可能数量が発注点を下回る品目×倉庫のみを候補として返し、安全在庫までの補充数量を提案する", async () => {
    await seedItemAndWarehouse("ITEM-1", "WH-1");
    await seedStock("ITEM-1", "WH-1", 5);
    await request("/register", "POST", {
      itemId: "ITEM-1",
      warehouseId: "WH-1",
      reorderPoint: 10,
      safetyStock: 20,
    });

    const res = await request("/low-stock-candidates", "GET");
    expect(res.status).toBe(200);
    const candidates = (await res.json()) as Array<{
      itemId: string;
      warehouseId: string;
      currentStock: number;
      suggestedQuantity: number;
    }>;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].currentStock).toBe(5);
    expect(candidates[0].suggestedQuantity).toBe(15); // safetyStock(20) - currentStock(5)
  });

  it("利用可能数量が発注点以上の品目×倉庫は候補に含まれない", async () => {
    await seedItemAndWarehouse("ITEM-2", "WH-1");
    await seedStock("ITEM-2", "WH-1", 100);
    await request("/register", "POST", {
      itemId: "ITEM-2",
      warehouseId: "WH-1",
      reorderPoint: 10,
      safetyStock: 20,
    });

    const candidates = (await (await request("/low-stock-candidates", "GET")).json()) as Array<unknown>;
    expect(candidates).toHaveLength(0);
  });

  it("在庫が全く無い(stocks未登録)品目×倉庫も現在庫0として検出される", async () => {
    await seedItemAndWarehouse("ITEM-3", "WH-1");
    await request("/register", "POST", {
      itemId: "ITEM-3",
      warehouseId: "WH-1",
      reorderPoint: 1,
      safetyStock: 10,
    });

    const candidates = (await (await request("/low-stock-candidates", "GET")).json()) as Array<{
      currentStock: number;
      suggestedQuantity: number;
    }>;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].currentStock).toBe(0);
    expect(candidates[0].suggestedQuantity).toBe(10);
  });

  it("複数の品目×倉庫が混在していても、それぞれ独立して判定される", async () => {
    await seedItemAndWarehouse("ITEM-4", "WH-1");
    await seedItemAndWarehouse("ITEM-5", "WH-2");
    await seedStock("ITEM-4", "WH-1", 2);
    await seedStock("ITEM-5", "WH-2", 50);
    await request("/register", "POST", { itemId: "ITEM-4", warehouseId: "WH-1", reorderPoint: 10, safetyStock: 20 });
    await request("/register", "POST", { itemId: "ITEM-5", warehouseId: "WH-2", reorderPoint: 10, safetyStock: 20 });

    const candidates = (await (await request("/low-stock-candidates", "GET")).json()) as Array<{
      itemId: string;
    }>;
    expect(candidates.map((c) => c.itemId)).toEqual(["ITEM-4"]);
  });
});
