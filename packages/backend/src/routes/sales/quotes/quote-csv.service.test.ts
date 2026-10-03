import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { signSessionToken } from "../../../platform/auth/session-token";
import { quotesRouter } from "./index";

// #14-2⑥: 元々1233行あったquote.service.test.tsから、Item4-d(自社担当者(salesPersonEmployeeNumber)・
// inputTypeの保存とCSVダウンロード/インポートへの反映)の部分を分割したもの。ロジック変更なし。
// ヘルパー関数は既存の慣習(payment-crud.test.ts/payment-csv.test.ts、
// sales-order-crud/workflow.service.test.ts)にならい、分割後の各ファイルにそのまま複製している
// (共通ファイル化はしない)。

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

async function callCreateQuote(actorUserId: string, payload: unknown) {
  const formData = new FormData();
  formData.append("quoteData", JSON.stringify(payload));
    const ctx = createExecutionContext();
  const _res = await quotesRouter.request(
    "/register",
    {
      method: "POST",
      headers: { Cookie: await buildSessionCookieHeader(actorUserId) },
      body: formData,
    },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

async function callExportCsv(actorUserId: string) {
    const ctx = createExecutionContext();
  const _res = await quotesRouter.request(
    "/csv-download",
    { headers: { Cookie: await buildSessionCookieHeader(actorUserId) } },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

async function callUpdateQuote(id: string, actorUserId: string, payload: unknown) {
  const formData = new FormData();
  formData.append("quoteData", JSON.stringify(payload));
    const ctx = createExecutionContext();
  const _res = await quotesRouter.request(
    `/${id}`,
    {
      method: "PUT",
      headers: { Cookie: await buildSessionCookieHeader(actorUserId) },
      body: formData,
    },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
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

async function seedPartner(id: string) {
  await db.insert(schema.partners).values({
    id,
    name: `取引先${id}`,
    createdBy: id,
    createdAt: now,
    updatedBy: id,
    updatedAt: now,
  });
}

async function seedQuote(
  id: string,
  overrides: Partial<typeof schema.quotes.$inferInsert> = {},
) {
  await db.insert(schema.quotes).values({
    id,
    title: `見積${id}`,
    partnerId: "partner-1",
    quoteDate: now,
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

async function findQuote(id: string) {
  const rows = await db.select().from(schema.quotes).where(eq(schema.quotes.id, id));
  return rows[0] ?? null;
}

beforeEach(async () => {
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  await db.delete(schema.quoteHistoryLogs);
  await db.delete(schema.quoteAttachments);
  await db.delete(schema.quoteItems);
  await db.delete(schema.quotes);
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

describe("Item4-d: 自社担当者(salesPersonEmployeeNumber)とinputTypeの保存・CSVダウンロード", () => {
  it("自社担当者は監査用のupdatedByとは別に保存され、他ユーザーが編集してもupdatedByだけが変わり自社担当者は書き換わらない", async () => {
    await seedUser("editor-2");

    const createRes = await callCreateQuote("applicant-1", {
      id: "Q-SP-1",
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      salesPersonEmployeeNumber: "applicant-1",
      items: [],
    });
    expect(createRes.status).toBe(200);

    let quote = await findQuote("Q-SP-1");
    expect(quote?.salesPersonEmployeeNumber).toBe("applicant-1");
    expect(quote?.createdBy).toBe("applicant-1");
    expect(quote?.updatedBy).toBe("applicant-1");

    // 別ユーザー(editor-2)が編集。自社担当者(applicant-1)はそのまま維持されるべき
    const updateRes = await callUpdateQuote("Q-SP-1", "editor-2", {
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      salesPersonEmployeeNumber: "applicant-1",
      title: "editor-2による編集",
      items: [],
    });
    expect(updateRes.status).toBe(200);

    quote = await findQuote("Q-SP-1");
    expect(quote?.salesPersonEmployeeNumber).toBe("applicant-1");
    expect(quote?.updatedBy).toBe("editor-2");
  });

  it("CSVダウンロードの担当者欄にemployeeNumberがそのまま出力される(UUID混入なし)", async () => {
    await callCreateQuote("applicant-1", {
      id: "Q-SP-2",
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      salesPersonEmployeeNumber: "applicant-1",
      items: [],
    });

    const res = await callExportCsv("applicant-1");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"Q-SP-2"');
    expect(text).toContain('"applicant-1"');
  });

  it("明細のinputType(MASTER/DIRECT)が保存され、CSVダウンロードに正しく出力される(itemIdの推測で誤ってDIRECT扱いにならない)", async () => {
    await callCreateQuote("applicant-1", {
      id: "Q-IT-1",
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      items: [
        { itemId: "ITEM-001", inputType: "MASTER", quantity: 1, unitPrice: 1000 },
      ],
    });

    const items = await db
      .select()
      .from(schema.quoteItems)
      .where(eq(schema.quoteItems.quoteId, "Q-IT-1"));
    expect(items).toHaveLength(1);
    expect(items[0].inputType).toBe("MASTER");

    const res = await callExportCsv("applicant-1");
    const text = await res.text();
    const line = text
      .split("\n")
      .find((l) => l.includes('"Q-IT-1"') && l.includes('"ITEM-001"'));
    expect(line).toContain('"MASTER"');
  });

  it("CSVインポートで自社担当者(employeeNumber)とinputTypeが正しく反映される(UUID変換されない)", async () => {
    const csvHeader =
      "id,partnerId,companyDepartment,quoteDate,validUntil,status,totalAmount,taxAmount,memo,terms,updatedBy,itemId,itemName,inputType,quantity,unitPrice";
    const csvRow =
      "Q-CSV-1,partner-1,,2026-01-01,,DRAFT,1000,100,,,applicant-1,ITEM-100,テスト品目,MASTER,1,1000";
    const csvText = `${csvHeader}\n${csvRow}\n`;

    const formData = new FormData();
    formData.append(
      "file",
      new File([csvText], "quotes.csv", { type: "text/csv" }),
    );

        const ctx = createExecutionContext();
    const res = await quotesRouter.request(
      "/bulk-register",
      {
        method: "POST",
        headers: { Cookie: await buildSessionCookieHeader("editor-importer") },
        body: formData,
      },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);

    const quote = await findQuote("Q-CSV-1");
    expect(quote?.salesPersonEmployeeNumber).toBe("applicant-1");
    // インポートを実行した操作者がcreatedBy/updatedByになる(CSVのupdatedBy列の値ではない)
    expect(quote?.createdBy).toBe("editor-importer");
    expect(quote?.updatedBy).toBe("editor-importer");

    const items = await db
      .select()
      .from(schema.quoteItems)
      .where(eq(schema.quoteItems.quoteId, "Q-CSV-1"));
    expect(items).toHaveLength(1);
    expect(items[0].inputType).toBe("MASTER");
  });

  it("件名(title)がCSVダウンロードに出力される", async () => {
    await callCreateQuote("applicant-1", {
      id: "Q-TITLE-1",
      quoteDate: "2026-01-01",
      partnerId: "partner-1",
      title: "テスト案件名",
      items: [],
    });

    const res = await callExportCsv("applicant-1");
    const text = await res.text();
    const line = text.split("\n").find((l) => l.includes('"Q-TITLE-1"'));
    expect(line).toContain("テスト案件名");
  });

  it("CSVインポートで件名(title)が新規登録・再インポート更新の両方で反映される", async () => {
    const csvHeader =
      "id,title,partnerId,companyDepartment,quoteDate,validUntil,status,totalAmount,taxAmount,memo,terms,updatedBy,itemId,itemName,inputType,quantity,unitPrice";
    const importOnce = async (title: string) => {
      const csvRow = `Q-CSV-TITLE-1,${title},partner-1,,2026-01-01,,DRAFT,1000,100,,,applicant-1,ITEM-100,テスト品目,MASTER,1,1000`;
      const csvText = `${csvHeader}\n${csvRow}\n`;
      const formData = new FormData();
      formData.append(
        "file",
        new File([csvText], "quotes.csv", { type: "text/csv" }),
      );
            const ctx = createExecutionContext();
      const _res = await quotesRouter.request(
        "/bulk-register",
        {
          method: "POST",
          headers: { Cookie: await buildSessionCookieHeader("editor-importer") },
          body: formData,
        },
        env, ctx
      );
      await waitOnExecutionContext(ctx);
      return _res;
    };

    const res1 = await importOnce("初回インポート件名");
    expect(res1.status).toBe(200);
    let quote = await findQuote("Q-CSV-TITLE-1");
    expect(quote?.title).toBe("初回インポート件名");

    // 同じidで再インポート(更新)した場合もtitleが反映されること(onConflictDoUpdateのsetにtitleが
    // 含まれていないと、新規登録時のみ反映され再インポートでは更新されない不具合があった)
    const res2 = await importOnce("再インポート後の件名");
    expect(res2.status).toBe(200);
    quote = await findQuote("Q-CSV-TITLE-1");
    expect(quote?.title).toBe("再インポート後の件名");
  });
});
