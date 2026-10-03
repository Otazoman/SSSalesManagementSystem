import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { stockReturnsRouter } from "./index";

/**
 * Item6 Phase6-3-3: 返品API。承認機能OFF(COMPANY_SETTINGS未設定時のデフォルト)時の
 * 即時反映パスを中心に、仕入先へ返品(OUTBOUND)/得意先から返品(INBOUND)両方向を検証する。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.stockReturns);
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

async function postReturn(body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockReturnsRouter.request(
    "/register",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("POST / (返品確定)", () => {
  it("伝票番号フォーマット統一化: returnIdはUUIDではなくRT-YYYYMMDD-NNNN形式で採番される", async () => {
    const res = await postReturn({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      direction: "OUTBOUND",
      quantity: 3,
      returnDate: "2026-08-21",
      returnReason: "数量誤発注",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { returnId: string };
    expect(body.returnId).toMatch(/^RT-\d{4}$/);
  });

  it("承認機能OFF時、OUTBOUND(仕入先へ返品)は対象在庫が即座に減算される", async () => {
    const res = await postReturn({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      direction: "OUTBOUND",
      quantity: 3,
      returnDate: "2026-08-21",
      returnReason: "数量誤発注",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      message: string;
      returnId: string;
    };
    expect(body.success).toBe(true);
    expect(body.message).toBe("承認機能が無効のため、返品を確定しました");

    const stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(7);

    const txRows = await db
      .select()
      .from(schema.stockTransactions)
      .where(eq(schema.stockTransactions.refId, body.returnId));
    expect(txRows).toHaveLength(1);
    expect(txRows[0].type).toBe("RETURN");
    expect(txRows[0].quantity).toBe(-3);

    const record = await db
      .select()
      .from(schema.stockReturns)
      .where(eq(schema.stockReturns.id, body.returnId));
    expect(record[0].status).toBe("APPROVED");
    expect(record[0].direction).toBe("OUTBOUND");
    expect(record[0].returnReason).toBe("数量誤発注");
  });

  it("承認機能OFF時、INBOUND(得意先から返品)は在庫が増加する(未登録在庫でも新規登録される)", async () => {
    const res = await postReturn({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "QUARANTINE",
      direction: "INBOUND",
      quantity: 5,
      returnDate: "2026-08-21",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { returnId: string };

    const quarantineStock = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.qualityStatus, "QUARANTINE"));
    expect(quarantineStock).toHaveLength(1);
    expect(quarantineStock[0].quantity).toBe(5);

    const txRows = await db
      .select()
      .from(schema.stockTransactions)
      .where(eq(schema.stockTransactions.refId, body.returnId));
    expect(txRows[0].quantity).toBe(5);
  });

  it("OUTBOUND方向で在庫残数を超える数量指定は409を返し、在庫は変化しない", async () => {
    const res = await postReturn({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      direction: "OUTBOUND",
      quantity: 100,
      returnDate: "2026-08-21",
    });
    expect(res.status).toBe(409);

    const stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(10);
  });

  it("外部倉庫の返品は400を返す", async () => {
    const res = await postReturn({
      itemId: "ITEM1",
      warehouseId: "WH2",
      locationId: "LOC2",
      qualityStatus: "NORMAL",
      direction: "OUTBOUND",
      quantity: 1,
      returnDate: "2026-08-21",
    });
    expect(res.status).toBe(400);
  });
});

describe("GET / (返品履歴一覧) と GET /csv-download", () => {
  it("登録した返品が一覧に現れ、方向で絞り込める", async () => {
    await postReturn({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      direction: "OUTBOUND",
      quantity: 1,
      returnDate: "2026-08-21",
    });
    await postReturn({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      direction: "INBOUND",
      quantity: 2,
      returnDate: "2026-08-21",
    });

    const ctx = createExecutionContext();
    const res = await stockReturnsRouter.request("/?direction=INBOUND", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ direction: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].direction).toBe("INBOUND");
  });

  it("K-2-e: 品目・ロケーション・倉庫で絞り込める", async () => {
    const now = new Date();
    // WH2はEXTERNAL(返品API自体が非対応)のため、倉庫絞り込み検証用に別の自社倉庫を追加
    await db.insert(schema.warehouses).values({
      id: "WH3",
      name: "第二倉庫",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.locations).values({
      id: "LOC3",
      warehouseId: "WH3",
      name: "C-1",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.stocks).values({
      id: "STOCK2",
      itemId: "ITEM1",
      warehouseId: "WH3",
      locationId: "LOC3",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      quantity: 10,
      updatedAt: now,
    });

    await postReturn({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      direction: "OUTBOUND",
      quantity: 1,
      returnDate: "2026-08-21",
    });
    await postReturn({
      itemId: "ITEM1",
      warehouseId: "WH3",
      locationId: "LOC3",
      qualityStatus: "NORMAL",
      direction: "OUTBOUND",
      quantity: 1,
      returnDate: "2026-08-21",
    });

    const ctx = createExecutionContext();
    const res = await stockReturnsRouter.request("/?warehouseId=WH3", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ warehouseId: string; locationId: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].warehouseId).toBe("WH3");
    expect(body.data[0].locationId).toBe("LOC3");
  });

  it("CSVダウンロードがtext/csvで返る", async () => {
    await postReturn({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      direction: "OUTBOUND",
      quantity: 1,
      returnDate: "2026-08-21",
    });

    const ctx = createExecutionContext();
    const res = await stockReturnsRouter.request("/csv-download", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("OUTBOUND");
  });
});

describe("POST /bulk-register (返品CSVインポート)", () => {
  it("1行=1返品として登録し、OUTBOUNDは即座にstocksへ反映する", async () => {
    const csvData =
      "itemId,warehouseId,locationId,direction,quantity,returnDate\n" +
      "ITEM1,WH1,LOC1,OUTBOUND,4,2026-08-21\n";

    const ctx = createExecutionContext();
    const res = await stockReturnsRouter.request(
      "/bulk-register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvData }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);

    const stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(6);
  });

  it("必須列が欠けている場合は400を返す", async () => {
    const csvData = "itemId\nITEM1\n";
    const ctx = createExecutionContext();
    const res = await stockReturnsRouter.request(
      "/bulk-register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvData }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });
});

describe("GET /:id (返品詳細)", () => {
  it("存在しないIDは404を返す", async () => {
    const ctx = createExecutionContext();
    const res = await stockReturnsRouter.request("/NOPE", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});
