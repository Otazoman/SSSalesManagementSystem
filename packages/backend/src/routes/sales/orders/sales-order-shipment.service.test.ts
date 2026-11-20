import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import { salesOrdersRouter } from "./index";
import { stockShipmentsRouter } from "../../inventory/shipments/index";

// #14-2⑥: 元々2401行あったsales-order.service.test.tsから、出荷連携(GET /:id/shipment-progress、
// 受注明細ごとの出荷済/残数量・倉庫別引当内訳)の部分を分割したもの。ロジック変更なし。ヘルパー
// 関数は既存の慣習(payment-crud.test.ts/payment-csv.test.ts、purchase-requisition-crud/csv.
// service.test.ts)にならい、分割後の各ファイルにそのまま複製している(共通ファイル化はしない)。

const db = drizzle(env.DB, { schema });

async function buildSessionCookieHeader(
  userId: string,
  employeeNumber = userId,
): Promise<string> {
  const token = await signSessionToken(
    {
      userId,
      employeeNumber,
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

async function callSubmitForApproval(id: string, actorUserId: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await salesOrdersRouter.request(
    `/${id}/submit-for-approval`,
    {
      method: "POST",
      headers: {
        Cookie: await buildSessionCookieHeader(actorUserId),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const now = new Date();

async function seedUser(id: string, overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  await db.insert(schema.users).values({
    id,
    employeeNumber: id,
    email: `${id}@example.com`,
    name: overrides.name ?? id,
    isActive: overrides.isActive ?? true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

async function seedPartner(id: string, overrides: Partial<typeof schema.partners.$inferInsert> = {}) {
  await db.insert(schema.partners).values({
    id,
    name: `取引先${id}`,
    creditLimit: 0,
    createdBy: id,
    createdAt: now,
    updatedBy: id,
    updatedAt: now,
    ...overrides,
  });
}

async function seedOrder(
  id: string,
  overrides: Partial<typeof schema.salesOrders.$inferInsert> = {},
) {
  await db.insert(schema.salesOrders).values({
    id,
    title: `受注${id}`,
    partnerId: "partner-1",
    orderDate: now,
    status: "DRAFT",
    totalAmount: 10000,
    taxAmount: 1000,
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
    ...overrides,
  });
}

async function seedOrderItem(
  salesOrderId: string,
  overrides: Partial<typeof schema.salesOrderItems.$inferInsert> = {},
) {
  await db.insert(schema.salesOrderItems).values({
    id: crypto.randomUUID(),
    salesOrderId,
    itemId: "ITEM-1",
    itemName: "テスト品目",
    quantity: 1,
    unitPrice: 1000,
    amount: 1000,
    sortOrder: 0,
    ...overrides,
  });
}

async function seedItemMasterAndStock(itemId: string, stockQuantity: number) {
  await db.insert(schema.units).values({
    code: "PCS",
    name: "個",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.accounts).values({
    code: "ACC1",
    name: "品目",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.warehouses).values({
    id: "WH1",
    name: "本社倉庫",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.locations).values({
    id: "LOC1",
    warehouseId: "WH1",
    name: "A-1",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.items).values({
    id: itemId,
    name: `テスト品目${itemId}`,
    baseUnitCode: "PCS",
    accountCode: "ACC1",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.stocks).values({
    id: `STOCK-${itemId}`,
    itemId,
    warehouseId: "WH1",
    locationId: "LOC1",
    lotNumber: "NONE",
    accountCode: "ACC1",
    qualityStatus: "NORMAL",
    quantity: stockQuantity,
    updatedAt: now,
  });
}

// Item7残課題2-5: 倉庫単位引当への切替に伴い、warehouseStockReservationsを全倉庫合算で参照する
// Item7残課題2-5: 複数倉庫にまたがるテスト用に、既存の品目に対して別倉庫の在庫を追加する
async function seedStockAtWarehouse(itemId: string, warehouseId: string, warehouseName: string, quantity: number) {
  await db.insert(schema.warehouses).values({
    id: warehouseId,
    name: warehouseName,
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.locations).values({
    id: `LOC-${warehouseId}`,
    warehouseId,
    name: "A-1",
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
  }).onConflictDoNothing();
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

async function findOrder(id: string) {
  const rows = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, id));
  return rows[0] ?? null;
}

beforeEach(async () => {
  await db.delete(schema.salesOrderHistoryLogs);
  await db.delete(schema.salesOrderAttachments);
  // Item7残課題6: 受注→出荷指示/出庫の消込連携テスト用の後始末(salesOrderItemsを消す前に削除する必要がある)
  await db.delete(schema.itemShipmentItems);
  await db.delete(schema.itemShipmentHeaders);
  await db.delete(schema.itemShipmentInstructionItems);
  await db.delete(schema.itemShipmentInstructions);
  // 追加要望対応: 売上計上済みの受注明細を再インポートしてもエラーにならないことのテスト用
  // (salesInvoiceItems.sourceOrderItemIdがsalesOrderItems.idをFK参照するため、
  // salesOrderItemsを消す前に削除する必要がある)
  await db.delete(schema.salesInvoiceItems);
  await db.delete(schema.salesInvoices);
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  await db.delete(schema.quoteItems);
  await db.delete(schema.quotes);
  await db.delete(schema.itemStockReservations);
  await db.delete(schema.salesOrderItemReservations);
  await db.delete(schema.warehouseStockReservations);
  await db.delete(schema.stocks);
  await db.delete(schema.locations);
  await db.delete(schema.warehouses);
  await db.delete(schema.items);
  // journal_posting_rulesがaccountsをFK参照するため、accountsの削除より先に消す必要がある
  await db.delete(schema.journalPostingEvents);
  await db.delete(schema.journalPostingRules);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
  await db.delete(schema.masterApprovalContexts);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.workflowLogs);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.userRoles);
  await db.delete(schema.departments);
  await db.delete(schema.partners);
  await db.delete(schema.roles);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.delete("config");

  await seedUser("applicant-1");
  await seedPartner("partner-1");
});

describe("Item7残課題6: GET /:id/shipment-progress(受注明細ごとの出荷済/残数量・倉庫別引当内訳)", () => {
  async function callGetShipmentProgress(id: string, actorUserId: string) {
    const ctx = createExecutionContext();
    const res = await salesOrdersRouter.request(
      `/${id}/shipment-progress`,
      { method: "GET", headers: { Cookie: await buildSessionCookieHeader(actorUserId) } },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }

  async function postShipment(actorUserId: string, body: unknown) {
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

  it("出荷実績が無い状態では、出荷済0・残数量=受注数量・倉庫別引当内訳が返る", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { id: "SOI-1", itemId: "ITEM-1", quantity: 30, inputType: "MASTER" });
    await callSubmitForApproval("O-1", "applicant-1");

    const res = await callGetShipmentProgress("O-1", "applicant-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      salesOrderItemId: string;
      quantity: number;
      shippedQuantity: number;
      remainingQuantity: number;
      reservations: Array<{ warehouseId: string; reservedQuantity: number }>;
    }>;
    expect(body).toHaveLength(1);
    expect(body[0].quantity).toBe(30);
    expect(body[0].shippedQuantity).toBe(0);
    expect(body[0].remainingQuantity).toBe(30);
    expect(body[0].reservations).toEqual([{ warehouseId: "WH1", reservedQuantity: 30, warehouseName: "本社倉庫", warehouseType: "INTERNAL" }]);
  });

  it("出荷実績が確定すると、出荷済/残数量に反映され、引当内訳は解放された分だけ減る", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { id: "SOI-1", itemId: "ITEM-1", quantity: 30, inputType: "MASTER" });
    await callSubmitForApproval("O-1", "applicant-1");

    const shipRes = await postShipment("applicant-1", {
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM-1", quantity: 12, salesOrderItemId: "SOI-1" }],
    });
    expect(shipRes.status).toBe(200);

    const res = await callGetShipmentProgress("O-1", "applicant-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      shippedQuantity: number;
      remainingQuantity: number;
      reservations: Array<{ warehouseId: string; reservedQuantity: number }>;
    }>;
    expect(body[0].shippedQuantity).toBe(12);
    expect(body[0].remainingQuantity).toBe(18);
    expect(body[0].reservations).toEqual([
      { warehouseId: "WH1", reservedQuantity: 18, warehouseName: "本社倉庫", warehouseType: "INTERNAL" },
    ]);

    expect((await findOrder("O-1"))?.shipmentStatus).toBe("PARTIALLY_SHIPPED");
  });

  it("複数倉庫にまたがって引き当てられている場合、倉庫別の内訳がすべて返る", async () => {
    await seedItemMasterAndStock("ITEM-1", 20); // WH1: 20
    await seedStockAtWarehouse("ITEM-1", "WH2", "第二倉庫", 15);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { id: "SOI-1", itemId: "ITEM-1", quantity: 30, inputType: "MASTER" });
    await callSubmitForApproval("O-1", "applicant-1");

    const res = await callGetShipmentProgress("O-1", "applicant-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      reservations: Array<{ warehouseId: string; reservedQuantity: number }>;
    }>;
    const byWarehouse = Object.fromEntries(body[0].reservations.map((r) => [r.warehouseId, r.reservedQuantity]));
    expect(byWarehouse).toEqual({ WH1: 20, WH2: 10 });
  });

  it("存在しない受注IDは404を返す", async () => {
    const res = await callGetShipmentProgress("NOPE", "applicant-1");
    expect(res.status).toBe(404);
  });
});

describe("BUG-065: サービス品目(isService)は出荷の対象外", () => {
  async function seedServiceItem(itemId: string) {
    await db.insert(schema.items).values({
      id: itemId,
      name: `サービス${itemId}`,
      baseUnitCode: "PCS",
      accountCode: "ACC1",
      isService: true,
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
  }
  async function callGetShipmentProgress(id: string) {
    const ctx = createExecutionContext();
    const res = await salesOrdersRouter.request(
      `/${id}/shipment-progress`,
      { method: "GET", headers: { Cookie: await buildSessionCookieHeader("applicant-1") } },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }
  async function postShipment(body: unknown) {
    const ctx = createExecutionContext();
    const res = await stockShipmentsRouter.request(
      "/register",
      {
        method: "POST",
        headers: { Cookie: await buildSessionCookieHeader("applicant-1"), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }
  async function seedOrderWithService() {
    await seedItemMasterAndStock("ITEM-1", 100);
    await seedServiceItem("ITEM-SVC");
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { id: "SOI-1", itemId: "ITEM-1", quantity: 10, inputType: "MASTER" });
    await seedOrderItem("O-1", { id: "SOI-SVC", itemId: "ITEM-SVC", quantity: 2, inputType: "MASTER", sortOrder: 1 });
    await callSubmitForApproval("O-1", "applicant-1");
  }

  it("出荷の残数量(出荷指示・出庫の作成画面用)に、サービス品目の明細を含めない", async () => {
    await seedOrderWithService();

    const body = (await (await callGetShipmentProgress("O-1")).json()) as Array<{ salesOrderItemId: string }>;

    expect(body.map((b) => b.salesOrderItemId)).toEqual(["SOI-1"]);
  });

  // REQ-011(1): 品目マスタに無い明細(直接入力)も、サービス品と同じく出荷の対象外
  it("出荷の残数量に、品目マスタに無い明細(直接入力)を含めない。全ての在庫品目を出荷すれば出荷済みになる", async () => {
    await seedItemMasterAndStock("ITEM-1", 100);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { id: "SOI-1", itemId: "ITEM-1", quantity: 10, inputType: "MASTER" });
    await seedOrderItem("O-1", { id: "SOI-FREE", itemId: "FREE-1", itemName: "マスタ外", quantity: 3, inputType: "DIRECT", sortOrder: 1 });
    await callSubmitForApproval("O-1", "applicant-1");

    const body = (await (await callGetShipmentProgress("O-1")).json()) as Array<{ salesOrderItemId: string }>;
    expect(body.map((b) => b.salesOrderItemId)).toEqual(["SOI-1"]);

    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM-1", quantity: 10, salesOrderItemId: "SOI-1" }],
    });
    expect(res.status).toBe(200);
    const order = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, "O-1"));
    expect(order[0].shipmentStatus).toBe("SHIPPED");
  });

  // 出庫は在庫(ロケーション)の確認で先に止まる(サービス品目に在庫は無い)。出荷指示は shipment-instructions の reconciliation.test.ts で確認
  it("サービス品目の受注明細は出庫できない", async () => {
    await seedOrderWithService();

    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM-SVC", quantity: 1, salesOrderItemId: "SOI-SVC" }],
    });

    expect(res.ok).toBe(false);
  });

  it("在庫品目をすべて出荷すれば、サービス品目の明細があっても受注の出荷状況は「出荷済み」になる", async () => {
    await seedOrderWithService();

    const res = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM-1", quantity: 10, salesOrderItemId: "SOI-1" }],
    });

    expect(res.status).toBe(200);
    expect((await findOrder("O-1"))?.shipmentStatus).toBe("SHIPPED");
  });
});

// BUG-109: 直送の発注とつながる受注明細は、発注の「直送完了」で出荷する。出荷指示・出庫の対象にしない
describe("BUG-109: 直送の明細は出荷指示・出庫の対象外", () => {
  // 発注明細が受注明細を参照するため、共通の後始末(受注明細の削除)より先に消す
  afterEach(async () => {
    await db.delete(schema.orderItems);
    await db.delete(schema.orders);
  });
  async function callGetShipmentProgress(id: string) {
    const ctx = createExecutionContext();
    const res = await salesOrdersRouter.request(
      `/${id}/shipment-progress`,
      { method: "GET", headers: { Cookie: await buildSessionCookieHeader("applicant-1") } },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }
  async function postShipment(body: unknown) {
    const ctx = createExecutionContext();
    const res = await stockShipmentsRouter.request(
      "/register",
      {
        method: "POST",
        headers: { Cookie: await buildSessionCookieHeader("applicant-1"), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }
  async function seedOrderWithDirectLine() {
    await seedItemMasterAndStock("ITEM-1", 100);
    await seedOrder("O-1", { status: "DRAFT" });
    await seedOrderItem("O-1", { id: "SOI-STOCK", itemId: "ITEM-1", quantity: 10, inputType: "MASTER" });
    await seedOrderItem("O-1", { id: "SOI-DIRECT", itemId: "ITEM-1", quantity: 4, inputType: "MASTER", sortOrder: 1 });
    await callSubmitForApproval("O-1", "applicant-1");
    await db.insert(schema.orders).values({
      id: "PO-DIRECT",
      orderDate: now,
      status: "APPROVED",
      isDirectShipment: true,
      directSalesOrderId: "O-1",
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });
    await db.insert(schema.orderItems).values({
      id: "POI-DIRECT",
      orderId: "PO-DIRECT",
      itemId: "ITEM-1",
      quantity: 4,
      unitPrice: 500,
      salesOrderItemId: "SOI-DIRECT",
    });
  }

  it("出荷状況で、直送の発注とつながる明細に isDirectShipment が付く", async () => {
    await seedOrderWithDirectLine();

    const body = (await (await callGetShipmentProgress("O-1")).json()) as Array<{
      salesOrderItemId: string;
      isDirectShipment: boolean;
    }>;

    expect(body.map((b) => [b.salesOrderItemId, b.isDirectShipment])).toEqual([
      ["SOI-STOCK", false],
      ["SOI-DIRECT", true],
    ]);
  });

  it("直送の明細は出庫できない。直送でない明細は今までどおり出庫できる", async () => {
    await seedOrderWithDirectLine();

    const rejected = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM-1", quantity: 1, salesOrderItemId: "SOI-DIRECT" }],
    });
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(await rejected.json())).toContain("直送");

    const ok = await postShipment({
      shippedDate: "2026-08-20",
      items: [{ locationId: "LOC1", itemId: "ITEM-1", quantity: 10, salesOrderItemId: "SOI-STOCK" }],
    });
    expect(ok.status).toBe(200);
  });
});
