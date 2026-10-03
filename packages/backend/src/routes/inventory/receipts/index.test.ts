import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { stockReceiptsRouter } from "./index";

/**
 * Item6 Phase6-2: 自社倉庫の入庫確定API。承認機能OFF(COMPANY_SETTINGS未設定時のデフォルト)時の
 * 即時在庫反映パスを中心に検証する。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.itemReceiptItems);
  await db.delete(schema.itemReceiptHeaders);
  await db.delete(schema.locations);
  await db.delete(schema.warehouses);
  await db.delete(schema.items);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
  await db.delete(schema.partners);
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
  await db.insert(schema.partners).values({
    id: "PARTNER1",
    name: "テスト仕入先",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
});

async function postReceipt(body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockReceiptsRouter.request(
    "/register",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function putReceipt(id: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockReceiptsRouter.request(
    `/${id}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("POST / (入庫確定)", () => {
  it("検品結果DAMAGEDを指定すると、qualityStatus=DAMAGEDで計上される(Item6 Phase6-3-2)", async () => {
    const res = await postReceipt({
      receivedDate: "2026-08-20",
      items: [
        {
          itemId: "ITEM1",
          warehouseId: "WH1",
          locationId: "LOC1",
          quantity: 5,
          inspectionStatus: "DAMAGED",
          inspectionMemo: "外装に凹みあり",
        },
      ],
    });
    expect(res.status).toBe(200);

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows).toHaveLength(1);
    expect(stockRows[0].qualityStatus).toBe("DAMAGED");
    expect(stockRows[0].quantity).toBe(5);

    const itemRows = await db
      .select()
      .from(schema.itemReceiptItems)
      .where(eq(schema.itemReceiptItems.itemId, "ITEM1"));
    expect(itemRows[0].inspectionStatus).toBe("DAMAGED");
    expect(itemRows[0].inspectionMemo).toBe("外装に凹みあり");
  });

  it("承認機能OFF時は即座にstocks/stock_transactionsへ反映される", async () => {
    const res = await postReceipt({
      receivedDate: "2026-08-20",
      items: [
        { itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 10 },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; message: string; headerId: string };
    expect(body.success).toBe(true);
    expect(body.message).toBe("承認機能が無効のため、入庫を確定しました");

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows).toHaveLength(1);
    expect(stockRows[0].quantity).toBe(10);
    expect(stockRows[0].qualityStatus).toBe("NORMAL");
    expect(stockRows[0].accountCode).toBe("ACC1");

    const txRows = await db
      .select()
      .from(schema.stockTransactions)
      .where(eq(schema.stockTransactions.refId, body.headerId));
    expect(txRows).toHaveLength(1);
    expect(txRows[0].type).toBe("RECEIPT");
    expect(txRows[0].quantity).toBe(10);

    const header = await db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(eq(schema.itemReceiptHeaders.id, body.headerId));
    expect(header[0].status).toBe("APPROVED");
  });

  it("同一ロケーション×品目への再入庫は数量を加算する", async () => {
    await postReceipt({
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 10 }],
    });
    await postReceipt({
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 5 }],
    });

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows).toHaveLength(1);
    expect(stockRows[0].quantity).toBe(15);
  });

  it("存在しない品目IDは404を返す", async () => {
    const res = await postReceipt({
      receivedDate: "2026-08-20",
      items: [{ itemId: "NOPE", warehouseId: "WH1", locationId: "LOC1", quantity: 1 }],
    });
    expect(res.status).toBe(404);
  });

  it("外部倉庫への入庫も自社倉庫と同様に確定できる(Item6 Phase6-4-2でEXTERNAL制限を解放)", async () => {
    const res = await postReceipt({
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH2", locationId: "LOC2", quantity: 4 }],
    });
    expect(res.status).toBe(200);

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.locationId, "LOC2"));
    expect(stockRows).toHaveLength(1);
    expect(stockRows[0].quantity).toBe(4);
  });

  it("1件の入庫内で自社倉庫(WH1)と外部倉庫(WH2)の明細が混在する場合は400を返す", async () => {
    const res = await postReceipt({
      receivedDate: "2026-08-20",
      items: [
        { itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 1 },
        { itemId: "ITEM1", warehouseId: "WH2", locationId: "LOC2", quantity: 1 },
      ],
    });
    expect(res.status).toBe(400);
  });

  it("partnerIdを指定すると入庫ヘッダーに仕入先として記録される(Item6 Phase6-4-3)", async () => {
    const res = await postReceipt({
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 1 }],
      partnerId: "PARTNER1",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { headerId: string };

    const header = await db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(eq(schema.itemReceiptHeaders.id, body.headerId));
    expect(header[0].partnerId).toBe("PARTNER1");
  });

  it("存在しないpartnerIdを指定すると404を返す", async () => {
    const res = await postReceipt({
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 1 }],
      partnerId: "NOPE-PARTNER",
    });
    expect(res.status).toBe(404);
  });

  // 新規要望(2026-09-23): 倉庫間移動。仕入先の代わりに移動元倉庫を選べる
  describe("倉庫間移動(sourceWarehouseId)", () => {
    it("sourceWarehouseIdを指定すると入庫ヘッダーに移動元倉庫として記録される", async () => {
      const res = await postReceipt({
        receivedDate: "2026-08-20",
        items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 1 }],
        sourceWarehouseId: "WH2",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { headerId: string };

      const header = await db
        .select()
        .from(schema.itemReceiptHeaders)
        .where(eq(schema.itemReceiptHeaders.id, body.headerId));
      expect(header[0].sourceWarehouseId).toBe("WH2");
      expect(header[0].partnerId).toBeNull();
    });

    it("存在しないsourceWarehouseIdを指定すると404を返す", async () => {
      const res = await postReceipt({
        receivedDate: "2026-08-20",
        items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 1 }],
        sourceWarehouseId: "NOPE-WH",
      });
      expect(res.status).toBe(404);
    });

    it("partnerIdとsourceWarehouseIdを同時に指定すると400を返す", async () => {
      const res = await postReceipt({
        receivedDate: "2026-08-20",
        items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 1 }],
        partnerId: "PARTNER1",
        sourceWarehouseId: "WH2",
      });
      expect(res.status).toBe(400);
    });

    it("移動元倉庫が入庫先倉庫と同じ場合は400を返す", async () => {
      const res = await postReceipt({
        receivedDate: "2026-08-20",
        items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 1 }],
        sourceWarehouseId: "WH1",
      });
      expect(res.status).toBe(400);
    });
  });
});

describe("GET / (入庫履歴一覧)", () => {
  it("ページネーション指定時は{data,pagination}形式で返す", async () => {
    await postReceipt({
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 1 }],
    });
    const res = await stockReceiptsRouter.request("/?page=1&limit=10", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; pagination: { total: number } };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.pagination.total).toBeGreaterThan(0);
  });
});

describe("GET /:id (入庫詳細)", () => {
  it("ヘッダーと明細を返す", async () => {
    const createRes = await postReceipt({
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 3 }],
    });
    const { headerId } = (await createRes.json()) as { headerId: string };

    const res = await stockReceiptsRouter.request(`/${headerId}`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { header: { id: string }; items: Array<{ itemId: string }> };
    expect(body.header.id).toBe(headerId);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].itemId).toBe("ITEM1");
  });

  it("存在しないIDは404を返す", async () => {
    const res = await stockReceiptsRouter.request("/NOPE", {}, env);
    expect(res.status).toBe(404);
  });
});

describe("GET /csv-download (入庫履歴CSVダウンロード)", () => {
  it("CSVを返す", async () => {
    await postReceipt({
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 5 }],
    });
    const res = await stockReceiptsRouter.request("/csv-download", {}, env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("ITEM1");
    expect(text).toContain("headerId");
  });
});

describe("POST /bulk-register (入庫CSVインポート)", () => {
  it("1ファイル=1入庫として登録し、即座にstocksへ反映する", async () => {
    const csvData =
      "receivedDate,supplierInvoiceNumber,memo,itemId,warehouseId,locationId,lotNumber,quantity\n" +
      "2026-08-20,,CSV取込,ITEM1,WH1,LOC1,LOT-A,6\n" +
      "2026-08-20,,CSV取込,ITEM1,WH1,LOC1,LOT-A,4\n";

    const ctx = createExecutionContext();
    const res = await stockReceiptsRouter.request(
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
    expect(stockRows[0].quantity).toBe(10);
  });

  it("必須列が欠けている場合は400を返す", async () => {
    const csvData = "receivedDate,itemId\n2026-08-20,ITEM1\n";
    const ctx = createExecutionContext();
    const res = await stockReceiptsRouter.request(
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

describe("GET / (日付・作成者での絞り込み)", () => {
  it("dateFrom/dateToの範囲外は除外される", async () => {
    await postReceipt({
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 1 }],
    });
    const resIn = await stockReceiptsRouter.request(
      "/?startDate=2026-08-19&endDate=2026-08-21&page=1&limit=10",
      {},
      env,
    );
    const bodyIn = (await resIn.json()) as { pagination: { total: number } };
    expect(bodyIn.pagination.total).toBeGreaterThan(0);

    const resOut = await stockReceiptsRouter.request(
      "/?startDate=2026-09-01&endDate=2026-09-30&page=1&limit=10",
      {},
      env,
    );
    const bodyOut = (await resOut.json()) as { pagination: { total: number } };
    expect(bodyOut.pagination.total).toBe(0);
  });

  it("createdByで絞り込める", async () => {
    await postReceipt({
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 1 }],
    });
    // テスト実行時はセッションが無いため、resolveOperatorEmployeeNumber()はgetFallbackOperatorId()
    // 経由でusers.id("user-001")を返す(セッションありの本番経路ではemployeeNumberが入る)
    const res = await stockReceiptsRouter.request(
      "/?createdBy=user-001&page=1&limit=10",
      {},
      env,
    );
    const body = (await res.json()) as { pagination: { total: number } };
    expect(body.pagination.total).toBeGreaterThan(0);

    const resMiss = await stockReceiptsRouter.request(
      "/?createdBy=NOBODY&page=1&limit=10",
      {},
      env,
    );
    const bodyMiss = (await resMiss.json()) as { pagination: { total: number } };
    expect(bodyMiss.pagination.total).toBe(0);
  });

  it("warehouseId/locationId(明細側)で絞り込める", async () => {
    await postReceipt({
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 1 }],
    });

    const resHit = await stockReceiptsRouter.request(
      "/?warehouseId=WH1&locationId=LOC1&page=1&limit=10",
      {},
      env,
    );
    const bodyHit = (await resHit.json()) as { pagination: { total: number } };
    expect(bodyHit.pagination.total).toBeGreaterThan(0);

    const resMiss = await stockReceiptsRouter.request(
      "/?warehouseId=WH2&page=1&limit=10",
      {},
      env,
    );
    const bodyMiss = (await resMiss.json()) as { pagination: { total: number } };
    expect(bodyMiss.pagination.total).toBe(0);
  });

  it("partnerId(ヘッダー側)で絞り込める", async () => {
    await postReceipt({
      receivedDate: "2026-08-20",
      partnerId: "PARTNER1",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 1 }],
    });

    const resHit = await stockReceiptsRouter.request(
      "/?partnerId=PARTNER1&page=1&limit=10",
      {},
      env,
    );
    const bodyHit = (await resHit.json()) as { pagination: { total: number } };
    expect(bodyHit.pagination.total).toBeGreaterThan(0);

    const resMiss = await stockReceiptsRouter.request(
      "/?partnerId=NOBODY&page=1&limit=10",
      {},
      env,
    );
    const bodyMiss = (await resMiss.json()) as { pagination: { total: number } };
    expect(bodyMiss.pagination.total).toBe(0);
  });
});

describe("PUT /:id (修正して再申請)", () => {
  it("差戻し状態の入庫を修正して再申請すると、同じheaderIdのまま内容が書き換わりAPPROVEDになる(承認機能OFF時)", async () => {
    const now = new Date();
    const headerId = "RCPT-REMANDED";
    // ワークフロー有効時に差戻された(=まだstocksへ未反映の)入庫を模して直接ヘッダー/明細を作成する
    await db.insert(schema.itemReceiptHeaders).values({
      id: headerId,
      receivedDate: now,
      status: "REMANDED",
      createdBy: "user-001",
      createdAt: now,
    });
    await db.insert(schema.itemReceiptItems).values({
      id: "RCPTITEM-REMANDED",
      receiptHeaderId: headerId,
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      receivedQuantity: 3,
      accountCode: "ACC1",
    });

    const res = await putReceipt(headerId, {
      receivedDate: "2026-08-21",
      memo: "修正後",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 8 }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; headerId: string };
    expect(body.success).toBe(true);
    expect(body.headerId).toBe(headerId);

    const header = await db
      .select()
      .from(schema.itemReceiptHeaders)
      .where(eq(schema.itemReceiptHeaders.id, headerId));
    expect(header).toHaveLength(1);
    expect(header[0].status).toBe("APPROVED");
    expect(header[0].memo).toBe("修正後");

    const items = await db
      .select()
      .from(schema.itemReceiptItems)
      .where(eq(schema.itemReceiptItems.receiptHeaderId, headerId));
    expect(items).toHaveLength(1);
    expect(items[0].receivedQuantity).toBe(8);

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows).toHaveLength(1);
    expect(stockRows[0].quantity).toBe(8);
  });

  it("差戻し状態以外の入庫を修正しようとすると400を返す", async () => {
    const createRes = await postReceipt({
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 3 }],
    });
    const { headerId } = (await createRes.json()) as { headerId: string };

    const res = await putReceipt(headerId, {
      receivedDate: "2026-08-21",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 8 }],
    });
    expect(res.status).toBe(400);
  });

  it("存在しないheaderIdは404を返す", async () => {
    const res = await putReceipt("NOPE", {
      receivedDate: "2026-08-21",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 8 }],
    });
    expect(res.status).toBe(404);
  });
});

describe("CSVダウンロード→再インポートの往復", () => {
  it("エクスポートしたCSVをそのまま再インポートすると同じ件数の入庫が復元される", async () => {
    await postReceipt({
      receivedDate: "2026-08-20",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 3 }],
    });
    await postReceipt({
      receivedDate: "2026-08-21",
      items: [{ itemId: "ITEM1", warehouseId: "WH1", locationId: "LOC1", quantity: 5 }],
    });

    const csvRes = await stockReceiptsRouter.request("/csv-download", {}, env);
    const csvText = await csvRes.text();

    const importCtx = createExecutionContext();
    const importRes = await stockReceiptsRouter.request(
      "/bulk-register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvData: csvText }),
      },
      env,
      importCtx,
    );
    await waitOnExecutionContext(importCtx);
    expect(importRes.status).toBe(200);
    const body = (await importRes.json()) as { message: string };
    expect(body.message).toBe("CSVから 2 件の入庫を登録しました");

    // 元の2件 + 再インポートされた2件 = stocksの合計数量は (3+5)*2 = 16 になる
    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.itemId, "ITEM1"));
    expect(stockRows[0].quantity).toBe(16);
  });
});
