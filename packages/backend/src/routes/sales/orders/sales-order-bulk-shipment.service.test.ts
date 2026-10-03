import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { salesOrdersRouter } from "./index";
import { stockShipmentsRouter } from "../../inventory/shipments/index";

/**
 * 受注一覧からの一括出荷指示/出庫作成(computeBulkShipmentPlan/executeBulkShipmentPlan)の
 * 統合テスト。reconciliation.test.tsと同じ「実D1 + 実Hono Context」方式、承認機能OFF
 * (COMPANY_SETTINGS未設定時のデフォルト)前提で検証する。
 */

const db = drizzle(env.DB, { schema });
const now = new Date();

beforeEach(async () => {
  await db.delete(schema.itemShipmentItems);
  await db.delete(schema.itemShipmentHeaders);
  await db.delete(schema.itemShipmentInstructionItems);
  await db.delete(schema.itemShipmentInstructions);
  await db.delete(schema.salesOrderItemReservations);
  await db.delete(schema.warehouseStockReservations);
  await db.delete(schema.stockTransactions);
  await db.delete(schema.stocks);
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  await db.delete(schema.locations);
  await db.delete(schema.warehouses);
  await db.delete(schema.items);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
  await db.delete(schema.partners);
  await db.delete(schema.users);

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
  await db.insert(schema.warehouses).values([
    { id: "WH1", name: "本社倉庫", warehouseType: "INTERNAL", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    { id: "WH2", name: "外部倉庫", warehouseType: "EXTERNAL", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
  ]);
  await db.insert(schema.locations).values([
    { id: "LOC1", warehouseId: "WH1", name: "A-1", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    { id: "LOC1B", warehouseId: "WH1", name: "A-2", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
  ]);
  await db.insert(schema.partners).values([
    { id: "PARTNER1", name: "テスト得意先", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    { id: "PARTNER2", name: "テスト得意先2", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
  ]);
});

async function seedOrder(id: string, partnerId = "PARTNER1", status = "APPROVED") {
  await db.insert(schema.salesOrders).values({
    id,
    partnerId,
    orderDate: now,
    status,
    totalAmount: 0,
    taxAmount: 0,
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
}

async function seedOrderItem(id: string, salesOrderId: string, quantity: number, itemId = "ITEM1") {
  await db.insert(schema.salesOrderItems).values({
    id,
    salesOrderId,
    itemId,
    itemName: "テスト品目",
    inputType: "MASTER",
    quantity,
    unitPrice: 100,
    amount: 100 * quantity,
    sortOrder: 0,
  });
}

async function seedStock(id: string, warehouseId: string, locationId: string, quantity: number) {
  await db.insert(schema.stocks).values({
    id,
    itemId: "ITEM1",
    warehouseId,
    locationId,
    lotNumber: "NONE",
    accountCode: "ACC1",
    qualityStatus: "NORMAL",
    quantity,
    updatedAt: now,
  });
}

async function seedExternalReservation(salesOrderItemId: string, warehouseId: string, reservedQuantity: number) {
  await db.insert(schema.salesOrderItemReservations).values({
    id: crypto.randomUUID(),
    salesOrderItemId,
    warehouseId,
    reservedQuantity,
    createdAt: now,
    updatedAt: now,
  });
}

async function callPlan(orderIds: string[]) {
  const ctx = createExecutionContext();
  const res = await salesOrdersRouter.request(
    "/bulk-shipment-plan",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds }) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function callExecute(orderIds: string[]) {
  const ctx = createExecutionContext();
  const res = await salesOrdersRouter.request(
    "/bulk-shipment-execute",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds }) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function postShipmentDirect(body: unknown) {
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

type PlanResult = {
  orderId: string;
  partnerId: string;
  instruction: { warehouseId: string; warehouseName: string; items: any[] } | null;
  shipment: { items: any[] } | null;
  manualItems: Array<{ salesOrderItemId: string; reason: string; candidateCount: number }>;
  skipped: boolean;
  error: string | null;
};

describe("EXTERNAL明細のみの受注", () => {
  it("出荷指示のみプレビュー・作成される", async () => {
    await seedOrder("SO-1");
    await seedOrderItem("SOI-1", "SO-1", 10);
    await seedExternalReservation("SOI-1", "WH2", 10);

    const planRes = await callPlan(["SO-1"]);
    expect(planRes.status).toBe(200);
    const { results } = (await planRes.json()) as { results: PlanResult[] };
    expect(results).toHaveLength(1);
    expect(results[0].instruction).not.toBeNull();
    expect(results[0].instruction!.warehouseId).toBe("WH2");
    expect(results[0].instruction!.items).toEqual([
      { salesOrderItemId: "SOI-1", itemId: "ITEM1", itemName: "テスト品目", quantity: 10 },
    ]);
    expect(results[0].shipment).toBeNull();
    expect(results[0].manualItems).toEqual([]);

    const execRes = await callExecute(["SO-1"]);
    expect(execRes.status).toBe(200);
    const body = (await execRes.json()) as { results: any[] };
    expect(body.results[0].instruction.status).toBe("CREATED");

    const headers = await db
      .select()
      .from(schema.itemShipmentInstructions)
      .where(eq(schema.itemShipmentInstructions.salesOrderId, "SO-1"));
    expect(headers).toHaveLength(1);
  });
});

describe("INTERNAL明細・候補ロケーション1件のみ", () => {
  it("出庫が自動作成される", async () => {
    await seedOrder("SO-2");
    await seedOrderItem("SOI-2", "SO-2", 5);
    await seedStock("STOCK-2", "WH1", "LOC1", 20);

    const planRes = await callPlan(["SO-2"]);
    const { results } = (await planRes.json()) as { results: PlanResult[] };
    expect(results[0].instruction).toBeNull();
    expect(results[0].shipment).not.toBeNull();
    expect(results[0].shipment!.items).toEqual([
      {
        salesOrderItemId: "SOI-2",
        itemId: "ITEM1",
        itemName: "テスト品目",
        locationId: "LOC1",
        lotNumber: "NONE",
        qualityStatus: "NORMAL",
        quantity: 5,
      },
    ]);
    expect(results[0].manualItems).toEqual([]);

    const execRes = await callExecute(["SO-2"]);
    const body = (await execRes.json()) as { results: any[] };
    expect(body.results[0].shipment.status).toBe("CREATED");

    const headers = await db
      .select()
      .from(schema.itemShipmentHeaders)
      .where(eq(schema.itemShipmentHeaders.salesOrderId, "SO-2"));
    expect(headers).toHaveLength(1);

    const stock = await db.select().from(schema.stocks).where(eq(schema.stocks.id, "STOCK-2"));
    expect(stock[0].quantity).toBe(15);
  });
});

describe("INTERNAL明細・候補ロケーション2件以上", () => {
  it("要手動対応(AMBIGUOUS_LOCATION)に回り、作成されない", async () => {
    await seedOrder("SO-3");
    await seedOrderItem("SOI-3", "SO-3", 5);
    await seedStock("STOCK-3A", "WH1", "LOC1", 10);
    await seedStock("STOCK-3B", "WH1", "LOC1B", 10);

    const planRes = await callPlan(["SO-3"]);
    const { results } = (await planRes.json()) as { results: PlanResult[] };
    expect(results[0].instruction).toBeNull();
    expect(results[0].shipment).toBeNull();
    expect(results[0].manualItems).toHaveLength(1);
    expect(results[0].manualItems[0].reason).toBe("AMBIGUOUS_LOCATION");
    expect(results[0].manualItems[0].candidateCount).toBe(2);

    await callExecute(["SO-3"]);
    const headers = await db
      .select()
      .from(schema.itemShipmentHeaders)
      .where(eq(schema.itemShipmentHeaders.salesOrderId, "SO-3"));
    expect(headers).toHaveLength(0);
  });
});

describe("INTERNAL明細・在庫はあるが数量不足", () => {
  it("要手動対応(INSUFFICIENT_STOCK)になる", async () => {
    await seedOrder("SO-4");
    await seedOrderItem("SOI-4", "SO-4", 5);
    await seedStock("STOCK-4", "WH1", "LOC1", 2);

    const planRes = await callPlan(["SO-4"]);
    const { results } = (await planRes.json()) as { results: PlanResult[] };
    expect(results[0].manualItems).toHaveLength(1);
    expect(results[0].manualItems[0].reason).toBe("INSUFFICIENT_STOCK");
  });
});

describe("INTERNAL明細・在庫ゼロ", () => {
  it("要手動対応(NO_LOCATION_CANDIDATE)になる", async () => {
    await seedOrder("SO-5");
    await seedOrderItem("SOI-5", "SO-5", 5);

    const planRes = await callPlan(["SO-5"]);
    const { results } = (await planRes.json()) as { results: PlanResult[] };
    expect(results[0].manualItems).toHaveLength(1);
    expect(results[0].manualItems[0].reason).toBe("NO_LOCATION_CANDIDATE");
    expect(results[0].manualItems[0].candidateCount).toBe(0);
  });
});

describe("残数量ゼロの受注(出荷済み)", () => {
  it("スキップされ、何も作成されない", async () => {
    await seedOrder("SO-6");
    await seedOrderItem("SOI-6", "SO-6", 5);
    await seedStock("STOCK-6", "WH1", "LOC1", 5);

    const shipRes = await postShipmentDirect({
      shippedDate: "2026-08-25",
      items: [{ locationId: "LOC1", itemId: "ITEM1", quantity: 5, salesOrderItemId: "SOI-6" }],
    });
    expect(shipRes.status).toBe(200);

    const planRes = await callPlan(["SO-6"]);
    const { results } = (await planRes.json()) as { results: PlanResult[] };
    expect(results[0].skipped).toBe(true);
    expect(results[0].instruction).toBeNull();
    expect(results[0].shipment).toBeNull();
  });
});

describe("選択にAPPROVED以外の受注が混在", () => {
  it("その受注だけスキップされ、他は通常処理される(部分スキップ)", async () => {
    await seedOrder("SO-7A", "PARTNER1", "APPROVED");
    await seedOrderItem("SOI-7A", "SO-7A", 10);
    await seedExternalReservation("SOI-7A", "WH2", 10);

    await seedOrder("SO-7B", "PARTNER1", "DRAFT");

    const planRes = await callPlan(["SO-7A", "SO-7B"]);
    const { results } = (await planRes.json()) as { results: PlanResult[] };
    const byId = Object.fromEntries(results.map((r) => [r.orderId, r]));
    expect(byId["SO-7A"].skipped).toBe(false);
    expect(byId["SO-7A"].instruction).not.toBeNull();
    expect(byId["SO-7B"].skipped).toBe(true);
    expect(byId["SO-7B"].error).toBe("APPROVED状態の受注のみ対象です");
  });
});

describe("一括実行で1件成功・1件失敗(部分失敗)", () => {
  it("成功/失敗を個別に記録し、全体はHTTP 200で返る", async () => {
    await seedOrder("SO-8A", "PARTNER1");
    await seedOrderItem("SOI-8A", "SO-8A", 10);
    await seedExternalReservation("SOI-8A", "WH2", 10);

    // getShipmentProgress()は受注明細に保存済みのitemName/quantityのみを参照するため、
    // items(商品マスタ)に存在しないitemIdを指定してもプレビュー計算自体は通る。
    // 一方createInstruction()側はitems(商品マスタ)の実在を検証するため、ここで初めて失敗する
    // (プレビュー〜確定の間に商品マスタが削除された等の状態変化を模したもの)
    await seedOrder("SO-8B", "PARTNER1");
    await seedOrderItem("SOI-8B", "SO-8B", 10, "ITEM-GHOST");
    await seedExternalReservation("SOI-8B", "WH2", 10);

    const execRes = await callExecute(["SO-8A", "SO-8B"]);
    expect(execRes.status).toBe(200);
    const body = (await execRes.json()) as { success: boolean; results: any[] };
    expect(body.success).toBe(true);
    const byId = Object.fromEntries(body.results.map((r: any) => [r.orderId, r]));
    expect(byId["SO-8A"].instruction.status).toBe("CREATED");
    expect(byId["SO-8B"].instruction.status).toBe("FAILED");
  });
});

describe("同一受注内にEXTERNAL明細とINTERNAL明細が両方ある場合", () => {
  it("出荷指示ヘッダー1件+出庫ヘッダー1件が別々に作られる", async () => {
    await seedOrder("SO-9");
    await seedOrderItem("SOI-9A", "SO-9", 10);
    await seedExternalReservation("SOI-9A", "WH2", 10);
    await seedOrderItem("SOI-9B", "SO-9", 5);
    await seedStock("STOCK-9B", "WH1", "LOC1", 20);

    const planRes = await callPlan(["SO-9"]);
    const { results } = (await planRes.json()) as { results: PlanResult[] };
    expect(results[0].instruction).not.toBeNull();
    expect(results[0].instruction!.items).toHaveLength(1);
    expect(results[0].shipment).not.toBeNull();
    expect(results[0].shipment!.items).toHaveLength(1);

    const execRes = await callExecute(["SO-9"]);
    const body = (await execRes.json()) as { results: any[] };
    expect(body.results[0].instruction.status).toBe("CREATED");
    expect(body.results[0].shipment.status).toBe("CREATED");

    const instructionHeaders = await db
      .select()
      .from(schema.itemShipmentInstructions)
      .where(eq(schema.itemShipmentInstructions.salesOrderId, "SO-9"));
    expect(instructionHeaders).toHaveLength(1);

    const shipmentHeaders = await db
      .select()
      .from(schema.itemShipmentHeaders)
      .where(eq(schema.itemShipmentHeaders.salesOrderId, "SO-9"));
    expect(shipmentHeaders).toHaveLength(1);
  });
});

describe("BUG-056: サービス品目(isService)の明細", () => {
  it("在庫を持たないサービス品目は、要手動対応に出さない(在庫品目の明細だけが対象になる)", async () => {
    await db.insert(schema.items).values({
      id: "ITEM-SVC",
      name: "設置作業",
      baseUnitCode: "PCS",
      accountCode: "ACC1",
      isService: true,
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await seedOrder("SO-SVC");
    await seedOrderItem("SOI-STOCK", "SO-SVC", 5);
    await seedOrderItem("SOI-SVC", "SO-SVC", 1, "ITEM-SVC");

    const { results } = (await (await callPlan(["SO-SVC"])).json()) as { results: PlanResult[] };

    expect(results[0].manualItems.map((m) => m.salesOrderItemId)).toEqual(["SOI-STOCK"]);
  });

  it("サービス品目の明細だけの受注は、出荷の対象が無いためスキップされる", async () => {
    await db.insert(schema.items).values({
      id: "ITEM-SVC",
      name: "設置作業",
      baseUnitCode: "PCS",
      accountCode: "ACC1",
      isService: true,
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await seedOrder("SO-SVC2");
    await seedOrderItem("SOI-SVC2", "SO-SVC2", 1, "ITEM-SVC");

    const { results } = (await (await callPlan(["SO-SVC2"])).json()) as { results: PlanResult[] };

    expect(results[0].skipped).toBe(true);
    expect(results[0].manualItems).toHaveLength(0);
  });
});
