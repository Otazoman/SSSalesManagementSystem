import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import { purchaseOrdersRouter } from "./index";

// #14-2⑥: 元々1189行あったpurchase-order.service.test.tsから、基本CRUD(POST /register・PUT/DELETE
// のステータスガード・明細行登録と合計金額の自動計算・消費税計算・仕入先選択・関連する発注一覧
// 検索(注残有無))の部分を分割したもの。ロジック変更なし。ヘルパー関数は既存の慣習
// (payment-crud.test.ts/payment-csv.test.ts、sales-order-crud/workflow.service.test.ts)にならい、
// 分割後の各ファイルにそのまま複製している(共通ファイル化はしない)。

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

async function callCreateOrder(actorUserId: string, payload: unknown) {
  const formData = new FormData();
  formData.append("orderData", JSON.stringify(payload));
  const ctx = createExecutionContext();
  const res = await purchaseOrdersRouter.request(
    "/register",
    {
      method: "POST",
      headers: { Cookie: await buildSessionCookieHeader(actorUserId) },
      body: formData,
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function callUpdateOrder(id: string, actorUserId: string, payload: unknown) {
  const formData = new FormData();
  formData.append("orderData", JSON.stringify(payload));
  const ctx = createExecutionContext();
  const res = await purchaseOrdersRouter.request(
    `/${id}`,
    {
      method: "PUT",
      headers: { Cookie: await buildSessionCookieHeader(actorUserId) },
      body: formData,
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function callDeleteOrder(id: string, actorUserId: string) {
  const ctx = createExecutionContext();
  const res = await purchaseOrdersRouter.request(
    `/${id}`,
    { method: "DELETE", headers: { Cookie: await buildSessionCookieHeader(actorUserId) } },
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

async function seedDepartment(surrogateId: string, id: string, name: string) {
  await db.insert(schema.departments).values({
    surrogateId,
    id,
    name,
    validFrom: now,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

async function seedRequisition(
  id: string,
  overrides: Partial<typeof schema.purchaseRequests.$inferInsert> = {},
) {
  await db.insert(schema.purchaseRequests).values({
    id,
    title: `購買申請${id}`,
    departmentSurrogateId: "dept-a",
    applicantId: "applicant-1",
    requestType: "ONE_TIME",
    status: "DRAFT",
    totalAmount: 10000,
    createdBy: "applicant-1",
    createdAt: now,
    updatedBy: "applicant-1",
    updatedAt: now,
    ...overrides,
  });
}

async function seedOrder(id: string, overrides: Partial<typeof schema.orders.$inferInsert> = {}) {
  await db.insert(schema.orders).values({
    id,
    title: `発注${id}`,
    orderDate: now,
    status: "DRAFT",
    totalAmount: 10000,
    taxAmount: 0,
    createdBy: "buyer-1",
    createdAt: now,
    updatedBy: "buyer-1",
    updatedAt: now,
    ...overrides,
  });
}

async function seedUnit(code: string) {
  await db.insert(schema.units).values({
    code,
    name: code,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

async function seedAccount(code: string) {
  await db.insert(schema.accounts).values({
    code,
    name: `科目${code}`,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

async function seedProject(id: string) {
  await db.insert(schema.projects).values({
    id,
    name: `プロジェクト${id}`,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

// 新規要望(2026-09-23): 発注の納品場所(拠点/倉庫)選択のFK先シード
async function seedBusinessLocation(id: string) {
  await db.insert(schema.businessLocations).values({
    id,
    name: `拠点${id}`,
    status: "active",
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

async function seedWarehouse(id: string) {
  await db.insert(schema.warehouses).values({
    id,
    name: `倉庫${id}`,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

async function seedPartner(id: string, type = "SUPPLIER") {
  await db.insert(schema.partners).values({
    id,
    name: `仕入先${id}`,
    type,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

async function seedTaxCategory(code: string, taxType: "EXEMPT" | "STANDARD" | "VARIABLE", taxRate: number) {
  await db.insert(schema.taxCategories).values({ code, name: code, taxType, taxRate });
}

async function seedRequisitionItem(
  requestId: string,
  overrides: Partial<typeof schema.purchaseRequestItems.$inferInsert> = {},
) {
  await db.insert(schema.purchaseRequestItems).values({
    id: `${requestId}-item-${Math.random().toString(36).slice(2, 8)}`,
    requestId,
    itemId: "ITEM-1",
    quantity: 1,
    estimatedUnitPrice: 1000,
    inputType: "MASTER",
    sortOrder: 0,
    ...overrides,
  });
}

async function enablePurchaseOrderApprovalWorkflow() {
  await env.COMPANY_SETTINGS.put("config", JSON.stringify({ is_purchase_order_approval_enabled: true }));
}

async function findOrder(id: string) {
  const rows = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
  return rows[0] ?? null;
}

beforeEach(async () => {
  await db.delete(schema.orderAttachments);
  // 追加要望対応: purchaseRecognitionItems.sourceOrderItemIdがorderItems.idをFK参照するため、
  // orderItemsを消す前に削除する必要がある
  await db.delete(schema.purchaseRecognitionItems);
  await db.delete(schema.purchaseRecognitions);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
  // 新規要望(2026-09-23): ordersがFK参照するため、ordersの削除より後に消す必要がある
  await db.delete(schema.businessLocations);
  await db.delete(schema.warehouses);
  await db.delete(schema.purchaseRequestItems);
  await db.delete(schema.purchaseRequests);
  await db.delete(schema.masterApprovalContexts);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.workflowLogs);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.userRoles);
  await db.delete(schema.departments);
  await db.delete(schema.roles);
  await db.delete(schema.users);
  await db.delete(schema.items);
  // journal_posting_rulesがaccountsをFK参照するため、accountsの削除より先に消す必要がある
  await db.delete(schema.journalPostingEvents);
  await db.delete(schema.journalPostingRules);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
  await db.delete(schema.partners);
  await db.delete(schema.taxCategories);
  await env.COMPANY_SETTINGS.delete("config");

  await seedUser("buyer-1");
  await seedDepartment("dept-a", "D001", "資材部");
});

describe("POST /register", () => {
  it("承認機能OFFかつrequestIdなしでも新規登録は自動採番されたIDでDRAFTとして作成される", async () => {
    const res = await callCreateOrder("buyer-1", {
      title: "事務用品発注",
      orderDate: now.toISOString(),
      items: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^PO-\d{4}$/);
    const order = await findOrder(body.id);
    expect(order?.status).toBe("DRAFT");
  });

  it("新規要望(2026-09-23): 納品場所の拠点/倉庫選択(deliveryLocationId/deliveryWarehouseId)を保存できる", async () => {
    await seedBusinessLocation("BL-1");
    const res = await callCreateOrder("buyer-1", {
      title: "納品場所指定発注",
      orderDate: now.toISOString(),
      deliveryPlace: "東京営業所",
      deliveryLocationId: "BL-1",
      items: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    const order = await findOrder(body.id);
    expect(order?.deliveryPlace).toBe("東京営業所");
    expect(order?.deliveryLocationId).toBe("BL-1");
    expect(order?.deliveryWarehouseId).toBeNull();
  });

  it("承認機能ON時、requestId未指定では作成できない(400)", async () => {
    await enablePurchaseOrderApprovalWorkflow();
    const res = await callCreateOrder("buyer-1", {
      title: "requestIdなし発注",
      orderDate: now.toISOString(),
      items: [],
    });
    expect(res.status).toBe(400);
  });

  it("承認機能ON時、requestId指定でも参照先がAPPROVEDでなければ作成できない(400)", async () => {
    await enablePurchaseOrderApprovalWorkflow();
    await seedRequisition("PR-1", { status: "DRAFT" });
    const res = await callCreateOrder("buyer-1", {
      title: "未承認requestId",
      requestId: "PR-1",
      orderDate: now.toISOString(),
      items: [],
    });
    expect(res.status).toBe(400);
  });

  it("承認機能ON時、requestIdの参照先がAPPROVEDなら作成できる", async () => {
    await enablePurchaseOrderApprovalWorkflow();
    await seedRequisition("PR-1", { status: "APPROVED" });
    const res = await callCreateOrder("buyer-1", {
      title: "承認済みrequestId",
      requestId: "PR-1",
      orderDate: now.toISOString(),
      items: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect((await findOrder(body.id))?.requestId).toBe("PR-1");
  });

  it("購買申請から発注を作成する場合、itemsを省略すると購買申請明細から自動組み立てされる", async () => {
    await seedRequisition("PR-COPY-1", { status: "APPROVED" });
    await seedRequisitionItem("PR-COPY-1", {
      itemId: "ITEM-1",
      quantity: 5,
      estimatedUnitPrice: 800,
    });

    const res = await callCreateOrder("buyer-1", {
      id: "PO-COPY-1",
      title: "購買申請からのコピー",
      requestId: "PR-COPY-1",
      orderDate: now.toISOString(),
    });
    expect(res.status).toBe(200);

    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, "PO-COPY-1"));
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(5);
    expect(items[0].unitPrice).toBe(800);
    expect(items[0].purchaseRequestItemId).not.toBeNull();
  });

  it("K-2-b: 購買申請明細の勘定科目が発注明細へ引き継がれる", async () => {
    await seedAccount("ACC-K2B");
    await seedRequisition("PR-COPY-2", { status: "APPROVED" });
    await seedRequisitionItem("PR-COPY-2", {
      itemId: "ITEM-1",
      quantity: 2,
      estimatedUnitPrice: 500,
      accountCode: "ACC-K2B",
    });

    const res = await callCreateOrder("buyer-1", {
      id: "PO-COPY-2",
      title: "購買申請からのコピー(勘定科目引き継ぎ)",
      requestId: "PR-COPY-2",
      orderDate: now.toISOString(),
    });
    expect(res.status).toBe(200);

    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, "PO-COPY-2"));
    expect(items).toHaveLength(1);
    expect(items[0].accountCode).toBe("ACC-K2B");
  });
});

describe("PUT /:id のステータスガード", () => {
  it("DRAFTの発注は通常通り直接更新できる", async () => {
    await seedOrder("PO-1", { status: "DRAFT" });
    const res = await callUpdateOrder("PO-1", "buyer-1", {
      title: "更新後タイトル",
      orderDate: now.toISOString(),
      items: [],
    });
    expect(res.status).toBe(200);
    expect((await findOrder("PO-1"))?.title).toBe("更新後タイトル");
  });

  it("新規要望(2026-09-23): 納品場所の倉庫選択(deliveryWarehouseId)を更新できる", async () => {
    await seedWarehouse("WH-1");
    await seedOrder("PO-1", { status: "DRAFT" });
    const res = await callUpdateOrder("PO-1", "buyer-1", {
      title: "更新後タイトル",
      orderDate: now.toISOString(),
      deliveryPlace: "本社倉庫",
      deliveryWarehouseId: "WH-1",
      items: [],
    });
    expect(res.status).toBe(200);
    const order = await findOrder("PO-1");
    expect(order?.deliveryPlace).toBe("本社倉庫");
    expect(order?.deliveryWarehouseId).toBe("WH-1");
  });

  it("承認機能ONの場合、PENDING_APPROVAL中は直接更新できない(400)", async () => {
    await enablePurchaseOrderApprovalWorkflow();
    await seedOrder("PO-1", { status: "PENDING_APPROVAL" });
    const res = await callUpdateOrder("PO-1", "buyer-1", {
      title: "更新後タイトル",
      orderDate: now.toISOString(),
      items: [],
    });
    expect(res.status).toBe(400);
  });

  it("承認機能ONの場合、APPROVED済みは直接更新できない(400、変更申請への案内)", async () => {
    await enablePurchaseOrderApprovalWorkflow();
    await seedOrder("PO-1", { status: "APPROVED" });
    const res = await callUpdateOrder("PO-1", "buyer-1", {
      title: "更新後タイトル",
      orderDate: now.toISOString(),
      items: [],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("/api/approvals/request-update");
  });

  it("承認機能OFFの場合、APPROVED済みも直接更新できる", async () => {
    await seedOrder("PO-1", { status: "APPROVED" });
    const res = await callUpdateOrder("PO-1", "buyer-1", {
      title: "OFF時は直接更新可",
      orderDate: now.toISOString(),
      items: [],
    });
    expect(res.status).toBe(200);
    expect((await findOrder("PO-1"))?.title).toBe("OFF時は直接更新可");
  });
});

describe("DELETE /:id のステータスガード", () => {
  it("DRAFTの発注は直接削除できる", async () => {
    await seedOrder("PO-1", { status: "DRAFT" });
    const res = await callDeleteOrder("PO-1", "buyer-1");
    expect(res.status).toBe(200);
    expect(await findOrder("PO-1")).toBeNull();
  });

  it("APPROVED済みは直接削除できない(400)", async () => {
    await seedOrder("PO-1", { status: "APPROVED" });
    const res = await callDeleteOrder("PO-1", "buyer-1");
    expect(res.status).toBe(400);
    expect(await findOrder("PO-1")).not.toBeNull();
  });
});

describe("明細行(order_items)の登録・合計金額の自動計算", () => {
  it("明細を含めて登録すると、totalAmountは税込(明細のquantity*unitPriceの合計+消費税)になる", async () => {
    await seedUnit("PCS");
    await seedProject("PJ-1");

    const res = await callCreateOrder("buyer-1", {
      id: "PO-ITEM-1",
      title: "備品発注",
      orderDate: now.toISOString(),
      projectId: "PJ-1",
      items: [{ itemId: "ITEM-1", quantity: 3, unitPrice: 1500 }],
    });
    expect(res.status).toBe(200);

    const order = await findOrder("PO-ITEM-1");
    // 税区分未指定は10%扱い: 4500 + 450 = 4950
    expect(order?.totalAmount).toBe(4950);
    expect(order?.taxAmount).toBe(450);
    expect(order?.projectId).toBe("PJ-1");

    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, "PO-ITEM-1"));
    expect(items).toHaveLength(1);
    expect(items[0].inputType).toBe("MASTER");
  });

  it("手入力(DIRECT)の品目は、itemsマスタに存在しないitemId+itemNameでも登録できる", async () => {
    const res = await callCreateOrder("buyer-1", {
      id: "PO-DIRECT-1",
      title: "マスタ外品の発注",
      orderDate: now.toISOString(),
      items: [
        {
          itemId: "FREE-CODE-1",
          itemName: "自由入力の品目名",
          inputType: "DIRECT",
          quantity: 2,
          unitPrice: 2000,
        },
      ],
    });
    expect(res.status).toBe(200);

    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, "PO-DIRECT-1"));
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe("FREE-CODE-1");
    expect(items[0].itemName).toBe("自由入力の品目名");
    expect(items[0].inputType).toBe("DIRECT");
  });
});

describe("消費税計算(見積のcalcTaxBreakdownと同じ税率別内訳)", () => {
  it("明細ごとのtaxCategoryCodeに応じて10%/8%/非課税を按分し、totalAmountに反映する", async () => {
    await seedTaxCategory("TAX_10", "STANDARD", 0.1);
    await seedTaxCategory("TAX_8", "STANDARD", 0.08);
    await seedTaxCategory("TAX_0", "EXEMPT", 0);

    const res = await callCreateOrder("buyer-1", {
      id: "PO-TAX-1",
      title: "税率混在確認",
      orderDate: now.toISOString(),
      items: [
        { itemId: "FREE-A", inputType: "DIRECT", itemName: "10%品", quantity: 1, unitPrice: 1000, taxCategoryCode: "TAX_10" },
        { itemId: "FREE-B", inputType: "DIRECT", itemName: "8%品", quantity: 1, unitPrice: 1000, taxCategoryCode: "TAX_8" },
        { itemId: "FREE-C", inputType: "DIRECT", itemName: "非課税品", quantity: 1, unitPrice: 1000, taxCategoryCode: "TAX_0" },
      ],
    });
    expect(res.status).toBe(200);

    const order = await findOrder("PO-TAX-1");
    // 税額: 1000*0.1 + 1000*0.08 + 0 = 180、合計: 3000 + 180 = 3180
    expect(order?.taxAmount).toBe(180);
    expect(order?.totalAmount).toBe(3180);
  });
});

describe("仕入先(partnersマスタ選択)", () => {
  it("partnerIdを指定すると発注に保存される", async () => {
    await seedPartner("PARTNER-1");

    const res = await callCreateOrder("buyer-1", {
      id: "PO-PARTNER-1",
      title: "仕入先指定確認",
      partnerId: "PARTNER-1",
      orderDate: now.toISOString(),
      items: [],
    });
    expect(res.status).toBe(200);
    expect((await findOrder("PO-PARTNER-1"))?.partnerId).toBe("PARTNER-1");
  });
});

async function callSearchOrders(actorUserId: string, query: string) {
  const ctx = createExecutionContext();
  const res = await purchaseOrdersRouter.request(
    `/?${query}`,
    { method: "GET", headers: { Cookie: await buildSessionCookieHeader(actorUserId) } },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function seedOrderItem(
  orderId: string,
  overrides: Partial<typeof schema.orderItems.$inferInsert> = {},
) {
  await db.insert(schema.orderItems).values({
    id: crypto.randomUUID(),
    orderId,
    itemId: "ITEM-1",
    itemName: "テスト品目",
    quantity: 1,
    unitPrice: 1000,
    sortOrder: 0,
    ...overrides,
  });
}

describe("追加要望: 発注一覧の検索で注残(仕入計上が未済)の有無で絞り込める", () => {
  async function seedApprovedRecognition(
    id: string,
    overrides: Partial<typeof schema.purchaseRecognitions.$inferInsert> = {},
  ) {
    await db.insert(schema.purchaseRecognitions).values({
      id,
      partnerId: "SUPP-1",
      recognitionDate: now,
      status: "APPROVED",
      documentType: "PURCHASE",
      totalAmount: 0,
      taxAmount: 0,
      createdBy: "buyer-1",
      createdAt: now,
      updatedBy: "buyer-1",
      updatedAt: now,
      ...overrides,
    });
  }

  beforeEach(async () => {
    await seedPartner("SUPP-1");
  });

  it("hasUnrecognizedPurchase=trueを指定すると、発注数量に対して仕入計上(APPROVED)が満たない発注のみ返る", async () => {
    await seedOrder("PO-unrecognized", { status: "APPROVED", partnerId: "SUPP-1" });
    await seedOrderItem("PO-unrecognized", { id: "OI-unrecognized", orderId: "PO-unrecognized", quantity: 10 });

    await seedOrder("PO-fully-recognized", { status: "APPROVED", partnerId: "SUPP-1" });
    await seedOrderItem("PO-fully-recognized", {
      id: "OI-fully-recognized",
      orderId: "PO-fully-recognized",
      quantity: 10,
    });
    await seedApprovedRecognition("PR-full");
    await db.insert(schema.purchaseRecognitionItems).values({
      id: "PRI-full",
      purchaseRecognitionId: "PR-full",
      sourceOrderItemId: "OI-fully-recognized",
      itemId: "ITEM-1",
      itemName: "テスト品目",
      quantity: 10,
      unitPrice: 100,
      amount: 1000,
      sortOrder: 0,
    });

    const res = await callSearchOrders("buyer-1", "hasUnrecognizedPurchase=true");
    expect(res.status).toBe(200);
    const orders = (await res.json()) as Array<{ id: string }>;
    expect(orders.map((o) => o.id)).toEqual(["PO-unrecognized"]);
  });

  it("DRAFT状態の仕入計上は消込に数えられず、注残ありのままになる", async () => {
    await seedOrder("PO-draft-recognition", { status: "APPROVED", partnerId: "SUPP-1" });
    await seedOrderItem("PO-draft-recognition", {
      id: "OI-draft-recognition",
      orderId: "PO-draft-recognition",
      quantity: 10,
    });
    await seedApprovedRecognition("PR-draft", { status: "DRAFT" });
    await db.insert(schema.purchaseRecognitionItems).values({
      id: "PRI-draft",
      purchaseRecognitionId: "PR-draft",
      sourceOrderItemId: "OI-draft-recognition",
      itemId: "ITEM-1",
      itemName: "テスト品目",
      quantity: 10,
      unitPrice: 100,
      amount: 1000,
      sortOrder: 0,
    });

    const res = await callSearchOrders("buyer-1", "hasUnrecognizedPurchase=true");
    expect(res.status).toBe(200);
    const orders = (await res.json()) as Array<{ id: string }>;
    expect(orders.map((o) => o.id)).toContain("PO-draft-recognition");
  });

  it("hasUnrecognizedPurchaseを指定しなければ全件返る", async () => {
    await seedOrder("PO-a", { status: "DRAFT", partnerId: "SUPP-1" });
    await seedOrder("PO-b", { status: "DRAFT", partnerId: "SUPP-1" });

    const res = await callSearchOrders("buyer-1", "");
    expect(res.status).toBe(200);
    const orders = (await res.json()) as Array<{ id: string }>;
    expect(orders.map((o) => o.id).sort()).toEqual(["PO-a", "PO-b"]);
  });
});
