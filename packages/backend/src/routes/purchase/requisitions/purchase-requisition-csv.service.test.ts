import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { asc, eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import { purchaseRequisitionsRouter } from "./index";

// #14-2⑥: purchase-requisition.service.test.tsから分割(purchase-requisition-csv.service.tsに対応)。
// ロジック変更なし、ファイル分割のみ。ヘルパー関数は既存の慣習(payment-crud.test.ts/
// payment-csv.test.ts)にならい、purchase-requisition-crud.service.test.tsと重複して定義している。

const db = drizzle(env.DB, { schema });
const now = new Date();

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

async function callCreateRequisition(actorUserId: string, payload: unknown) {
  const formData = new FormData();
  formData.append("requisitionData", JSON.stringify(payload));
  const ctx = createExecutionContext();
  const res = await purchaseRequisitionsRouter.request(
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

async function seedItem(id: string, baseUnitCode: string) {
  await db.insert(schema.items).values({
    id,
    name: `品目${id}`,
    baseUnitCode,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

async function findRequisition(id: string) {
  const rows = await db
    .select()
    .from(schema.purchaseRequests)
    .where(eq(schema.purchaseRequests.id, id));
  return rows[0] ?? null;
}

beforeEach(async () => {
  await db.delete(schema.purchaseRequestAttachments);
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
  await db.delete(schema.accounts);
  await db.delete(schema.units);
  await db.delete(schema.partners);
  await db.delete(schema.taxCategories);
  await env.COMPANY_SETTINGS.delete("config");

  await seedUser("applicant-1");
  await seedDepartment("dept-a", "D001", "資材部");
});

describe("CSV入出力", () => {
  it("CSVダウンロードに登録済みの購買申請(仕入先含む)と明細が出力される", async () => {
    await seedUnit("PCS");
    await seedAccount("ACC-1");
    await seedItem("ITEM-1", "PCS");
    await seedPartner("PARTNER-1");
    await callCreateRequisition("applicant-1", {
      id: "PR-CSV-1",
      title: "CSV確認用",
      departmentSurrogateId: "dept-a",
      requestType: "PERIODIC",
      partnerId: "PARTNER-1",
      partnerInputType: "MASTER",
      items: [
        { itemId: "ITEM-1", quantity: 2, estimatedUnitPrice: 1000, accountCode: "ACC-1" },
      ],
    });

    const ctx = createExecutionContext();
    const res = await purchaseRequisitionsRouter.request(
      "/csv-download",
      { headers: { Cookie: await buildSessionCookieHeader("applicant-1") } },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"PR-CSV-1"');
    expect(text).toContain('"ITEM-1"');
    expect(text).toContain('"PERIODIC"');
    expect(text).toContain('"PARTNER-1"');
  });

  it("CSVインポートで新規の購買申請と明細が作成される", async () => {
    await seedUnit("PCS");
    await seedAccount("ACC-1");
    await seedItem("ITEM-1", "PCS");

    const csvHeader =
      "id,title,departmentSurrogateId,applicantId,requestType,status,totalAmount,memo,itemId,quantity,estimatedUnitPrice,accountCode,itemMemo";
    const csvRow =
      "PR-CSV-IMPORT-1,インポート確認,dept-a,applicant-1,ONE_TIME,DRAFT,3000,,ITEM-1,3,1000,ACC-1,";
    const csvText = `${csvHeader}\n${csvRow}\n`;

    const formData = new FormData();
    formData.append("file", new File([csvText], "purchase_requisitions.csv", { type: "text/csv" }));

    const ctx = createExecutionContext();
    const res = await purchaseRequisitionsRouter.request(
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

    const requisition = await findRequisition("PR-CSV-IMPORT-1");
    expect(requisition?.title).toBe("インポート確認");
    expect(requisition?.createdBy).toBe("importer-1");

    const items = await db
      .select()
      .from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, "PR-CSV-IMPORT-1"));
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
  });

  it("CSVインポートでdepartmentSurrogateId列に部署コード(id)を指定した場合もsurrogateIdへ解決される", async () => {
    await seedUnit("PCS");
    await seedAccount("ACC-1");
    await seedItem("ITEM-1", "PCS");

    const csvHeader =
      "id,title,departmentSurrogateId,applicantId,requestType,status,totalAmount,memo,itemId,quantity,estimatedUnitPrice,accountCode,itemMemo";
    // "D001"はseedDepartment("dept-a", "D001", ...)の部署コード(id)。surrogateIdではない値。
    const csvRow =
      "PR-CSV-IMPORT-DEPTCODE-1,部署コード解決確認,D001,applicant-1,ONE_TIME,DRAFT,3000,,ITEM-1,3,1000,ACC-1,";
    const csvText = `${csvHeader}\n${csvRow}\n`;

    const formData = new FormData();
    formData.append("file", new File([csvText], "purchase_requisitions.csv", { type: "text/csv" }));

    const ctx = createExecutionContext();
    const res = await purchaseRequisitionsRouter.request(
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

    const requisition = await findRequisition("PR-CSV-IMPORT-DEPTCODE-1");
    expect(requisition?.departmentSurrogateId).toBe("dept-a");
  });

  it("CSVインポートでdepartmentSurrogateId列が未知の値の場合、その行はスキップされFK違反にならない", async () => {
    await seedUnit("PCS");
    await seedAccount("ACC-1");
    await seedItem("ITEM-1", "PCS");

    const csvHeader =
      "id,title,departmentSurrogateId,applicantId,requestType,status,totalAmount,memo,itemId,quantity,estimatedUnitPrice,accountCode,itemMemo";
    const csvRow =
      "PR-CSV-IMPORT-UNKNOWNDEPT-1,不明部署確認,NOT-EXIST-DEPT,applicant-1,ONE_TIME,DRAFT,3000,,ITEM-1,3,1000,ACC-1,";
    const csvText = `${csvHeader}\n${csvRow}\n`;

    const formData = new FormData();
    formData.append("file", new File([csvText], "purchase_requisitions.csv", { type: "text/csv" }));

    const ctx = createExecutionContext();
    const res = await purchaseRequisitionsRouter.request(
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

    const requisition = await findRequisition("PR-CSV-IMPORT-UNKNOWNDEPT-1");
    expect(requisition).toBeNull();
  });

  it("Phase3フォローアップ: CSVダウンロードにitemName/inputTypeが含まれ、DIRECT品目もインポートで復元できる", async () => {
    await seedAccount("ACC-1");
    await callCreateRequisition("applicant-1", {
      id: "PR-CSV-DIRECT-1",
      title: "CSV手入力確認用",
      departmentSurrogateId: "dept-a",
      requestType: "ONE_TIME",
      items: [
        {
          itemId: "FREE-CODE-2",
          itemName: "CSV自由入力品",
          inputType: "DIRECT",
          quantity: 1,
          estimatedUnitPrice: 500,
          accountCode: "ACC-1",
        },
      ],
    });

    const exportCtx = createExecutionContext();
    const exportRes = await purchaseRequisitionsRouter.request(
      "/csv-download",
      { headers: { Cookie: await buildSessionCookieHeader("applicant-1") } },
      env,
      exportCtx,
    );
    await waitOnExecutionContext(exportCtx);
    const csvText = await exportRes.text();
    expect(csvText).toContain('"CSV自由入力品"');
    expect(csvText).toContain('"DIRECT"');

    const csvHeader =
      "id,title,departmentSurrogateId,applicantId,requestType,status,totalAmount,memo,itemId,itemName,inputType,quantity,estimatedUnitPrice,accountCode,itemMemo";
    const csvRow =
      "PR-CSV-DIRECT-2,インポート手入力確認,dept-a,applicant-1,ONE_TIME,DRAFT,500,,FREE-CODE-3,インポート自由品目,DIRECT,1,500,ACC-1,";
    const importCsvText = `${csvHeader}\n${csvRow}\n`;
    const formData = new FormData();
    formData.append(
      "file",
      new File([importCsvText], "purchase_requisitions.csv", { type: "text/csv" }),
    );

    const importCtx = createExecutionContext();
    const importRes = await purchaseRequisitionsRouter.request(
      "/bulk-register",
      {
        method: "POST",
        headers: { Cookie: await buildSessionCookieHeader("importer-1") },
        body: formData,
      },
      env,
      importCtx,
    );
    await waitOnExecutionContext(importCtx);
    expect(importRes.status).toBe(200);

    const items = await db
      .select()
      .from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, "PR-CSV-DIRECT-2"));
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe("FREE-CODE-3");
    expect(items[0].itemName).toBe("インポート自由品目");
    expect(items[0].inputType).toBe("DIRECT");
  });

  it("CSVインポートで同一購買申請の複数明細がCSVの行順どおりsortOrderに反映される", async () => {
    await seedUnit("PCS");
    await seedAccount("ACC-1");
    await seedItem("ITEM-A", "PCS");
    await seedItem("ITEM-B", "PCS");
    await seedItem("ITEM-C", "PCS");

    const csvHeader =
      "id,title,departmentSurrogateId,applicantId,requestType,status,totalAmount,memo,itemId,quantity,estimatedUnitPrice,accountCode,itemMemo";
    const row = (itemId: string, quantity: number) =>
      `PR-CSV-SORT-1,並び順確認,dept-a,applicant-1,ONE_TIME,DRAFT,6000,,${itemId},${quantity},1000,ACC-1,`;
    const csvText = [csvHeader, row("ITEM-A", 1), row("ITEM-B", 2), row("ITEM-C", 3), ""].join("\n");

    const formData = new FormData();
    formData.append("file", new File([csvText], "purchase_requisitions.csv", { type: "text/csv" }));

    const ctx = createExecutionContext();
    const res = await purchaseRequisitionsRouter.request(
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
      .from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, "PR-CSV-SORT-1"))
      .orderBy(asc(schema.purchaseRequestItems.sortOrder));
    expect(items).toHaveLength(3);
    // sortOrderが0固定だと並びが不定になるため、行順が保持されていることを確認する
    expect(items.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
    expect(items.map((i) => i.itemId)).toEqual(["ITEM-A", "ITEM-B", "ITEM-C"]);
  });
});
