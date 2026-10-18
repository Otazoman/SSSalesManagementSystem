import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import { purchaseOrdersRouter } from "./index";
import { PurchaseOrderRepository } from "./purchase-order.repository";
import { addDaysToIsoDate, computeReflectedDeliveryDate } from "./purchase-order-delivery-date.service";
import { normalizeCsvDate } from "../../../platform/csv/csv-date";

// 新規要望(2026-10-18): 発注明細の希望納期・回答納期と、回答納期の受注明細納期への反映のテスト。
// ヘルパー関数は既存の慣習(purchase-order-crud.service.test.ts等)にならい、このファイルに複製している

const db = drizzle(env.DB, { schema });
const now = new Date();

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

async function callUpdateOrder(id: string, payload: unknown) {
  const formData = new FormData();
  formData.append("orderData", JSON.stringify(payload));
  const ctx = createExecutionContext();
  const res = await purchaseOrdersRouter.request(
    `/${id}`,
    { method: "PUT", headers: { Cookie: await buildSessionCookieHeader("buyer-1") }, body: formData },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function callUpdateDeliveryDates(id: string, payload: unknown) {
  const ctx = createExecutionContext();
  const res = await purchaseOrdersRouter.request(
    `/${id}/delivery-dates`,
    {
      method: "PUT",
      headers: {
        Cookie: await buildSessionCookieHeader("buyer-1"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function seedUser(id: string) {
  await db.insert(schema.users).values({
    id,
    employeeNumber: id,
    email: `${id}@example.com`,
    name: id,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedSalesOrderWithItems(
  id: string,
  items: Array<{ id: string; deliveryDate?: string | null }>,
  status = "APPROVED",
) {
  await db.insert(schema.salesOrders).values({
    id,
    title: `受注${id}`,
    partnerId: "P-1",
    orderDate: now,
    status,
    createdBy: "sales-1",
    createdAt: now,
    updatedBy: "sales-1",
    updatedAt: now,
  });
  for (const [index, it] of items.entries()) {
    await db.insert(schema.salesOrderItems).values({
      id: it.id,
      salesOrderId: id,
      itemId: "ITEM-1",
      itemName: "品目1",
      quantity: 1,
      unitPrice: 1000,
      amount: 1000,
      sortOrder: index,
      deliveryDate: it.deliveryDate ?? null,
    });
  }
}

async function seedPurchaseOrderWithItems(
  id: string,
  items: Array<{
    id: string;
    salesOrderItemId?: string | null;
    requestedDeliveryDate?: string | null;
    answeredDeliveryDate?: string | null;
  }>,
  status = "APPROVED",
) {
  await db.insert(schema.orders).values({
    id,
    title: `発注${id}`,
    orderDate: now,
    status,
    totalAmount: 1000,
    taxAmount: 0,
    createdBy: "buyer-1",
    createdAt: now,
    updatedBy: "buyer-1",
    updatedAt: now,
  });
  for (const [index, it] of items.entries()) {
    await db.insert(schema.orderItems).values({
      id: it.id,
      orderId: id,
      itemId: "ITEM-1",
      itemName: "品目1",
      quantity: 1,
      unitPrice: 1000,
      sortOrder: index,
      salesOrderItemId: it.salesOrderItemId ?? null,
      requestedDeliveryDate: it.requestedDeliveryDate ?? null,
      answeredDeliveryDate: it.answeredDeliveryDate ?? null,
    });
  }
}

async function findSalesOrderItem(id: string) {
  const rows = await db.select().from(schema.salesOrderItems).where(eq(schema.salesOrderItems.id, id));
  return rows[0];
}

async function findOrderItem(id: string) {
  const rows = await db.select().from(schema.orderItems).where(eq(schema.orderItems.id, id));
  return rows[0];
}

beforeEach(async () => {
  await db.delete(schema.orderAttachments);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
  await db.delete(schema.salesOrderHistoryLogs);
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  await db.delete(schema.partners);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.delete("config");

  await seedUser("buyer-1");
  await db.insert(schema.partners).values({
    id: "P-1",
    name: "取引先P-1",
    creditLimit: 0,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
});

describe("納期計算ヘルパー", () => {
  it("暦日で日数を加算できる(月・年またぎ、うるう年を含む)", () => {
    expect(addDaysToIsoDate("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDaysToIsoDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToIsoDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToIsoDate("2026-10-18", 0)).toBe("2026-10-18");
  });

  it("反映方法に従って受注へ書き込む納期を求める", () => {
    expect(computeReflectedDeliveryDate("2026-10-18", { mode: "SAME" })).toBe("2026-10-18");
    expect(computeReflectedDeliveryDate("2026-10-18", { mode: "ADD_DAYS", addDays: 5 })).toBe("2026-10-23");
  });

  it("CSVの日付をYYYY-MM-DDへ正規化し、不正な日付はエラーにする", () => {
    expect(normalizeCsvDate(null, "x")).toBeNull();
    expect(normalizeCsvDate("", "x")).toBeNull();
    expect(normalizeCsvDate("2026/1/5", "x")).toBe("2026-01-05");
    expect(normalizeCsvDate("2026-10-18", "x")).toBe("2026-10-18");
    expect(() => normalizeCsvDate("2026-02-30", "x")).toThrow();
    expect(() => normalizeCsvDate("10/18", "x")).toThrow();
  });
});

describe("PUT /:id/delivery-dates (納期のみ更新)", () => {
  it("承認機能ONでも、承認済みの発注の希望納期・回答納期を変更申請なしで更新できる", async () => {
    await env.COMPANY_SETTINGS.put("config", JSON.stringify({ is_purchase_order_approval_enabled: true }));
    await seedPurchaseOrderWithItems("PO-1", [{ id: "POI-1", requestedDeliveryDate: "2026-11-01" }]);

    const res = await callUpdateDeliveryDates("PO-1", {
      items: [{ id: "POI-1", requestedDeliveryDate: "2026-11-01", answeredDeliveryDate: "2026-11-10" }],
    });
    expect(res.status).toBe(200);

    const item = await findOrderItem("POI-1");
    expect(item.requestedDeliveryDate).toBe("2026-11-01");
    expect(item.answeredDeliveryDate).toBe("2026-11-10");
    const order = await db.select().from(schema.orders).where(eq(schema.orders.id, "PO-1"));
    expect(order[0].status).toBe("APPROVED");
  });

  it("承認処理中の発注は納期を更新できない", async () => {
    await seedPurchaseOrderWithItems("PO-1", [{ id: "POI-1" }], "PENDING_APPROVAL");
    const res = await callUpdateDeliveryDates("PO-1", {
      items: [{ id: "POI-1", answeredDeliveryDate: "2026-11-10" }],
    });
    expect(res.status).toBe(400);
    expect((await findOrderItem("POI-1")).answeredDeliveryDate).toBeNull();
  });

  it("他の発注の明細IDや不正な日付形式は受け付けない", async () => {
    await seedPurchaseOrderWithItems("PO-1", [{ id: "POI-1" }]);
    await seedPurchaseOrderWithItems("PO-2", [{ id: "POI-2" }]);

    const otherItem = await callUpdateDeliveryDates("PO-1", {
      items: [{ id: "POI-2", answeredDeliveryDate: "2026-11-10" }],
    });
    expect(otherItem.status).toBe(400);

    const badDate = await callUpdateDeliveryDates("PO-1", {
      items: [{ id: "POI-1", answeredDeliveryDate: "2026/11/10" }],
    });
    expect(badDate.status).toBe(400);
  });

  it("反映指定SAMEなら、承認済み受注の明細の納期へ回答納期をそのまま反映し履歴を残す", async () => {
    await seedSalesOrderWithItems("SO-1", [{ id: "SOI-1" }, { id: "SOI-2", deliveryDate: "2026-12-01" }]);
    await seedPurchaseOrderWithItems("PO-1", [{ id: "POI-1", salesOrderItemId: "SOI-1" }]);

    const res = await callUpdateDeliveryDates("PO-1", {
      items: [{ id: "POI-1", answeredDeliveryDate: "2026-11-10" }],
      deliveryDateReflection: { mode: "SAME" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("受注1件");

    expect((await findSalesOrderItem("SOI-1")).deliveryDate).toBe("2026-11-10");
    // 紐づいていない受注明細は変わらない
    expect((await findSalesOrderItem("SOI-2")).deliveryDate).toBe("2026-12-01");
    const so = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, "SO-1"));
    expect(so[0].status).toBe("APPROVED");
    const logs = await db
      .select()
      .from(schema.salesOrderHistoryLogs)
      .where(eq(schema.salesOrderHistoryLogs.salesOrderId, "SO-1"));
    expect(logs).toHaveLength(1);
    expect(logs[0].comment).toContain("PO-1");
  });

  it("反映指定ADD_DAYSなら回答納期にN日(暦日)を加算して反映する", async () => {
    await seedSalesOrderWithItems("SO-1", [{ id: "SOI-1" }]);
    await seedPurchaseOrderWithItems("PO-1", [{ id: "POI-1", salesOrderItemId: "SOI-1" }]);

    await callUpdateDeliveryDates("PO-1", {
      items: [{ id: "POI-1", answeredDeliveryDate: "2026-11-28" }],
      deliveryDateReflection: { mode: "ADD_DAYS", addDays: 5 },
    });
    expect((await findSalesOrderItem("SOI-1")).deliveryDate).toBe("2026-12-03");
  });

  it("反映指定が無い(NONE)場合は受注の納期を変えない", async () => {
    await seedSalesOrderWithItems("SO-1", [{ id: "SOI-1", deliveryDate: "2026-12-01" }]);
    await seedPurchaseOrderWithItems("PO-1", [{ id: "POI-1", salesOrderItemId: "SOI-1" }]);

    await callUpdateDeliveryDates("PO-1", {
      items: [{ id: "POI-1", answeredDeliveryDate: "2026-11-10" }],
      deliveryDateReflection: { mode: "NONE" },
    });
    expect((await findSalesOrderItem("SOI-1")).deliveryDate).toBe("2026-12-01");
  });

  it("1つの受注明細に複数の発注明細が紐づく場合は、最も遅い回答納期を反映する", async () => {
    await seedSalesOrderWithItems("SO-1", [{ id: "SOI-1" }]);
    await seedPurchaseOrderWithItems("PO-OTHER", [
      { id: "POI-OTHER", salesOrderItemId: "SOI-1", answeredDeliveryDate: "2026-11-20" },
    ]);
    await seedPurchaseOrderWithItems("PO-1", [{ id: "POI-1", salesOrderItemId: "SOI-1" }]);

    await callUpdateDeliveryDates("PO-1", {
      items: [{ id: "POI-1", answeredDeliveryDate: "2026-11-10" }],
      deliveryDateReflection: { mode: "SAME" },
    });
    expect((await findSalesOrderItem("SOI-1")).deliveryDate).toBe("2026-11-20");
  });
});

describe("PUT /:id (発注の直接編集) での納期保存と反映", () => {
  it("明細の希望納期・回答納期を保存し、反映指定があれば受注へ反映する", async () => {
    await seedSalesOrderWithItems("SO-1", [{ id: "SOI-1" }]);
    await seedPurchaseOrderWithItems("PO-1", [{ id: "POI-1", salesOrderItemId: "SOI-1" }], "DRAFT");

    const res = await callUpdateOrder("PO-1", {
      orderDate: "2026-10-18",
      partnerId: "P-1",
      deliveryDateReflection: { mode: "ADD_DAYS", addDays: 2 },
      items: [
        {
          itemId: "ITEM-1",
          itemName: "品目1",
          quantity: 1,
          unitPrice: 1000,
          salesOrderItemId: "SOI-1",
          requestedDeliveryDate: "2026-11-01",
          answeredDeliveryDate: "2026-11-05",
        },
      ],
    });
    expect(res.status).toBe(200);

    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, "PO-1"));
    expect(items).toHaveLength(1);
    expect(items[0].requestedDeliveryDate).toBe("2026-11-01");
    expect(items[0].answeredDeliveryDate).toBe("2026-11-05");
    expect((await findSalesOrderItem("SOI-1")).deliveryDate).toBe("2026-11-07");
  });
});

describe("CSV の希望納期・回答納期列", () => {
  it("取込(YYYY/M/D形式も可)した希望納期・回答納期が保存され、出力にも含まれる", async () => {
    const csv = [
      "id,partnerId,title,orderDate,status,lineId,itemId,itemName,quantity,unitPrice,requestedDeliveryDate,answeredDeliveryDate",
      "PO-CSV-1,P-1,CSV発注,2026-10-18,DRAFT,POI-CSV-1,ITEM-1,品目1,1,1000,2026/11/1,2026-11-15",
    ].join("\n");
    const formData = new FormData();
    formData.append("file", new File([csv], "orders.csv", { type: "text/csv" }));
    const ctx = createExecutionContext();
    const importRes = await purchaseOrdersRouter.request(
      "/bulk-register",
      { method: "POST", headers: { Cookie: await buildSessionCookieHeader("buyer-1") }, body: formData },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(importRes.status).toBe(200);

    const item = await findOrderItem("POI-CSV-1");
    expect(item.requestedDeliveryDate).toBe("2026-11-01");
    expect(item.answeredDeliveryDate).toBe("2026-11-15");

    const ctx2 = createExecutionContext();
    const exportRes = await purchaseOrdersRouter.request(
      "/csv-download",
      { headers: { Cookie: await buildSessionCookieHeader("buyer-1") } },
      env,
      ctx2,
    );
    await waitOnExecutionContext(ctx2);
    const text = await exportRes.text();
    const [header, row] = text.replace(/^﻿/, "").trim().split(/\r?\n/);
    expect(header.split(",")).toEqual(expect.arrayContaining(["requestedDeliveryDate", "answeredDeliveryDate"]));
    expect(row).toContain("2026-11-01");
    expect(row).toContain("2026-11-15");
  });

  it("存在しない日付を含むCSVは取り込まない", async () => {
    const csv = [
      "id,partnerId,title,orderDate,status,lineId,itemId,itemName,quantity,unitPrice,answeredDeliveryDate",
      "PO-CSV-2,P-1,CSV発注,2026-10-18,DRAFT,POI-CSV-2,ITEM-1,品目1,1,1000,2026-02-30",
    ].join("\n");
    const formData = new FormData();
    formData.append("file", new File([csv], "orders.csv", { type: "text/csv" }));
    const ctx = createExecutionContext();
    const res = await purchaseOrdersRouter.request(
      "/bulk-register",
      { method: "POST", headers: { Cookie: await buildSessionCookieHeader("buyer-1") }, body: formData },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    expect(await db.select().from(schema.orders).where(eq(schema.orders.id, "PO-CSV-2"))).toHaveLength(0);
  });
});

describe("CSV の受注明細とのつながり(salesOrderItemId)", () => {
  async function importCsv(csv: string) {
    const formData = new FormData();
    formData.append("file", new File([csv], "orders.csv", { type: "text/csv" }));
    const ctx = createExecutionContext();
    const res = await purchaseOrdersRouter.request(
      "/bulk-register",
      { method: "POST", headers: { Cookie: await buildSessionCookieHeader("buyer-1") }, body: formData },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("出力したCSVを取り込み直しても受注明細とのつながりが保たれ、回答納期を反映できる", async () => {
    await seedSalesOrderWithItems("SO-1", [{ id: "SOI-1" }]);
    await seedPurchaseOrderWithItems("PO-1", [{ id: "POI-1", salesOrderItemId: "SOI-1" }], "DRAFT");

    const ctx = createExecutionContext();
    const exportRes = await purchaseOrdersRouter.request(
      "/csv-download",
      { headers: { Cookie: await buildSessionCookieHeader("buyer-1") } },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const exported = (await exportRes.text()).replace(/^﻿/, "");
    expect(exported.split(/\r?\n/)[0].split(",")).toContain("salesOrderItemId");

    const importRes = await importCsv(exported);
    expect(importRes.status).toBe(200);
    expect((await findOrderItem("POI-1")).salesOrderItemId).toBe("SOI-1");

    await callUpdateDeliveryDates("PO-1", {
      items: [{ id: "POI-1", answeredDeliveryDate: "2026-11-10" }],
      deliveryDateReflection: { mode: "SAME" },
    });
    expect((await findSalesOrderItem("SOI-1")).deliveryDate).toBe("2026-11-10");
  });

  it("存在しない受注明細IDを指定したCSVは、分かりやすいエラー(400)で取り込まない", async () => {
    const csv = [
      "id,partnerId,title,orderDate,status,lineId,itemId,itemName,quantity,unitPrice,salesOrderItemId",
      "PO-CSV-3,P-1,CSV発注,2026-10-18,DRAFT,POI-CSV-3,ITEM-1,品目1,1,1000,NO-SUCH-ITEM",
    ].join("\n");
    const res = await importCsv(csv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("NO-SUCH-ITEM");
    expect(await db.select().from(schema.orders).where(eq(schema.orders.id, "PO-CSV-3"))).toHaveLength(0);
  });
});

// 2026-10-18: 発注の明細は、保存(直接編集)・変更申請の承認確定のどちらでも明細IDを保ったまま更新する
describe("発注の明細IDを保ったままの更新", () => {
  async function seedItemAttachment(orderId: string, orderItemId: string) {
    await db.insert(schema.orderAttachments).values({
      id: `ATT-${orderItemId}`,
      orderId,
      orderItemId,
      fileName: "spec.pdf",
      storageType: "GOOGLE_DRIVE",
      externalUrl: "https://example.com/spec.pdf",
      uploadedById: "buyer-1",
      uploadedAt: now,
    });
  }

  const item = (overrides: Record<string, unknown>) => ({
    itemId: "ITEM-1",
    itemName: "品目1",
    quantity: 1,
    unitPrice: 1000,
    ...overrides,
  });

  it("他の伝票から参照されている明細を残したまま編集でき、明細IDと受注とのつながり・納期が保たれる", async () => {
    await seedSalesOrderWithItems("SO-1", [{ id: "SOI-1" }]);
    await seedPurchaseOrderWithItems(
      "PO-1",
      [{ id: "POI-1", salesOrderItemId: "SOI-1", answeredDeliveryDate: "2026-11-10" }],
      "DRAFT",
    );
    await seedItemAttachment("PO-1", "POI-1");

    const res = await callUpdateOrder("PO-1", {
      orderDate: "2026-10-18",
      partnerId: "P-1",
      items: [
        item({ id: "POI-1", quantity: 3, salesOrderItemId: "SOI-1", answeredDeliveryDate: "2026-11-10" }),
        item({ itemName: "追加品目", quantity: 2 }),
      ],
      attachments: [],
    });
    expect(res.status).toBe(200);

    const items = (await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, "PO-1"))).sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "POI-1",
      quantity: 3,
      salesOrderItemId: "SOI-1",
      answeredDeliveryDate: "2026-11-10",
    });
    expect(items[1].id).not.toBe("POI-1");
  });

  it("他の伝票から参照されている明細を削除しようとすると400で止まり、何も変わらない", async () => {
    await seedPurchaseOrderWithItems("PO-1", [{ id: "POI-1" }], "DRAFT");
    await seedItemAttachment("PO-1", "POI-1");

    const res = await callUpdateOrder("PO-1", {
      orderDate: "2026-10-18",
      partnerId: "P-1",
      title: "変更後",
      items: [item({ quantity: 9 })],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("発注の添付");

    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, "PO-1"));
    expect(items.map((i) => i.id)).toEqual(["POI-1"]);
    expect(items[0].quantity).toBe(1);
    const order = await db.select().from(schema.orders).where(eq(schema.orders.id, "PO-1"));
    expect(order[0].title).toBe("発注PO-1");
  });

  it("変更申請の承認確定(applyApprovedUpdate)でも明細IDが保たれる", async () => {
    await seedSalesOrderWithItems("SO-1", [{ id: "SOI-1" }]);
    await seedPurchaseOrderWithItems("PO-1", [{ id: "POI-1", salesOrderItemId: "SOI-1" }]);
    const repo = PurchaseOrderRepository.fromDb(db);

    const rows = await repo.buildSyncedItemRows("PO-1", [
      { id: "POI-1", itemId: "ITEM-1", quantity: 4, unitPrice: 1000, salesOrderItemId: "SOI-1" },
    ]);
    await repo.applyApprovedUpdate("PO-1", { status: "APPROVED" }, rows);

    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, "PO-1"));
    expect(items.map((i) => i.id)).toEqual(["POI-1"]);
    expect(items[0].quantity).toBe(4);
    expect(items[0].salesOrderItemId).toBe("SOI-1");
  });
});

// 2026-10-18: 発注の保存で添付の行(ID・種類・登録者・明細とのつながり)を保つ
describe("発注の保存で添付の行を保つ", () => {
  const baseOrder = {
    orderDate: "2026-10-18",
    partnerId: "P-1",
    items: [{ id: "POI-1", itemId: "ITEM-1", itemName: "品目1", quantity: 1, unitPrice: 1000 }],
  };

  async function seedAttachments() {
    await seedPurchaseOrderWithItems("PO-1", [{ id: "POI-1" }], "DRAFT");
    const uploadedAt = new Date("2026-10-01T00:00:00Z");
    await db.insert(schema.orderAttachments).values([
      {
        id: "ATT-PDF",
        orderId: "PO-1",
        orderItemId: null,
        fileName: "発注書.pdf",
        storageType: "R2",
        attachmentR2Path: "purchase-orders/PO-1/order.pdf",
        fileType: "PDF",
        uploadedById: "system",
        uploadedAt,
      },
      {
        id: "ATT-ITEM",
        orderId: "PO-1",
        orderItemId: "POI-1",
        fileName: "仕様書",
        storageType: "GOOGLE_DRIVE",
        externalUrl: "https://example.com/spec",
        fileType: "OTHER",
        uploadedById: "system",
        uploadedAt,
      },
    ]);
  }

  async function findAttachments() {
    return (await db.select().from(schema.orderAttachments).where(eq(schema.orderAttachments.orderId, "PO-1"))).sort(
      (a, b) => a.id.localeCompare(b.id),
    );
  }

  it("画面から送られた既存の添付は、ID・種類・登録者・明細とのつながりを保ったまま保存される", async () => {
    await seedAttachments();
    const res = await callUpdateOrder("PO-1", {
      ...baseOrder,
      attachments: [
        { id: "ATT-PDF", fileName: "発注書.pdf", storageType: "R2", attachmentR2Path: "purchase-orders/PO-1/order.pdf" },
        { id: "ATT-ITEM", fileName: "仕様書(改)", storageType: "GOOGLE_DRIVE", externalUrl: "https://example.com/spec2" },
      ],
    });
    expect(res.status).toBe(200);

    const atts = await findAttachments();
    expect(atts.map((a) => a.id)).toEqual(["ATT-ITEM", "ATT-PDF"]);
    expect(atts[1]).toMatchObject({ fileType: "PDF", uploadedById: "system", attachmentR2Path: "purchase-orders/PO-1/order.pdf" });
    expect(atts[0]).toMatchObject({
      orderItemId: "POI-1",
      fileName: "仕様書(改)",
      externalUrl: "https://example.com/spec2",
      uploadedById: "system",
    });
  });

  it("IDを送らない従来の画面からの保存でも、R2のパスで対応付けて行を保つ。送られなかった添付は削除される", async () => {
    await seedAttachments();
    const res = await callUpdateOrder("PO-1", {
      ...baseOrder,
      attachments: [{ fileName: "発注書.pdf", storageType: "R2", attachmentR2Path: "purchase-orders/PO-1/order.pdf" }],
    });
    expect(res.status).toBe(200);

    const atts = await findAttachments();
    expect(atts.map((a) => a.id)).toEqual(["ATT-PDF"]);
    expect(atts[0].fileType).toBe("PDF");
  });

  it("新しい共有リンクは新しい行として追加される", async () => {
    await seedAttachments();
    await callUpdateOrder("PO-1", {
      ...baseOrder,
      attachments: [
        { id: "ATT-PDF", fileName: "発注書.pdf", storageType: "R2", attachmentR2Path: "purchase-orders/PO-1/order.pdf" },
        { id: "ATT-ITEM", fileName: "仕様書", storageType: "GOOGLE_DRIVE", externalUrl: "https://example.com/spec" },
        { fileName: "図面", storageType: "GOOGLE_DRIVE", externalUrl: "https://example.com/drawing" },
      ],
    });
    const atts = await findAttachments();
    expect(atts).toHaveLength(3);
    const added = atts.find((a) => a.fileName === "図面");
    expect(added).toMatchObject({ fileType: "OTHER", uploadedById: "buyer-1", orderItemId: null });
  });
});
