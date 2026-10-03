import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { stockAuditsRouter } from "./index";

/**
 * Item6 Phase6-3: 棚卸確定API。承認機能OFF(COMPANY_SETTINGS未設定時のデフォルト)時の
 * 即時在庫反映パスを中心に検証する(receipts/index.test.tsと同型)。
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
});

async function postAudit(body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockAuditsRouter.request(
    "/register",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function putAudit(id: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockAuditsRouter.request(
    `/${id}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("POST / (棚卸確定)", () => {
  it("伝票番号フォーマット統一化: auditIdはUUIDではなくTK-YYYYMMDD-NNNN形式で採番される", async () => {
    const res = await postAudit({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      countedQuantity: 5,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { auditId: string };
    expect(body.auditId).toMatch(/^TK-\d{4}$/);
  });

  it("理論値0(未登録在庫)の棚卸は、承認機能OFF時に即座にstocks/stock_transactionsへ新規計上される", async () => {
    const res = await postAudit({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      countedQuantity: 5,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; message: string; auditId: string };
    expect(body.success).toBe(true);
    expect(body.message).toBe("承認機能が無効のため、棚卸を確定しました");

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows).toHaveLength(1);
    expect(stockRows[0].quantity).toBe(5);

    const txRows = await db
      .select()
      .from(schema.stockTransactions)
      .where(eq(schema.stockTransactions.refId, body.auditId));
    expect(txRows).toHaveLength(1);
    expect(txRows[0].type).toBe("ADJUSTMENT");
    expect(txRows[0].quantity).toBe(5);

    const audit = await db
      .select()
      .from(schema.stockAudits)
      .where(eq(schema.stockAudits.id, body.auditId));
    expect(audit[0].status).toBe("APPROVED");
    expect(audit[0].theoreticalQuantity).toBe(0);
    expect(audit[0].differenceQuantity).toBe(5);
  });

  it("既存在庫がある場合、理論数量を正しく引き当てて差異(マイナス)を反映する", async () => {
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

    const res = await postAudit({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      countedQuantity: 6,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { auditId: string };

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(6);

    const audit = await db
      .select()
      .from(schema.stockAudits)
      .where(eq(schema.stockAudits.id, body.auditId));
    expect(audit[0].theoreticalQuantity).toBe(10);
    expect(audit[0].differenceQuantity).toBe(-4);
  });

  it("差異が0(理論値と一致)の場合もAPPROVEDで記録され、stocksの数量は変化しない", async () => {
    const now = new Date();
    await db.insert(schema.stocks).values({
      id: "STOCK2",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      quantity: 8,
      updatedAt: now,
    });

    const res = await postAudit({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      countedQuantity: 8,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { auditId: string };

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.id, "STOCK2"));
    expect(stockRows[0].quantity).toBe(8);

    const audit = await db
      .select()
      .from(schema.stockAudits)
      .where(eq(schema.stockAudits.id, body.auditId));
    expect(audit[0].differenceQuantity).toBe(0);
    expect(audit[0].status).toBe("APPROVED");
  });

  it("存在しない品目IDは404を返す", async () => {
    const res = await postAudit({
      itemId: "NOPE",
      warehouseId: "WH1",
      locationId: "LOC1",
      countedQuantity: 1,
    });
    expect(res.status).toBe(404);
  });

  it("外部倉庫の棚卸も自社倉庫と同様に確定できる(Item6 Phase6-4-1でEXTERNAL制限を解放)", async () => {
    const res = await postAudit({
      itemId: "ITEM1",
      warehouseId: "WH2",
      locationId: "LOC2",
      countedQuantity: 3,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { auditId: string };

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.locationId, "LOC2"));
    expect(stockRows).toHaveLength(1);
    expect(stockRows[0].quantity).toBe(3);

    const audit = await db
      .select()
      .from(schema.stockAudits)
      .where(eq(schema.stockAudits.id, body.auditId));
    expect(audit[0].warehouseId).toBe("WH2");
    expect(audit[0].status).toBe("APPROVED");
  });
});

describe("GET / (棚卸履歴一覧)", () => {
  it("ページネーション指定時は{data,pagination}形式で返す", async () => {
    await postAudit({ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", countedQuantity: 1 });
    const ctx = createExecutionContext();
    const res = await stockAuditsRouter.request("/?page=1&limit=10", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; pagination: { total: number } };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.pagination.total).toBeGreaterThan(0);
  });

  it("追加要望J-2-j: itemIdで絞り込める(存在しない品目IDは0件)", async () => {
    await postAudit({ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", countedQuantity: 1 });
    const ctx = createExecutionContext();
    const res = await stockAuditsRouter.request("/?itemId=ITEM1", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ itemId: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((a) => a.itemId === "ITEM1")).toBe(true);

    const ctx2 = createExecutionContext();
    const res2 = await stockAuditsRouter.request("/?itemId=NO_SUCH_ITEM", {}, env, ctx2);
    await waitOnExecutionContext(ctx2);
    const body2 = (await res2.json()) as { data: unknown[] };
    expect(body2.data.length).toBe(0);
  });

  it("追加要望J-2-j: locationIdで絞り込める", async () => {
    await postAudit({ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", countedQuantity: 1 });
    await postAudit({ itemId: "ITEM1", warehouseId: "WH2", locationId: "LOC2", countedQuantity: 1 });
    const ctx = createExecutionContext();
    const res = await stockAuditsRouter.request("/?locationId=LOC1", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ locationId: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((a) => a.locationId === "LOC1")).toBe(true);
  });
});

describe("GET /:id (棚卸詳細)", () => {
  it("棚卸レコードを返す", async () => {
    const createRes = await postAudit({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      countedQuantity: 3,
    });
    const { auditId } = (await createRes.json()) as { auditId: string };

    const ctx = createExecutionContext();
    const res = await stockAuditsRouter.request(`/${auditId}`, {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; itemId: string };
    expect(body.id).toBe(auditId);
    expect(body.itemId).toBe("ITEM1");
  });

  it("存在しないIDは404を返す", async () => {
    const ctx = createExecutionContext();
    const res = await stockAuditsRouter.request("/NOPE", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});

describe("GET /csv-download (棚卸履歴CSVダウンロード)", () => {
  it("CSVを返す", async () => {
    await postAudit({ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", countedQuantity: 5 });
    const ctx = createExecutionContext();
    const res = await stockAuditsRouter.request("/csv-download", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("ITEM1");
    expect(text).toContain("differenceQuantity");
  });
});

describe("POST /bulk-register (棚卸CSVインポート)", () => {
  it("1行=1棚卸として登録し、即座にstocksへ反映する", async () => {
    const csvData =
      "itemId,warehouseId,locationId,countedQuantity\n" + "ITEM1,WH1,LOC1,9\n";

    const ctx = createExecutionContext();
    const res = await stockAuditsRouter.request(
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

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows).toHaveLength(1);
    expect(stockRows[0].quantity).toBe(9);
  });

  it("必須列が欠けている場合は400を返す", async () => {
    const csvData = "itemId\nITEM1\n";
    const ctx = createExecutionContext();
    const res = await stockAuditsRouter.request(
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

describe("PUT /:id (修正して再申請)", () => {
  it("差戻し状態の棚卸を修正して再申請すると、同じidのまま内容が書き換わりAPPROVEDになる(承認機能OFF時)", async () => {
    const now = new Date();
    const auditId = "AUDIT-REMANDED";
    // ワークフロー有効時に差戻された(=まだstocksへ未反映の)棚卸を模して直接作成する
    await db.insert(schema.stockAudits).values({
      id: auditId,
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      theoreticalQuantity: 0,
      countedQuantity: 3,
      differenceQuantity: 3,
      status: "REMANDED",
      createdBy: "user-001",
      createdAt: now,
    });

    const res = await putAudit(auditId, {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      countedQuantity: 8,
      memo: "修正後",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; auditId: string };
    expect(body.success).toBe(true);
    expect(body.auditId).toBe(auditId);

    const audit = await db
      .select()
      .from(schema.stockAudits)
      .where(eq(schema.stockAudits.id, auditId));
    expect(audit).toHaveLength(1);
    expect(audit[0].status).toBe("APPROVED");
    expect(audit[0].countedQuantity).toBe(8);
    expect(audit[0].memo).toBe("修正後");

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows).toHaveLength(1);
    expect(stockRows[0].quantity).toBe(8);
  });

  it("差戻し状態以外の棚卸を修正しようとすると400を返す", async () => {
    const createRes = await postAudit({
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      countedQuantity: 3,
    });
    const { auditId } = (await createRes.json()) as { auditId: string };

    const res = await putAudit(auditId, {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      countedQuantity: 8,
    });
    expect(res.status).toBe(400);
  });

  it("存在しないidは404を返す", async () => {
    const res = await putAudit("NOPE", {
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      countedQuantity: 8,
    });
    expect(res.status).toBe(404);
  });
});
