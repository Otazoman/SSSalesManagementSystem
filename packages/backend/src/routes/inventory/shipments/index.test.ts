import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";
import { stockShipmentsRouter } from "./index";

vi.mock("../../../workflow-engine/notifier", () => ({
  sendWorkflowMail: vi.fn(async () => {}),
  notifyApprovalRequestSubmitted: vi.fn(async () => {}),
}));

/**
 * Item6 Phase6-2: 自社倉庫の出庫確定API。承認機能OFF時の即時在庫反映パスと、
 * ロケーション指定のみからの品目自動特定・在庫不足時のエラーを検証する。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  // Item7残課題6で追加したワークフローONテストがCOMPANY_SETTINGS KVを書き換えるため、
  // 他のテスト(承認機能OFF前提)に影響しないよう毎回リセットする
  await env.COMPANY_SETTINGS.put("config", JSON.stringify({}));
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.itemShipmentItems);
  await db.delete(schema.itemShipmentHeaders);
  // Item7残課題6: 受注明細への消込連携テスト用の後始末(partners/itemsを消す前に削除する必要がある)
  await db.delete(schema.salesOrderItemReservations);
  await db.delete(schema.warehouseStockReservations);
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  // Item7残課題6: 承認機能ON時のワークフロー確定テスト用の後始末
  await db.delete(schema.workflowLogs);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.userRoles);
  await db.delete(schema.departments);
  await db.delete(schema.roles);
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
    id: "LOC-EMPTY",
    warehouseId: "WH1",
    name: "A-2",
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
  await db.insert(schema.partners).values({
    id: "PARTNER1",
    name: "テスト得意先",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
});

async function postShipment(body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockShipmentsRouter.request(
    "/register",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function putShipment(id: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await stockShipmentsRouter.request(
    `/${id}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("POST / (出庫確定)", () => {
  it("承認機能OFF時はロケーション指定のみから品目を自動特定し即座に在庫を減算する", async () => {
    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 4 }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; message: string; headerId: string };
    expect(body.success).toBe(true);
    expect(body.message).toBe("承認機能が無効のため、出庫を確定しました");

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(6);

    const txRows = await db
      .select()
      .from(schema.stockTransactions)
      .where(eq(schema.stockTransactions.refId, body.headerId));
    expect(txRows).toHaveLength(1);
    expect(txRows[0].type).toBe("SHIPMENT");
    expect(txRows[0].quantity).toBe(-4);
  });

  it("在庫残数を超える出庫は409を返し、在庫は変化しない", async () => {
    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 100 }],
    });
    expect(res.status).toBe(409);

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(10);
  });

  it("在庫のないロケーションは404を返す", async () => {
    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC-EMPTY", itemId: "ITEM1", quantity: 1 }],
    });
    expect(res.status).toBe(404);
  });

  it("外部倉庫からの出庫も自社倉庫と同様に確定できる(Item6 Phase6-4-2でEXTERNAL制限を解放)", async () => {
    const now = new Date();
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
      id: "LOC2",
      warehouseId: "WH2",
      name: "B-1",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.stocks).values({
      id: "STOCK2",
      itemId: "ITEM1",
      warehouseId: "WH2",
      locationId: "LOC2",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      quantity: 5,
      updatedAt: now,
    });

    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC2", itemId: "ITEM1", quantity: 2 }],
    });
    expect(res.status).toBe(200);

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.id, "STOCK2"));
    expect(stockRows[0].quantity).toBe(3);
  });

  it("1件の出庫内で自社倉庫と外部倉庫の明細が混在する場合は400を返す", async () => {
    const now = new Date();
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
      id: "LOC2",
      warehouseId: "WH2",
      name: "B-1",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.stocks).values({
      id: "STOCK2",
      itemId: "ITEM1",
      warehouseId: "WH2",
      locationId: "LOC2",
      lotNumber: "NONE",
      accountCode: "ACC1",
      qualityStatus: "NORMAL",
      quantity: 5,
      updatedAt: now,
    });

    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [
        { locationId: "LOC1", itemId: "ITEM1", quantity: 1 },
        { locationId: "LOC2", itemId: "ITEM1", quantity: 1 },
      ],
    });
    expect(res.status).toBe(400);
  });

  it("partnerIdを指定すると出庫ヘッダーに得意先として記録される(Item6 Phase6-4-3)", async () => {
    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 2 }],
      partnerId: "PARTNER1",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { headerId: string };

    const header = await db
      .select()
      .from(schema.itemShipmentHeaders)
      .where(eq(schema.itemShipmentHeaders.id, body.headerId));
    expect(header[0].partnerId).toBe("PARTNER1");
  });

  it("存在しないpartnerIdを指定すると404を返す", async () => {
    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 1 }],
      partnerId: "NOPE-PARTNER",
    });
    expect(res.status).toBe(404);
  });

  // 新規要望(2026-09-23): 倉庫間移動。得意先の代わりに移動先倉庫を選べる
  describe("倉庫間移動(destinationWarehouseId)", () => {
    beforeEach(async () => {
      const now = new Date();
      await db.insert(schema.warehouses).values({
        id: "WH2",
        name: "第二倉庫",
        createdBy: "EMP001",
        createdAt: now,
        updatedBy: "EMP001",
        updatedAt: now,
      });
    });

    it("destinationWarehouseIdを指定すると出庫ヘッダーに移動先倉庫として記録される", async () => {
      const res = await postShipment({
        shippedDate: "2026-08-20",
        items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 2 }],
        destinationWarehouseId: "WH2",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { headerId: string };

      const header = await db
        .select()
        .from(schema.itemShipmentHeaders)
        .where(eq(schema.itemShipmentHeaders.id, body.headerId));
      expect(header[0].destinationWarehouseId).toBe("WH2");
      expect(header[0].partnerId).toBeNull();
    });

    it("存在しないdestinationWarehouseIdを指定すると404を返す", async () => {
      const res = await postShipment({
        shippedDate: "2026-08-20",
        items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 1 }],
        destinationWarehouseId: "NOPE-WH",
      });
      expect(res.status).toBe(404);
    });

    it("partnerIdとdestinationWarehouseIdを同時に指定すると400を返す", async () => {
      const res = await postShipment({
        shippedDate: "2026-08-20",
        items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 1 }],
        partnerId: "PARTNER1",
        destinationWarehouseId: "WH2",
      });
      expect(res.status).toBe(400);
    });

    it("移動先倉庫が出庫元倉庫と同じ場合は400を返す", async () => {
      const res = await postShipment({
        shippedDate: "2026-08-20",
        items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 1 }],
        destinationWarehouseId: "WH1",
      });
      expect(res.status).toBe(400);
    });
  });
});

describe("GET /:id/delivery-note (納品書PDFダウンロード)", () => {
  it("納品書PDFが未生成の場合は404を返す(テスト環境にはSYSTEM_BUCKETへフォントが未配置のため生成されない)", async () => {
    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 1 }],
      partnerId: "PARTNER1",
    });
    const { headerId } = (await res.json()) as { headerId: string };

    const ctx = createExecutionContext();
    const dlRes = await stockShipmentsRouter.request(`/${headerId}/delivery-note`, {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(dlRes.status).toBe(404);
  });

  it("存在しない出庫IDは404を返す", async () => {
    const ctx = createExecutionContext();
    const res = await stockShipmentsRouter.request("/NOPE/delivery-note", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});

describe("GET /:id/delivery-schedule-csv (納品予定データCSV)", () => {
  it("確定済みかつ得意先設定済みの出庫はCSVを返す", async () => {
    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 2 }],
      partnerId: "PARTNER1",
    });
    const { headerId } = (await res.json()) as { headerId: string };

    const ctx = createExecutionContext();
    const csvRes = await stockShipmentsRouter.request(
      `/${headerId}/delivery-schedule-csv`,
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(csvRes.status).toBe(200);
    const text = await csvRes.text();
    expect(text).toContain("PARTNER1");
    expect(text).toContain("ITEM1");
  });

  it("得意先未設定の出庫は400を返す", async () => {
    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 1 }],
    });
    const { headerId } = (await res.json()) as { headerId: string };

    const ctx = createExecutionContext();
    const csvRes = await stockShipmentsRouter.request(
      `/${headerId}/delivery-schedule-csv`,
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(csvRes.status).toBe(400);
  });

  it("存在しない出庫IDは404を返す", async () => {
    const ctx = createExecutionContext();
    const res = await stockShipmentsRouter.request("/NOPE/delivery-schedule-csv", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});

describe("GET /csv-download (出庫履歴CSVダウンロード)", () => {
  it("CSVを返す", async () => {
    await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 3 }],
    });
    const res = await stockShipmentsRouter.request("/csv-download", {}, env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("ITEM1");
    expect(text).toContain("headerId");
  });
});

describe("POST /bulk-register (出庫CSVインポート)", () => {
  it("1ファイル=1出庫として登録し、即座にstocksを減算する", async () => {
    const csvData =
      "shippedDate,memo,locationId,itemId,quantity,lotNumber,qualityStatus\n" +
      "2026-08-20,CSV取込,LOC1,ITEM1,3,,\n";

    const ctx = createExecutionContext();
    const res = await stockShipmentsRouter.request(
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
      .where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(7);
  });

  it("必須列が欠けている場合は400を返す", async () => {
    const csvData = "shippedDate\n2026-08-20\n";
    const ctx = createExecutionContext();
    const res = await stockShipmentsRouter.request(
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
    await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 1 }],
    });
    const resIn = await stockShipmentsRouter.request(
      "/?startDate=2026-08-19&endDate=2026-08-21&page=1&limit=10",
      {},
      env,
    );
    const bodyIn = (await resIn.json()) as { pagination: { total: number } };
    expect(bodyIn.pagination.total).toBeGreaterThan(0);

    const resOut = await stockShipmentsRouter.request(
      "/?startDate=2026-09-01&endDate=2026-09-30&page=1&limit=10",
      {},
      env,
    );
    const bodyOut = (await resOut.json()) as { pagination: { total: number } };
    expect(bodyOut.pagination.total).toBe(0);
  });

  it("createdByで絞り込める(セッションなし時はusers.idがcreatedByに入る)", async () => {
    await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 1 }],
    });
    const res = await stockShipmentsRouter.request(
      "/?createdBy=user-001&page=1&limit=10",
      {},
      env,
    );
    const body = (await res.json()) as { pagination: { total: number } };
    expect(body.pagination.total).toBeGreaterThan(0);

    const resMiss = await stockShipmentsRouter.request(
      "/?createdBy=NOBODY&page=1&limit=10",
      {},
      env,
    );
    const bodyMiss = (await resMiss.json()) as { pagination: { total: number } };
    expect(bodyMiss.pagination.total).toBe(0);
  });

  it("warehouseId/locationId(明細側)で絞り込める", async () => {
    await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 1 }],
    });

    const resHit = await stockShipmentsRouter.request(
      "/?warehouseId=WH1&locationId=LOC1&page=1&limit=10",
      {},
      env,
    );
    const bodyHit = (await resHit.json()) as { pagination: { total: number } };
    expect(bodyHit.pagination.total).toBeGreaterThan(0);

    const resMiss = await stockShipmentsRouter.request(
      "/?locationId=NOPE&page=1&limit=10",
      {},
      env,
    );
    const bodyMiss = (await resMiss.json()) as { pagination: { total: number } };
    expect(bodyMiss.pagination.total).toBe(0);
  });

  it("partnerId(ヘッダー側)で絞り込める", async () => {
    await postShipment({
      shippedDate: "2026-08-20",
      partnerId: "PARTNER1",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 1 }],
    });

    const resHit = await stockShipmentsRouter.request(
      "/?partnerId=PARTNER1&page=1&limit=10",
      {},
      env,
    );
    const bodyHit = (await resHit.json()) as { pagination: { total: number } };
    expect(bodyHit.pagination.total).toBeGreaterThan(0);

    const resMiss = await stockShipmentsRouter.request(
      "/?partnerId=NOBODY&page=1&limit=10",
      {},
      env,
    );
    const bodyMiss = (await resMiss.json()) as { pagination: { total: number } };
    expect(bodyMiss.pagination.total).toBe(0);
  });
});

describe("PUT /:id (修正して再申請)", () => {
  it("差戻し状態の出庫を修正して再申請すると、同じheaderIdのまま内容が書き換わりAPPROVEDになる(承認機能OFF時)", async () => {
    const now = new Date();
    // ワークフロー有効時に差戻された(=まだstocksへ未反映の)出庫を模して直接ヘッダー/明細を作成する
    await db.insert(schema.itemShipmentHeaders).values({
      id: "SHIP-REMANDED",
      shippedDate: now,
      status: "REMANDED",
      createdBy: "user-001",
      createdAt: now,
    });
    await db.insert(schema.itemShipmentItems).values({
      id: "SHIPITEM-REMANDED",
      shipmentHeaderId: "SHIP-REMANDED",
      itemId: "ITEM1",
      warehouseId: "WH1",
      locationId: "LOC1",
      lotNumber: "NONE",
      qualityStatus: "NORMAL",
      shippedQuantity: 3,
      accountCode: "ACC1",
    });

    const res = await putShipment("SHIP-REMANDED", {
      shippedDate: "2026-08-21",
      memo: "修正後",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 5 }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; headerId: string };
    expect(body.success).toBe(true);
    expect(body.headerId).toBe("SHIP-REMANDED");

    const header = await db
      .select()
      .from(schema.itemShipmentHeaders)
      .where(eq(schema.itemShipmentHeaders.id, "SHIP-REMANDED"));
    expect(header).toHaveLength(1);
    expect(header[0].status).toBe("APPROVED");
    expect(header[0].memo).toBe("修正後");

    const items = await db
      .select()
      .from(schema.itemShipmentItems)
      .where(eq(schema.itemShipmentItems.shipmentHeaderId, "SHIP-REMANDED"));
    expect(items).toHaveLength(1);
    expect(items[0].shippedQuantity).toBe(5);

    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(5);
  });

  it("差戻し状態以外の出庫を修正しようとすると400を返す", async () => {
    const createRes = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 3 }],
    });
    const { headerId } = (await createRes.json()) as { headerId: string };

    const res = await putShipment(headerId, {
      shippedDate: "2026-08-21",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 1 }],
    });
    expect(res.status).toBe(400);
  });

  it("存在しないheaderIdは404を返す", async () => {
    const res = await putShipment("NOPE", {
      shippedDate: "2026-08-21",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 1 }],
    });
    expect(res.status).toBe(404);
  });
});

describe("Item7残課題6: 受注明細への消込連携", () => {
  async function seedSalesOrderWithReservation(quantity: number, reservedQuantity: number) {
    const now = new Date();
    await db.insert(schema.salesOrders).values({
      id: "SO-1",
      partnerId: "PARTNER1",
      orderDate: now,
      status: "APPROVED",
      totalAmount: 0,
      taxAmount: 0,
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.salesOrderItems).values({
      id: "SOI-1",
      salesOrderId: "SO-1",
      itemId: "ITEM1",
      inputType: "MASTER",
      quantity,
      unitPrice: 100,
      amount: 100 * quantity,
      sortOrder: 0,
    });
    if (reservedQuantity > 0) {
      await db.insert(schema.warehouseStockReservations).values({
        itemId: "ITEM1",
        warehouseId: "WH1",
        reservedQuantity,
        updatedAt: now,
      });
      await db.insert(schema.salesOrderItemReservations).values({
        id: "RES-1",
        salesOrderItemId: "SOI-1",
        warehouseId: "WH1",
        reservedQuantity,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  it("受注明細の残数量を超える数量を指定すると400でブロックされる", async () => {
    await seedSalesOrderWithReservation(3, 3);

    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 4, salesOrderItemId: "SOI-1" }],
    });
    expect(res.status).toBe(400);

    const stockRows = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(10);
  });

  it("残数量内であれば確定でき、確定(在庫が実際に減った)時点で在庫引当が解放され、受注のshipment_statusが更新される", async () => {
    await seedSalesOrderWithReservation(5, 5);

    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 3, salesOrderItemId: "SOI-1" }],
    });
    expect(res.status).toBe(200);

    const reservationRows = await db
      .select()
      .from(schema.warehouseStockReservations)
      .where(eq(schema.warehouseStockReservations.itemId, "ITEM1"));
    expect(reservationRows[0].reservedQuantity).toBe(2);

    const ledgerRows = await db
      .select()
      .from(schema.salesOrderItemReservations)
      .where(eq(schema.salesOrderItemReservations.salesOrderItemId, "SOI-1"));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].reservedQuantity).toBe(2);

    const orderRows = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, "SO-1"));
    expect(orderRows[0].shipmentStatus).toBe("PARTIALLY_SHIPPED");
  });

  it("残数量ちょうど出荷し切ると、shipment_statusがSHIPPEDになり、引当ledgerは消える", async () => {
    await seedSalesOrderWithReservation(3, 3);

    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 3, salesOrderItemId: "SOI-1" }],
    });
    expect(res.status).toBe(200);

    const ledgerRows = await db
      .select()
      .from(schema.salesOrderItemReservations)
      .where(eq(schema.salesOrderItemReservations.salesOrderItemId, "SOI-1"));
    expect(ledgerRows).toHaveLength(0);

    const orderRows = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, "SO-1"));
    expect(orderRows[0].shipmentStatus).toBe("SHIPPED");
  });

  it("受注に紐づかない通常の出庫は従来通り動作し、shipment_statusやledgerに一切影響しない", async () => {
    await seedSalesOrderWithReservation(5, 5);

    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 2 }],
    });
    expect(res.status).toBe(200);

    const reservationRows = await db
      .select()
      .from(schema.warehouseStockReservations)
      .where(eq(schema.warehouseStockReservations.itemId, "ITEM1"));
    expect(reservationRows[0].reservedQuantity).toBe(5);

    const orderRows = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, "SO-1"));
    expect(orderRows[0].shipmentStatus).toBe("NOT_SHIPPED");
  });
});

describe("Item7残課題6: 承認機能ON時、最終承認確定(在庫が実際に減った)時点で在庫引当が解放される", () => {
  function buildWorkflowTestApp() {
    const app = new Hono<{ Bindings: Env }>();
    app.post("/approve", async (c) => {
      const { WorkflowTasksService } = await import(
        "../../workflow/workflow-tasks/workflow-tasks.service"
      );
      const body = await c.req.json();
      const result = await WorkflowTasksService.approveTask(c, db, body);
      return c.json(result);
    });
    return app;
  }

  async function buildSessionCookieHeader(userId: string): Promise<string> {
    const token = await signSessionToken(
      {
        userId,
        employeeNumber: userId,
        name: "テストユーザー",
        role: "user",
        deptName: "テスト部署",
        companyName: "テスト会社",
        isAuditEnabled: true,
      },
      await env.SESSION_SECRET.get(),
      3600,
    );
    return `session_token=${token}`;
  }

  async function postShipmentAuthed(actorUserId: string, body: unknown) {
    const ctx = createExecutionContext();
    const res = await stockShipmentsRouter.request(
      "/register",
      {
        method: "POST",
        headers: {
          Cookie: await buildSessionCookieHeader(actorUserId),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }

  async function callApproveTask(params: { logId: string; requestId: string; userId: string }) {
    const app = buildWorkflowTestApp();
    const ctx = createExecutionContext();
    const res = await app.request(
      "/approve",
      {
        method: "POST",
        headers: {
          Cookie: await buildSessionCookieHeader(params.userId),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("受注紐付きの明細を含む出庫が最終承認確定した時点で、在庫引当が解放されshipment_statusが更新される", async () => {
    const now = new Date();
    await db.insert(schema.salesOrders).values({
      id: "SO-WF-1",
      partnerId: "PARTNER1",
      orderDate: now,
      status: "APPROVED",
      totalAmount: 0,
      taxAmount: 0,
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.salesOrderItems).values({
      id: "SOI-WF-1",
      salesOrderId: "SO-WF-1",
      itemId: "ITEM1",
      inputType: "MASTER",
      quantity: 4,
      unitPrice: 100,
      amount: 400,
      sortOrder: 0,
    });
    await db.insert(schema.warehouseStockReservations).values({
      itemId: "ITEM1",
      warehouseId: "WH1",
      reservedQuantity: 4,
      updatedAt: now,
    });
    await db.insert(schema.salesOrderItemReservations).values({
      id: "RES-WF-1",
      salesOrderItemId: "SOI-WF-1",
      warehouseId: "WH1",
      reservedQuantity: 4,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.users).values({
      id: "approver-1",
      employeeNumber: "approver-1",
      email: "approver1@example.com",
      name: "承認者",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.roles).values({ id: "approver_role", name: "approver_role", createdAt: now });
    await db.insert(schema.userRoles).values({
      userId: "approver-1",
      roleId: "approver_role",
      departmentSurrogateId: null,
    });
    await db.insert(schema.approvalFlows).values({
      id: "flow-inventory-stock",
      name: "flow-inventory-stock",
      requestType: "inventory_stock",
      minAmount: 0,
      maxAmount: 999999999,
      isActive: true,
    });
    await db.insert(schema.approvalFlowSteps).values({
      id: "flow-inventory-stock-step-1",
      flowId: "flow-inventory-stock",
      stepOrder: 1,
      approverRoleId: "approver_role",
    });
    await env.COMPANY_SETTINGS.put("config", JSON.stringify({ is_shipping_approval_enabled: true }));

    const res = await postShipmentAuthed("applicant-1", {
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 4, salesOrderItemId: "SOI-WF-1" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { headerId: string };

    // 承認確定前はまだ在庫・引当とも変化していない
    let reservationRows = await db
      .select()
      .from(schema.warehouseStockReservations)
      .where(eq(schema.warehouseStockReservations.itemId, "ITEM1"));
    expect(reservationRows[0].reservedQuantity).toBe(4);

    const logs = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.targetId, body.headerId));
    const requests = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.targetId, body.headerId));
    const approveRes = await callApproveTask({
      logId: logs[0].id,
      requestId: requests[0].id,
      userId: "approver-1",
    });
    expect(approveRes.status).toBe(200);

    reservationRows = await db
      .select()
      .from(schema.warehouseStockReservations)
      .where(eq(schema.warehouseStockReservations.itemId, "ITEM1"));
    expect(reservationRows[0].reservedQuantity).toBe(0);

    const ledgerRows = await db
      .select()
      .from(schema.salesOrderItemReservations)
      .where(eq(schema.salesOrderItemReservations.salesOrderItemId, "SOI-WF-1"));
    expect(ledgerRows).toHaveLength(0);

    const orderRows = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, "SO-WF-1"));
    expect(orderRows[0].shipmentStatus).toBe("SHIPPED");
  });

  it("追加要望F: 申請者の実際の所属部署を指定した場合、masterApprovalRequestsにapplicantDepartmentSurrogateIdとして保存される", async () => {
    const now = new Date();
    await db.insert(schema.users).values({
      id: "applicant-1",
      employeeNumber: "applicant-1",
      email: "applicant1@example.com",
      name: "申請者",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.departments).values({
      surrogateId: "dept-a",
      id: "D001",
      name: "営業統括部",
      validFrom: now,
      createdBy: "system",
      createdAt: now,
      updatedBy: "system",
      updatedAt: now,
    });
    await db.insert(schema.roles).values({ id: "approver_role2", name: "approver_role2", createdAt: now });
    await db.insert(schema.userRoles).values({
      userId: "applicant-1",
      roleId: "approver_role2",
      departmentSurrogateId: "dept-a",
    });
    await db.insert(schema.approvalFlows).values({
      id: "flow-inventory-stock-2",
      name: "flow-inventory-stock-2",
      requestType: "inventory_stock",
      minAmount: 0,
      maxAmount: 999999999,
      isActive: true,
    });
    await db.insert(schema.approvalFlowSteps).values({
      id: "flow-inventory-stock-2-step-1",
      flowId: "flow-inventory-stock-2",
      stepOrder: 1,
      approverRoleId: "approver_role2",
    });
    await env.COMPANY_SETTINGS.put("config", JSON.stringify({ is_shipping_approval_enabled: true }));

    const res = await postShipmentAuthed("applicant-1", {
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 1 }],
      applicantDepartmentSurrogateId: "dept-a",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { headerId: string };

    const requests = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.targetId, body.headerId));
    expect(requests[0].applicantDepartmentSurrogateId).toBe("dept-a");
  });
});

describe("CSVダウンロード→再インポートの往復", () => {
  it("エクスポートしたCSVをそのまま再インポートすると同じ件数の出庫が復元される", async () => {
    await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 2 }],
    });

    const csvRes = await stockShipmentsRouter.request("/csv-download", {}, env);
    const csvText = await csvRes.text();

    const importCtx = createExecutionContext();
    const importRes = await stockShipmentsRouter.request(
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
    expect(body.message).toBe("CSVから 1 件の出庫を登録しました");

    // 元の出庫(-2) + 再インポートされた出庫(-2) = 10 - 4 = 6
    const stockRows = await db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.id, "STOCK1"));
    expect(stockRows[0].quantity).toBe(6);
  });
});
