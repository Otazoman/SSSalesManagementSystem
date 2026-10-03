import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { stockDisposalsRouter } from "./index";

/**
 * Item6 Phase6-3-3: 廃棄決定API。承認機能OFF(COMPANY_SETTINGS未設定時のデフォルト)時の
 * 即時反映パスを中心に検証する(reclassifications/index.test.tsと同型)。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.stockDisposals);
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

async function postDisposal(body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockDisposalsRouter.request(
    "/register",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("POST / (廃棄確定)", () => {
  it("承認機能OFF時、対象在庫が即座に減算される", async () => {
    const res = await postDisposal({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      quantity: 3,
      memo: "期限切れ",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      message: string;
      disposalId: string;
    };
    expect(body.success).toBe(true);
    expect(body.message).toBe("承認機能が無効のため、廃棄を確定しました");

    const stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(7);

    const txRows = await db
      .select()
      .from(schema.stockTransactions)
      .where(eq(schema.stockTransactions.refId, body.disposalId));
    expect(txRows).toHaveLength(1);
    expect(txRows[0].type).toBe("DISPOSAL");
    expect(txRows[0].quantity).toBe(-3);

    const record = await db
      .select()
      .from(schema.stockDisposals)
      .where(eq(schema.stockDisposals.id, body.disposalId));
    expect(record[0].status).toBe("APPROVED");
    expect(record[0].memo).toBe("期限切れ");
  });

  it("在庫残数を超える数量指定は409を返し、在庫は変化しない", async () => {
    const res = await postDisposal({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      quantity: 100,
    });
    expect(res.status).toBe(409);

    const stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(10);
  });

  it("対象在庫が存在しない場合は409を返す", async () => {
    const res = await postDisposal({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "DAMAGED",
      quantity: 1,
    });
    expect(res.status).toBe(409);
  });

  it("外部倉庫の廃棄は400を返す", async () => {
    const res = await postDisposal({
      itemId: "ITEM1",
      warehouseId: "WH2",
      locationId: "LOC2",
      qualityStatus: "NORMAL",
      quantity: 1,
    });
    expect(res.status).toBe(400);
  });
});

describe("GET / (廃棄履歴一覧) と GET /csv-download", () => {
  it("登録した廃棄が一覧に現れる", async () => {
    await postDisposal({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      quantity: 1,
    });

    const ctx = createExecutionContext();
    const res = await stockDisposalsRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ itemId: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].itemId).toBe("ITEM1");
  });

  it("K-2-f: 品目・ロケーション・倉庫で絞り込める", async () => {
    const now = new Date();
    // WH2はEXTERNAL(廃棄API自体が非対応)のため、倉庫絞り込み検証用に別の自社倉庫を追加
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

    await postDisposal({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      quantity: 1,
    });
    await postDisposal({
      itemId: "ITEM1",
      warehouseId: "WH3",
      locationId: "LOC3",
      qualityStatus: "NORMAL",
      quantity: 1,
    });

    const ctx = createExecutionContext();
    const res = await stockDisposalsRouter.request("/?warehouseId=WH3", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body2 = (await res.json()) as { data: Array<{ warehouseId: string; locationId: string }> };
    expect(body2.data).toHaveLength(1);
    expect(body2.data[0].warehouseId).toBe("WH3");
    expect(body2.data[0].locationId).toBe("LOC3");
  });

  it("CSVダウンロードがtext/csvで返る", async () => {
    await postDisposal({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      quantity: 1,
    });

    const ctx = createExecutionContext();
    const res = await stockDisposalsRouter.request("/csv-download", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("ITEM1");
  });
});

describe("POST /bulk-register (廃棄CSVインポート)", () => {
  it("1行=1廃棄として登録し、即座にstocksへ反映する", async () => {
    const csvData = "itemId,warehouseId,locationId,quantity\n" + "ITEM1,WH1,LOC1,4\n";

    const ctx = createExecutionContext();
    const res = await stockDisposalsRouter.request(
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
    const res = await stockDisposalsRouter.request(
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

describe("GET /:id (廃棄詳細)", () => {
  it("廃棄レコードを返す", async () => {
    const createRes = await postDisposal({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      qualityStatus: "NORMAL",
      quantity: 1,
    });
    const { disposalId } = (await createRes.json()) as { disposalId: string };

    const ctx = createExecutionContext();
    const res = await stockDisposalsRouter.request(`/${disposalId}`, {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; quantity: number };
    expect(body.id).toBe(disposalId);
    expect(body.quantity).toBe(1);
  });

  it("存在しないIDは404を返す", async () => {
    const ctx = createExecutionContext();
    const res = await stockDisposalsRouter.request("/NOPE", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});
