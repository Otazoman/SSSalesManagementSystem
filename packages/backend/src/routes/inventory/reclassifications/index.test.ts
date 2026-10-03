import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { stockReclassificationsRouter } from "./index";

/**
 * Item6 Phase6-3-2: 品質区分変更(破損・不良品管理)API。承認機能OFF(COMPANY_SETTINGS未設定時の
 * デフォルト)時の即時反映パスを中心に検証する(audits/index.test.tsと同型)。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.stockReclassifications);
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
    id: "LOC1",
    warehouseId: "WH1",
    name: "A-1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.locations).values({
    id: "LOC2",
    warehouseId: "WH2",
    name: "B-1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
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
});

async function postReclassification(body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockReclassificationsRouter.request(
    "/register",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("POST / (品質区分変更確定)", () => {
  it("承認機能OFF時、良品→破損品への変更が即座にstocks/stock_transactionsへ反映される", async () => {
    const res = await postReclassification({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      fromQualityStatus: "NORMAL",
      toQualityStatus: "DAMAGED",
      quantity: 3,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      message: string;
      reclassificationId: string;
    };
    expect(body.success).toBe(true);
    expect(body.message).toBe("承認機能が無効のため、品質区分変更を確定しました");

    const normalStock = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.id, "STOCK1"));
    expect(normalStock[0].quantity).toBe(7);

    const damagedStock = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.qualityStatus, "DAMAGED"));
    expect(damagedStock).toHaveLength(1);
    expect(damagedStock[0].quantity).toBe(3);

    const txRows = await db
      .select()
      .from(schema.stockTransactions)
      .where(eq(schema.stockTransactions.refId, body.reclassificationId));
    expect(txRows).toHaveLength(2);
    expect(txRows.every((t: any) => t.type === "DAMAGE")).toBe(true);
    const normalTx = txRows.find((t: any) => t.qualityStatus === "NORMAL");
    const damagedTx = txRows.find((t: any) => t.qualityStatus === "DAMAGED");
    expect(normalTx?.quantity).toBe(-3);
    expect(damagedTx?.quantity).toBe(3);

    const record = await db
      .select()
      .from(schema.stockReclassifications)
      .where(eq(schema.stockReclassifications.id, body.reclassificationId));
    expect(record[0].status).toBe("APPROVED");
  });

  it("破損品→良品への変更(逆方向)も同様に反映される", async () => {
    const now = new Date();
    await db.insert(schema.stocks).values({
      id: "STOCK2",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "DAMAGED",
      quantity: 5,
      updatedAt: now,
    });

    const res = await postReclassification({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      fromQualityStatus: "DAMAGED",
      toQualityStatus: "NORMAL",
      quantity: 2,
    });
    expect(res.status).toBe(200);

    const damagedStock = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.id, "STOCK2"));
    expect(damagedStock[0].quantity).toBe(3);

    const normalStock = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.id, "STOCK1"));
    expect(normalStock[0].quantity).toBe(12);
  });

  it("変更元と変更先が同じ品質区分の場合は400を返す", async () => {
    const res = await postReclassification({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      fromQualityStatus: "NORMAL",
      toQualityStatus: "NORMAL",
      quantity: 1,
    });
    expect(res.status).toBe(400);
  });

  it("変更元の在庫残数を超える数量指定は409を返し、在庫は変化しない", async () => {
    const res = await postReclassification({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      fromQualityStatus: "NORMAL",
      toQualityStatus: "DAMAGED",
      quantity: 100,
    });
    expect(res.status).toBe(409);

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(10);
  });

  it("変更元の在庫が存在しない場合は409を返す", async () => {
    const res = await postReclassification({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      fromQualityStatus: "QUARANTINE",
      toQualityStatus: "DAMAGED",
      quantity: 1,
    });
    expect(res.status).toBe(409);
  });

  it("外部倉庫の品質区分変更は400を返す", async () => {
    const res = await postReclassification({
      itemId: "ITEM1",
      warehouseId: "WH2",
      locationId: "LOC2",
      fromQualityStatus: "NORMAL",
      toQualityStatus: "DAMAGED",
      quantity: 1,
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /:id (品質区分変更詳細)", () => {
  it("品質区分変更レコードを返す", async () => {
    const createRes = await postReclassification({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      fromQualityStatus: "NORMAL",
      toQualityStatus: "DAMAGED",
      quantity: 1,
    });
    const { reclassificationId } = (await createRes.json()) as { reclassificationId: string };

    const ctx = createExecutionContext();
    const res = await stockReclassificationsRouter.request(`/${reclassificationId}`, {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; toQualityStatus: string };
    expect(body.id).toBe(reclassificationId);
    expect(body.toQualityStatus).toBe("DAMAGED");
  });

  it("存在しないIDは404を返す", async () => {
    const ctx = createExecutionContext();
    const res = await stockReclassificationsRouter.request("/NOPE", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});
