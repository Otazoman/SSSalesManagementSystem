import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import type { Env } from "../../../types/env";
import { stockTransfersRouter } from "./index";
import { stockShipmentsRouter } from "../shipments/index";
import { stockReceiptsRouter } from "../receipts/index";
import { WorkflowTasksService } from "../../workflow/workflow-tasks/workflow-tasks.service";
import { syncWarehousePartner } from "../../../platform/partners/warehouse-partner";

// REQ-006: 倉庫間移動。出庫(移動元)で輸送中になり、移動先で分けて入庫でき、届かない分は差異で完了する。
// 外部倉庫が絡む時は、出荷指示・入荷指示を作り、実績の取込で移動に結び付ける

const db = drizzle(env.DB, { schema });
const now = new Date();
const audit = { createdBy: "user-1", createdAt: now, updatedBy: "user-1", updatedAt: now };

async function cookieOf(userId: string): Promise<string> {
  const token = await signSessionToken(
    { userId, employeeNumber: userId, name: "テスト", role: "user", deptName: "部署", companyName: "会社", isAuditEnabled: true },
    await env.SESSION_SECRET.get(),
    3600,
  );
  return `session_token=${token}`;
}

async function call(router: Hono<any>, path: string, init: RequestInit = {}, userId = "user-1") {
  const ctx = createExecutionContext();
  const headers: Record<string, string> = { Cookie: await cookieOf(userId) };
  if (typeof init.body === "string") headers["Content-Type"] = "application/json";
  const res = await router.request(path, { ...init, headers }, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const post = (router: Hono<any>, path: string, body: unknown) => call(router, path, { method: "POST", body: JSON.stringify(body) });

async function approve(targetId: string) {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/approve", async (c) => c.json(await WorkflowTasksService.approveTask(c, db, await c.req.json())));
  const [request] = await db.select().from(schema.masterApprovalRequests).where(eq(schema.masterApprovalRequests.targetId, targetId));
  const [log] = await db.select().from(schema.workflowLogs).where(eq(schema.workflowLogs.targetId, targetId));
  const ctx = createExecutionContext();
  const res = await app.request(
    "/approve",
    {
      method: "POST",
      headers: { Cookie: await cookieOf("approver-1"), "Content-Type": "application/json" },
      body: JSON.stringify({ logId: log.id, requestId: request.id, userId: "approver-1" }),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(200);
}

const transferOf = async (id: string) => (await db.select().from(schema.stockTransfers).where(eq(schema.stockTransfers.id, id)))[0];
const itemsOf = (id: string) => db.select().from(schema.stockTransferItems).where(eq(schema.stockTransferItems.transferId, id));
const stockAt = async (warehouseId: string) =>
  (await db.select().from(schema.stocks).where(and(eq(schema.stocks.warehouseId, warehouseId), eq(schema.stocks.itemId, "ITEM1")))).reduce(
    (sum, s) => sum + Number(s.quantity),
    0,
  );

async function createTransfer(overrides: Record<string, unknown> = {}) {
  const res = await post(stockTransfersRouter, "/register", {
    sourceWarehouseId: "WH-A",
    destinationWarehouseId: "WH-B",
    shippedDate: "2026-11-15",
    items: [{ itemId: "ITEM1", locationId: "LOC-A", quantity: 10 }],
    ...overrides,
  });
  const body = (await res.json()) as { id: string; status: string; message?: string };
  expect(res.status, body.message).toBe(200);
  return body;
}

beforeEach(async () => {
  for (const t of [
    schema.stockTransferItems, schema.stockTransfers, schema.stockTransactions, schema.stocks,
    schema.itemReceiptItems, schema.itemReceiptHeaders, schema.itemShipmentItems, schema.itemShipmentHeaders,
    schema.itemReceiptInstructionItems, schema.itemReceiptInstructions, schema.itemShipmentInstructionItems, schema.itemShipmentInstructions,
    schema.masterApprovalContexts, schema.masterApprovalRequests, schema.workflowLogs, schema.approvalFlowSteps, schema.approvalFlows,
    schema.userRoles, schema.roles, schema.locations, schema.partnerContacts, schema.partners, schema.warehouses, schema.items,
    schema.accounts, schema.units, schema.users,
  ]) {
    await db.delete(t);
  }
  await env.COMPANY_SETTINGS.delete("config");
  for (const id of ["user-1", "approver-1"]) {
    await db.insert(schema.users).values({ id, employeeNumber: id, email: `${id}@example.com`, name: id, isActive: true, createdAt: now, updatedAt: now });
  }
  await db.insert(schema.roles).values({ id: "approver_role", name: "approver_role", createdAt: now });
  await db.insert(schema.userRoles).values({ userId: "approver-1", roleId: "approver_role", departmentSurrogateId: null });
  await db.insert(schema.units).values({ code: "PCS", name: "個", ...audit });
  await db.insert(schema.accounts).values({ code: "ACC1", name: "商品", ...audit });
  await db.insert(schema.items).values({ id: "ITEM1", name: "移動する品目", baseUnitCode: "PCS", accountCode: "ACC1", ...audit });
  await db.insert(schema.warehouses).values([
    { id: "WH-A", name: "本社倉庫", warehouseType: "INTERNAL", status: "active", ...audit },
    { id: "WH-B", name: "第二倉庫", warehouseType: "INTERNAL", status: "active", ...audit },
    { id: "WH-X", name: "外部倉庫", warehouseType: "EXTERNAL", status: "active", ...audit },
  ]);
  await db.insert(schema.locations).values([
    { id: "LOC-A", warehouseId: "WH-A", name: "A-1", ...audit },
    { id: "LOC-B", warehouseId: "WH-B", name: "B-1", ...audit },
    { id: "LOC-X", warehouseId: "WH-X", name: "X-1", ...audit },
  ]);
  await db.insert(schema.stocks).values([
    { id: "ST-A", itemId: "ITEM1", warehouseId: "WH-A", locationId: "LOC-A", lotNumber: "NONE", accountCode: "ACC1", qualityStatus: "NORMAL", quantity: 30, updatedAt: now },
    { id: "ST-X", itemId: "ITEM1", warehouseId: "WH-X", locationId: "LOC-X", lotNumber: "NONE", accountCode: "ACC1", qualityStatus: "NORMAL", quantity: 30, updatedAt: now },
  ]);
  for (const id of ["WH-A", "WH-B", "WH-X"]) await syncWarehousePartner(db, id, "user-1", now);
});

describe("自社倉庫どうしの移動(REQ-006)", () => {
  it("出庫の承認が無効なら、すぐ移動元の在庫が減り輸送中になる。移動先の在庫にはまだ入らず、輸送中の在庫に出る", async () => {
    const { id, status } = await createTransfer();
    expect(status).toBe("IN_TRANSIT");
    expect(await stockAt("WH-A")).toBe(20);
    expect(await stockAt("WH-B")).toBe(0);
    const inTransit = (await (await call(stockTransfersRouter, "/in-transit")).json()) as Array<{ transferId: string; quantity: number }>;
    expect(inTransit).toEqual([expect.objectContaining({ transferId: id, quantity: 10 })]);
  });

  it("分けて入庫でき、全部入ると入庫済みになる。残りを超える入庫は断る", async () => {
    const { id } = await createTransfer();
    const [item] = await itemsOf(id);
    const receive = (quantity: number) =>
      post(stockTransfersRouter, `/${id}/receive`, { receivedDate: "2026-11-16", items: [{ transferItemId: item.id, locationId: "LOC-B", quantity }] });
    expect((await receive(4)).status).toBe(200);
    expect(await transferOf(id)).toMatchObject({ status: "PARTIALLY_RECEIVED" });
    expect(await stockAt("WH-B")).toBe(4);
    expect((await receive(7)).status).toBe(400);
    expect((await receive(6)).status).toBe(200);
    expect(await transferOf(id)).toMatchObject({ status: "RECEIVED" });
    expect((await itemsOf(id))[0].receivedQuantity).toBe(10);
    expect(await (await call(stockTransfersRouter, "/in-transit")).json()).toEqual([]);
  });

  it("届かない分は差異で完了でき、差異の数量を記録する(在庫は戻さない)", async () => {
    const { id } = await createTransfer();
    const [item] = await itemsOf(id);
    await post(stockTransfersRouter, `/${id}/receive`, { receivedDate: "2026-11-16", items: [{ transferItemId: item.id, locationId: "LOC-B", quantity: 8 }] });
    expect((await post(stockTransfersRouter, `/${id}/close`, { reason: "輸送中の破損" })).status).toBe(200);
    expect(await transferOf(id)).toMatchObject({ status: "CLOSED_WITH_DIFFERENCE", closedReason: "輸送中の破損" });
    expect((await itemsOf(id))[0].differenceQuantity).toBe(2);
    expect(await stockAt("WH-A")).toBe(20);
    expect(await stockAt("WH-B")).toBe(8);
  });

  it("出庫の承認が有効なら、出庫が承認されるまで出庫の承認待ちで、入庫できない", async () => {
    await env.COMPANY_SETTINGS.put("config", JSON.stringify({ is_shipping_approval_enabled: true, is_receiving_approval_enabled: true }));
    await db.insert(schema.approvalFlows).values({ id: "flow-st", name: "入出庫", requestType: "inventory_stock", minAmount: 0, maxAmount: 999999999, isActive: true });
    await db.insert(schema.approvalFlowSteps).values({ id: "flow-st-1", flowId: "flow-st", stepOrder: 1, approverRoleId: "approver_role" });
    const { id, status } = await createTransfer();
    expect(status).toBe("SHIPPING_PENDING");
    const [item] = await itemsOf(id);
    expect(
      (await post(stockTransfersRouter, `/${id}/receive`, { receivedDate: "2026-11-16", items: [{ transferItemId: item.id, locationId: "LOC-B", quantity: 1 }] })).status,
    ).toBe(400);

    await approve((await transferOf(id)).shipmentId!);
    expect(await transferOf(id)).toMatchObject({ status: "IN_TRANSIT" });
    // 入庫も承認が有効: 承認待ちの間は差異で完了できず、承認で入庫済みになる
    const res = await post(stockTransfersRouter, `/${id}/receive`, { receivedDate: "2026-11-16", items: [{ transferItemId: item.id, locationId: "LOC-B", quantity: 10 }] });
    const { receiptId } = (await res.json()) as { receiptId: string };
    expect((await post(stockTransfersRouter, `/${id}/close`, { reason: "x" })).status).toBe(400);
    await approve(receiptId);
    expect(await transferOf(id)).toMatchObject({ status: "RECEIVED" });
    expect(await stockAt("WH-B")).toBe(10);
  });

  it("移動元と移動先が同じ倉庫なら断る", async () => {
    const res = await post(stockTransfersRouter, "/register", {
      sourceWarehouseId: "WH-A", destinationWarehouseId: "WH-A", shippedDate: "2026-11-15", items: [{ itemId: "ITEM1", locationId: "LOC-A", quantity: 1 }],
    });
    expect(res.status).toBe(400);
    expect(await db.select().from(schema.stockTransfers)).toHaveLength(0);
  });
});

describe("外部倉庫が絡む移動(REQ-006)", () => {
  it("移動先が外部倉庫なら入荷指示(送り主は移動元の倉庫の取引先)を作り、入荷の実績の取込で移動に消し込む", async () => {
    const { id } = await createTransfer({ destinationWarehouseId: "WH-X" });
    const transfer = await transferOf(id);
    expect(transfer.receiptInstructionId).toBeTruthy();
    const [instruction] = await db.select().from(schema.itemReceiptInstructions).where(eq(schema.itemReceiptInstructions.id, transfer.receiptInstructionId!));
    expect(instruction).toMatchObject({ partnerId: "WH-A", warehouseId: "WH-X" });
    // 移動の画面からは入庫しない
    const [item] = await itemsOf(id);
    expect(
      (await post(stockTransfersRouter, `/${id}/receive`, { receivedDate: "2026-11-16", items: [{ transferItemId: item.id, locationId: "LOC-X", quantity: 1 }] })).status,
    ).toBe(400);
    // 入荷の実績(入荷指示を指定した入庫)
    const res = await post(stockReceiptsRouter, "/register", {
      receivedDate: "2026-11-16",
      receiptInstructionId: transfer.receiptInstructionId,
      items: [{ itemId: "ITEM1", warehouseId: "WH-X", locationId: "LOC-X", quantity: 10 }],
    });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(await transferOf(id)).toMatchObject({ status: "RECEIVED" });
  });

  it("移動元が外部倉庫なら出荷指示(宛先は移動先の倉庫の取引先)を作り、出荷の実績の取込で輸送中になる", async () => {
    const { id, status } = await createTransfer({ sourceWarehouseId: "WH-X", items: [{ itemId: "ITEM1", quantity: 5 }] });
    expect(status).toBe("SHIPPING_PENDING");
    const transfer = await transferOf(id);
    const [instruction] = await db.select().from(schema.itemShipmentInstructions).where(eq(schema.itemShipmentInstructions.id, transfer.shipmentInstructionId!));
    expect(instruction).toMatchObject({ partnerId: "WH-B", warehouseId: "WH-X" });
    const res = await post(stockShipmentsRouter, "/register", {
      shippedDate: "2026-11-16",
      shipmentInstructionId: transfer.shipmentInstructionId,
      partnerId: "WH-B",
      items: [{ itemId: "ITEM1", locationId: "LOC-X", quantity: 5 }],
    });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(await transferOf(id)).toMatchObject({ status: "IN_TRANSIT" });
    expect((await transferOf(id)).shipmentId).toBeTruthy();
    expect((await itemsOf(id))[0]).toMatchObject({ quantity: 5, sourceLocationId: "LOC-X" });
  });
});
