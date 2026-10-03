import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as journalSchema from "../../../db/journal-schema";
import { postSalesInvoiceJournal } from "../../admin/journal-sources/document-posting";
import { SalesInvoiceRepository } from "./sales-invoice.repository";
import { SalesInvoiceService } from "./sales-invoice.service";
import type { Env } from "../../../types/env";

vi.mock("../../../workflow-engine/notifier", () => ({
  sendWorkflowMail: vi.fn(async () => {}),
  notifyApprovalRequestSubmitted: vi.fn(async () => {}),
}));

const db = drizzle(env.DB, { schema });
const journalDb = drizzle(env.DB_JOURNAL, { schema: journalSchema });
const now = new Date();

function buildTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", async (c, next) => {
    const repo = new SalesInvoiceRepository(c.env.DB);
    c.set("service" as never, new SalesInvoiceService(repo) as never);
    await next();
  });
  return app;
}

async function withContext<T>(fn: (c: any) => Promise<T>): Promise<T> {
  const app = buildTestApp();
  let result!: T;
  let caughtError: unknown;
  app.get("/run", async (c) => {
    try {
      result = await fn(c);
    } catch (err) {
      caughtError = err;
    }
    return c.json({});
  });
  const ctx = createExecutionContext();
  await app.request("/run", {}, env, ctx);
  await waitOnExecutionContext(ctx);
  if (caughtError) throw caughtError;
  return result;
}

function getService(c: any): SalesInvoiceService {
  return c.get("service" as never) as SalesInvoiceService;
}

beforeEach(async () => {
  await journalDb.delete(journalSchema.journalLines);
  await journalDb.delete(journalSchema.journalBatches);
  await db.delete(schema.journalPostingEvents);
  await db.delete(schema.journalPostingRules);
  await db.delete(schema.salesInvoiceAttachments);
  await db.delete(schema.salesInvoiceHistoryLogs);
  await db.delete(schema.salesInvoiceItems);
  await db.delete(schema.salesInvoices);
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  await db.delete(schema.items);
  await db.delete(schema.accounts);
  await db.delete(schema.taxCategories);
  await db.delete(schema.units);
  await db.delete(schema.partners);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.put("config", JSON.stringify({}));

  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.partners).values({
    id: "P-1",
    name: "取引先1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.units).values({
    code: "EA",
    name: "個",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.taxCategories).values({
    code: "TAX_10",
    name: "10%標準税率",
    taxType: "STANDARD",
    taxRate: 0.1,
  });
});

async function seedSalesOrder(id: string, itemQuantity = 10, isPrepaid = false) {
  await db.insert(schema.salesOrders).values({
    id,
    partnerId: "P-1",
    orderDate: now,
    status: "APPROVED",
    totalAmount: itemQuantity * 1000,
    taxAmount: Math.round(itemQuantity * 1000 * 0.1),
    isPrepaid,
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  const itemId = `${id}-ITEM-1`;
  await db.insert(schema.salesOrderItems).values({
    id: itemId,
    salesOrderId: id,
    itemId: "ITEM-1",
    itemName: "品目A",
    quantity: itemQuantity,
    unitPrice: 1000,
    amount: itemQuantity * 1000,
    taxCategoryCode: "TAX_10",
    sortOrder: 0,
  });
  return itemId;
}

describe("SalesInvoiceCrudService: 新規登録・承認機能OFF時の直接確定", () => {
  it("承認機能が無効な場合、submitForApprovalで直接APPROVEDになる(自動転記はされず、選択して仕訳を作成できる)", async () => {
    await db.insert(schema.accounts).values([
      { code: "4101", name: "商品売上高", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
      { code: "1301", name: "売掛金", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
      { code: "2201", name: "仮受消費税", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    ]);
    await db.insert(schema.journalPostingRules).values({
      eventType: "SALES",
      variableAccountPriority: "ITEM_MASTER_FIRST",
      variableAccountFallbackCode: "4101",
      receivableAccountCode: "1301",
      taxAccountCode: "2201",
      enabled: true,
      updatedBy: "EMP001",
      updatedAt: now,
    });

    const formData = new FormData();
    formData.append(
      "invoiceData",
      JSON.stringify({
        title: "テスト売上",
        partnerId: "P-1",
        invoiceDate: now.toISOString(),
        totalAmount: 11000,
        taxAmount: 1000,
        items: [
          { itemId: "ITEM-1", itemName: "品目A", quantity: 1, unitPrice: 10000, taxCategoryCode: "TAX_10" },
        ],
      }),
    );

    const created = await withContext((c) =>
      getService(c).createInvoice(c, formData, JSON.parse(formData.get("invoiceData") as string)),
    );
    expect(created.success).toBe(true);
    const invoiceId = (created as any).id as string;

    const submitResult = await withContext((c) => getService(c).submitForApproval(c, invoiceId));
    expect(submitResult.success).toBe(true);

    const invoiceRows = await db
      .select()
      .from(schema.salesInvoices)
      .where(eq(schema.salesInvoices.id, invoiceId));
    expect(invoiceRows[0]?.status).toBe("APPROVED");

    // V-4: 承認(確定)しただけでは自動転記されない。仕訳データ出力画面と同じく、伝票を選んで仕訳にする
    expect(await journalDb.select().from(journalSchema.journalBatches)).toHaveLength(0);
    const posted = await postSalesInvoiceJournal({
      db: env.DB,
      dbJournal: env.DB_JOURNAL,
      companySettings: env.COMPANY_SETTINGS,
      sourceRefId: invoiceId,
      performedById: "EMP001",
    });
    expect(posted.ok && posted.result.status).toBe("POSTED");

    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches).toHaveLength(1);
    expect(batches[0].totalDebitAmount).toBe(11000);
  });

  it("K-2-b: 明細の勘定科目が設定されていれば品目マスタの科目より優先して仕訳になる", async () => {
    await db.insert(schema.accounts).values([
      { code: "4101", name: "商品売上高(フォールバック)", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
      { code: "4102", name: "商品売上高(品目マスタ)", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
      { code: "4103", name: "商品売上高(明細指定)", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
      { code: "1301", name: "売掛金", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
      { code: "2201", name: "仮受消費税", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    ]);
    await db.insert(schema.journalPostingRules).values({
      eventType: "SALES",
      variableAccountPriority: "ITEM_MASTER_FIRST",
      variableAccountFallbackCode: "4101",
      receivableAccountCode: "1301",
      taxAccountCode: "2201",
      enabled: true,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.units).values({
      code: "PCS", name: "個", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now,
    }).onConflictDoNothing();
    await db.insert(schema.items).values({
      id: "ITEM-1",
      name: "品目A",
      baseUnitCode: "PCS",
      accountCode: "4102",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });

    const formData = new FormData();
    formData.append(
      "invoiceData",
      JSON.stringify({
        title: "テスト売上(明細科目指定)",
        partnerId: "P-1",
        invoiceDate: now.toISOString(),
        totalAmount: 11000,
        taxAmount: 1000,
        items: [
          {
            itemId: "ITEM-1",
            itemName: "品目A",
            quantity: 1,
            unitPrice: 10000,
            taxCategoryCode: "TAX_10",
            accountCode: "4103",
          },
        ],
      }),
    );

    const created = await withContext((c) =>
      getService(c).createInvoice(c, formData, JSON.parse(formData.get("invoiceData") as string)),
    );
    const invoiceId = (created as any).id as string;
    await withContext((c) => getService(c).submitForApproval(c, invoiceId));

    // V-4: 承認(確定)しただけでは自動転記されない。仕訳データ出力画面と同じく、伝票を選んで仕訳にする
    expect(await journalDb.select().from(journalSchema.journalBatches)).toHaveLength(0);
    const posted = await postSalesInvoiceJournal({
      db: env.DB,
      dbJournal: env.DB_JOURNAL,
      companySettings: env.COMPANY_SETTINGS,
      sourceRefId: invoiceId,
      performedById: "EMP001",
    });
    expect(posted.ok && posted.result.status).toBe("POSTED");

    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches).toHaveLength(1);
    const lines = await journalDb
      .select()
      .from(journalSchema.journalLines)
      .where(eq(journalSchema.journalLines.batchId, batches[0].id));
    const creditLine = lines.find((l) => l.side === "CREDIT" && l.amount === 10000);
    expect(creditLine?.accountCode).toBe("4103");
  });
});

describe("SalesInvoiceCrudService: documentTypeバリデーション", () => {
  it("RETURN指定でoriginalInvoiceId未指定の場合はBadRequestError", async () => {
    const formData = new FormData();
    const body = {
      partnerId: "P-1",
      invoiceDate: now.toISOString(),
      documentType: "RETURN",
      totalAmount: 1000,
      taxAmount: 100,
      items: [],
    };
    formData.append("invoiceData", JSON.stringify(body));

    await expect(
      withContext((c) => getService(c).createInvoice(c, formData, body as any)),
    ).rejects.toThrow(/元の売上/);
  });

  it("追加要望L-2-a: DISCOUNTも元伝票必須だが、赤伝(訂正)=CORRECTIONは元伝票なしの自由入力を起票できる", async () => {
    const base = { partnerId: "P-1", invoiceDate: now.toISOString(), totalAmount: 1000, taxAmount: 100, items: [] };

    const discount = { ...base, documentType: "DISCOUNT" };
    const fd1 = new FormData();
    fd1.append("invoiceData", JSON.stringify(discount));
    await expect(withContext((c) => getService(c).createInvoice(c, fd1, discount as any))).rejects.toThrow(/元の売上/);

    const correction = { ...base, documentType: "CORRECTION" };
    const fd2 = new FormData();
    fd2.append("invoiceData", JSON.stringify(correction));
    const created = await withContext((c) => getService(c).createInvoice(c, fd2, correction as any));
    expect((created as any).id).toBeTruthy();
  });
});

describe("SalesInvoiceCrudService: 受注明細単位の残数量検証", () => {
  it("受注数量を超える数量で売上を起票するとBadRequestError(基準=受注数量)", async () => {
    const orderItemId = await seedSalesOrder("SO-1", 10);
    const formData = new FormData();
    const body = {
      partnerId: "P-1",
      salesOrderId: "SO-1",
      invoiceDate: now.toISOString(),
      totalAmount: 11000000,
      taxAmount: 1000000,
      items: [
        {
          itemId: "ITEM-1",
          itemName: "品目A",
          sourceOrderItemId: orderItemId,
          quantity: 11,
          unitPrice: 1000,
          taxCategoryCode: "TAX_10",
        },
      ],
    };
    formData.append("invoiceData", JSON.stringify(body));

    await expect(
      withContext((c) => getService(c).createInvoice(c, formData, body as any)),
    ).rejects.toThrow(/残数量/);
  });

  it("受注数量の範囲内なら売上を起票でき、2回目の起票は残数量から差し引かれる", async () => {
    const orderItemId = await seedSalesOrder("SO-2", 10);

    const makeBody = (qty: number) => ({
      partnerId: "P-1",
      salesOrderId: "SO-2",
      invoiceDate: now.toISOString(),
      totalAmount: qty * 1000,
      taxAmount: Math.round(qty * 1000 * 0.1),
      items: [
        {
          itemId: "ITEM-1",
          itemName: "品目A",
          sourceOrderItemId: orderItemId,
          quantity: qty,
          unitPrice: 1000,
          taxCategoryCode: "TAX_10",
        },
      ],
    });

    const formData1 = new FormData();
    const body1 = makeBody(6);
    formData1.append("invoiceData", JSON.stringify(body1));
    const created1 = await withContext((c) => getService(c).createInvoice(c, formData1, body1 as any));
    const id1 = (created1 as any).id as string;
    // APPROVEDにしないと残数量計算に反映されない(getInvoicedQuantitiesByOrderItemIdsはAPPROVEDのみ集計)
    await withContext((c) => getService(c).submitForApproval(c, id1));

    // 残り4のところへ5を起票しようとするとエラー
    const formData2 = new FormData();
    const body2 = makeBody(5);
    formData2.append("invoiceData", JSON.stringify(body2));
    await expect(
      withContext((c) => getService(c).createInvoice(c, formData2, body2 as any)),
    ).rejects.toThrow(/残数量/);

    // 残り4ちょうどなら成功する
    const formData3 = new FormData();
    const body3 = makeBody(4);
    formData3.append("invoiceData", JSON.stringify(body3));
    const created3 = await withContext((c) => getService(c).createInvoice(c, formData3, body3 as any));
    expect(created3.success).toBe(true);
  });
});

describe("SalesInvoiceCrudService: BUG-050 受注の得意先との一致", () => {
  beforeEach(async () => {
    await db.insert(schema.partners).values({
      id: "P-2",
      name: "取引先2",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
  });

  const makeBody = (partnerId: string, orderItemId: string, salesOrderId: string | null = "SO-P1") => ({
    partnerId,
    salesOrderId,
    invoiceDate: now.toISOString(),
    totalAmount: 1100,
    taxAmount: 100,
    items: [
      {
        itemId: "ITEM-1",
        itemName: "品目A",
        sourceOrderItemId: orderItemId,
        quantity: 1,
        unitPrice: 1000,
        taxCategoryCode: "TAX_10",
      },
    ],
  });

  it("受注の得意先と異なる取引先で売上を登録するとBadRequestErrorで、売上は作られない", async () => {
    const orderItemId = await seedSalesOrder("SO-P1", 10);
    const body = makeBody("P-2", orderItemId);
    const formData = new FormData();
    formData.append("invoiceData", JSON.stringify(body));

    await expect(
      withContext((c) => getService(c).createInvoice(c, formData, body as any)),
    ).rejects.toThrow(/得意先/);
    expect(await db.select().from(schema.salesInvoices)).toHaveLength(0);
  });

  it("受注番号を指定せず、明細だけ別の得意先の受注明細を指定した場合もBadRequestError", async () => {
    const orderItemId = await seedSalesOrder("SO-P1", 10);
    const body = makeBody("P-2", orderItemId, null);
    const formData = new FormData();
    formData.append("invoiceData", JSON.stringify(body));

    await expect(
      withContext((c) => getService(c).createInvoice(c, formData, body as any)),
    ).rejects.toThrow(/得意先/);
  });

  it("受注の得意先と同じ取引先なら売上を登録できる", async () => {
    const orderItemId = await seedSalesOrder("SO-P1", 10);
    const body = makeBody("P-1", orderItemId);
    const formData = new FormData();
    formData.append("invoiceData", JSON.stringify(body));

    const created = await withContext((c) => getService(c).createInvoice(c, formData, body as any));
    expect(created.success).toBe(true);
  });

  it("更新で取引先を受注の得意先と異なるものに変えるとBadRequestError", async () => {
    const orderItemId = await seedSalesOrder("SO-P1", 10);
    const body = makeBody("P-1", orderItemId);
    const formData = new FormData();
    formData.append("invoiceData", JSON.stringify(body));
    const created = await withContext((c) => getService(c).createInvoice(c, formData, body as any));
    const id = (created as any).id as string;

    await expect(
      withContext((c) => getService(c).updateInvoice(c, id, new FormData(), makeBody("P-2", orderItemId) as any)),
    ).rejects.toThrow(/得意先/);
  });
});

describe("SalesInvoiceCrudService: BUG-065 サービス品目は「出荷済み数量まで」の設定でも受注数量まで計上できる", () => {
  beforeEach(async () => {
    await env.COMPANY_SETTINGS.put("config", JSON.stringify({ is_sales_invoice_requires_shipment: true }));
    await db.insert(schema.items).values({
      id: "ITEM-SVC",
      name: "設置作業",
      baseUnitCode: "EA",
      isService: true,
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
  });

  const body = (orderItemId: string, itemId: string) => ({
    partnerId: "P-1",
    salesOrderId: "SO-SVC",
    invoiceDate: now.toISOString(),
    totalAmount: 1100,
    taxAmount: 100,
    items: [{ itemId, itemName: "明細", sourceOrderItemId: orderItemId, quantity: 2, unitPrice: 500, taxCategoryCode: "TAX_10" }],
  });

  it("出荷済み数量が0でも、サービス品目の明細は受注数量まで計上できる", async () => {
    const stockLineId = await seedSalesOrder("SO-SVC", 10);
    await db.update(schema.salesOrderItems).set({ itemId: "ITEM-SVC" }).where(eq(schema.salesOrderItems.id, stockLineId));
    const b = body(stockLineId, "ITEM-SVC");
    const formData = new FormData();
    formData.append("invoiceData", JSON.stringify(b));

    const created = await withContext((c) => getService(c).createInvoice(c, formData, b as any));

    expect(created.success).toBe(true);
  });

  it("在庫品目の明細は、これまでどおり出荷済み数量を超えると計上できない", async () => {
    const stockLineId = await seedSalesOrder("SO-SVC", 10);
    const b = body(stockLineId, "ITEM-1");
    const formData = new FormData();
    formData.append("invoiceData", JSON.stringify(b));

    await expect(withContext((c) => getService(c).createInvoice(c, formData, b as any))).rejects.toThrow(/残数量/);
  });

  it("「受注から選択」用の残数量でも、サービス品目は受注数量を基準にする", async () => {
    const stockLineId = await seedSalesOrder("SO-SVC", 10);
    await db.update(schema.salesOrderItems).set({ itemId: "ITEM-SVC" }).where(eq(schema.salesOrderItems.id, stockLineId));

    const progress = await withContext((c) => getService(c).getOrderInvoiceProgress(c, "SO-SVC"));

    expect(progress[0]).toMatchObject({ remainingQuantity: 10, basis: "ORDERED" });
  });
});

describe("SalesInvoiceCrudService: 削除", () => {
  it("DRAFT状態の売上は直接削除できる", async () => {
    const formData = new FormData();
    const body = {
      partnerId: "P-1",
      invoiceDate: now.toISOString(),
      totalAmount: 1000,
      taxAmount: 100,
      items: [],
    };
    formData.append("invoiceData", JSON.stringify(body));
    const created = await withContext((c) => getService(c).createInvoice(c, formData, body as any));
    const id = (created as any).id as string;

    const result = await withContext((c) => getService(c).deleteInvoice(c, id));
    expect(result.success).toBe(true);

    const rows = await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, id));
    expect(rows).toHaveLength(0);
  });

  it("APPROVED状態の売上を直接削除しようとするとBadRequestError", async () => {
    const formData = new FormData();
    const body = {
      partnerId: "P-1",
      invoiceDate: now.toISOString(),
      totalAmount: 1000,
      taxAmount: 100,
      items: [],
    };
    formData.append("invoiceData", JSON.stringify(body));
    const created = await withContext((c) => getService(c).createInvoice(c, formData, body as any));
    const id = (created as any).id as string;
    await withContext((c) => getService(c).submitForApproval(c, id));

    await expect(withContext((c) => getService(c).deleteInvoice(c, id))).rejects.toThrow(
      /削除申請/,
    );
  });
});

describe("SalesInvoiceCrudService: 請求済み(BILLED)の売上の編集", () => {
  async function createDraft() {
    const formData = new FormData();
    const body = {
      partnerId: "P-1",
      invoiceDate: now.toISOString(),
      totalAmount: 1000,
      taxAmount: 100,
      items: [],
    };
    formData.append("invoiceData", JSON.stringify(body));
    const created = await withContext((c) => getService(c).createInvoice(c, formData, body as any));
    return { id: (created as any).id as string, formData, body };
  }

  it("請求済み(BILLED)の売上は、承認機能OFFでも更新できない", async () => {
    const { id, formData, body } = await createDraft();
    await db
      .update(schema.salesInvoices)
      .set({ billingStatus: "BILLED" })
      .where(eq(schema.salesInvoices.id, id));

    await expect(
      withContext((c) =>
        getService(c).updateInvoice(c, id, formData, { ...body, totalAmount: 2000 } as any),
      ),
    ).rejects.toThrow("請求済みの売上は編集できません");

    const rows = await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, id));
    expect(rows[0].totalAmount).toBe(1000);
  });

  it("未請求(UNBILLED)の売上は従来どおり更新できる", async () => {
    const { id, formData, body } = await createDraft();

    await withContext((c) =>
      getService(c).updateInvoice(c, id, formData, { ...body, totalAmount: 2000 } as any),
    );

    const rows = await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, id));
    expect(rows[0].totalAmount).toBe(2000);
  });
});

describe("SalesInvoiceCrudService: 受注から選択ピッカー用の残数量取得", () => {
  it("受注数量基準(is_sales_invoice_requires_shipment未設定)で残数量を返す", async () => {
    const orderItemId = await seedSalesOrder("SO-PROG-1", 10);

    const progress = await withContext((c) => getService(c).getOrderInvoiceProgress(c, "SO-PROG-1"));
    expect(progress).toHaveLength(1);
    expect(progress[0].salesOrderItemId).toBe(orderItemId);
    expect(progress[0].basis).toBe("ORDERED");
    expect(progress[0].remainingQuantity).toBe(10);

    // 6個売上計上(APPROVED)すると残数量が4になる
    const formData = new FormData();
    const body = {
      partnerId: "P-1",
      salesOrderId: "SO-PROG-1",
      invoiceDate: now.toISOString(),
      totalAmount: 6000,
      taxAmount: 600,
      items: [
        {
          itemId: "ITEM-1",
          itemName: "品目A",
          sourceOrderItemId: orderItemId,
          quantity: 6,
          unitPrice: 1000,
          taxCategoryCode: "TAX_10",
        },
      ],
    };
    formData.append("invoiceData", JSON.stringify(body));
    const created = await withContext((c) => getService(c).createInvoice(c, formData, body as any));
    await withContext((c) => getService(c).submitForApproval(c, (created as any).id));

    const progressAfter = await withContext((c) =>
      getService(c).getOrderInvoiceProgress(c, "SO-PROG-1"),
    );
    expect(progressAfter[0].remainingQuantity).toBe(4);
  });

  it("存在しない受注IDはNotFoundError", async () => {
    await expect(
      withContext((c) => getService(c).getOrderInvoiceProgress(c, "NOPE")),
    ).rejects.toThrow(/受注が見つかりません/);
  });
});
