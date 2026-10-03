import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq, asc } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import { purchaseOrdersRouter } from "./index";

// #14-2⑥: 元々1189行あったpurchase-order.service.test.tsから、CSV入出力(ダウンロード・インポート、
// 明細の並び順保持)の部分を分割したもの。ロジック変更なし。ヘルパー関数は既存の慣習
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

describe("CSV入出力", () => {
  it("CSVダウンロードに登録済みの発注(仕入先含む)と明細が出力される", async () => {
    await seedUnit("PCS");
    await seedAccount("ACC-1");
    await seedPartner("PARTNER-1");
    await callCreateOrder("buyer-1", {
      id: "PO-CSV-1",
      title: "CSV確認用",
      partnerId: "PARTNER-1",
      orderDate: now.toISOString(),
      items: [{ itemId: "ITEM-1", quantity: 2, unitPrice: 1000 }],
    });

    const ctx = createExecutionContext();
    const res = await purchaseOrdersRouter.request(
      "/csv-download",
      { headers: { Cookie: await buildSessionCookieHeader("buyer-1") } },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"PO-CSV-1"');
    expect(text).toContain('"ITEM-1"');
    expect(text).toContain('"PARTNER-1"');
  });

  it("CSVインポートで新規の発注と明細が作成される", async () => {
    const csvHeader = "id,partnerId,title,orderDate,status,totalAmount,memo,itemId,quantity,unitPrice,itemMemo";
    const csvRow = "PO-CSV-IMPORT-1,,インポート確認,,DRAFT,3000,,ITEM-1,3,1000,";
    const csvText = `${csvHeader}\n${csvRow}\n`;

    const formData = new FormData();
    formData.append("file", new File([csvText], "purchase_orders.csv", { type: "text/csv" }));

    const ctx = createExecutionContext();
    const res = await purchaseOrdersRouter.request(
      "/bulk-register",
      {
        method: "POST",
        headers: { Cookie: await buildSessionCookieHeader("importer-1") },
        body: formData,
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);

    const order = await findOrder("PO-CSV-IMPORT-1");
    expect(order?.title).toBe("インポート確認");
    expect(order?.createdBy).toBe("importer-1");

    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, "PO-CSV-IMPORT-1"));
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
  });

  it("CSVインポートで同一発注の複数明細がCSVの行順どおりsortOrderに反映される", async () => {
    const csvHeader = "id,partnerId,title,orderDate,status,totalAmount,memo,itemId,quantity,unitPrice,itemMemo";
    const csvText = [
      csvHeader,
      "PO-CSV-SORT-1,,並び順確認,,DRAFT,6000,,ITEM-A,1,1000,",
      "PO-CSV-SORT-1,,並び順確認,,DRAFT,6000,,ITEM-B,2,1000,",
      "PO-CSV-SORT-1,,並び順確認,,DRAFT,6000,,ITEM-C,3,1000,",
      "",
    ].join("\n");

    const formData = new FormData();
    formData.append("file", new File([csvText], "purchase_orders.csv", { type: "text/csv" }));

    const ctx = createExecutionContext();
    const res = await purchaseOrdersRouter.request(
      "/bulk-register",
      {
        method: "POST",
        headers: { Cookie: await buildSessionCookieHeader("importer-1") },
        body: formData,
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);

    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, "PO-CSV-SORT-1"))
      .orderBy(asc(schema.orderItems.sortOrder));
    expect(items).toHaveLength(3);
    // sortOrderが0固定だと並びが不定になるため、行順が保持されていることを確認する
    expect(items.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
    expect(items.map((i) => i.itemId)).toEqual(["ITEM-A", "ITEM-B", "ITEM-C"]);
  });
});
