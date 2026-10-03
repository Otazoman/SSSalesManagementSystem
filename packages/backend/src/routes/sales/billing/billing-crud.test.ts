import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { BillingRepository } from "./billing.repository";
import { BillingService } from "./billing.service";
import { SalesInvoiceRepository } from "../invoices/sales-invoice.repository";
import type { Env } from "../../../types/env";

const db = drizzle(env.DB, { schema });
const now = new Date();

function buildTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", async (c, next) => {
    const repo = new BillingRepository(c.env.DB);
    c.set("service" as never, new BillingService(repo) as never);
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

function getService(c: any): BillingService {
  return c.get("service" as never) as BillingService;
}

beforeEach(async () => {
  await db.delete(schema.paymentReceipts);
  await db.delete(schema.billingItems);
  await db.delete(schema.billingHeaders);
  await db.delete(schema.salesInvoiceItems);
  await db.delete(schema.salesInvoices);
  await db.delete(schema.partners);
  await db.delete(schema.users);
  await db.delete(schema.taxCategories);
  await env.COMPANY_SETTINGS.put("config", JSON.stringify({}));

  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.partners).values([
    { id: "P-1", name: "取引先1", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    { id: "P-2", name: "取引先2", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
  ]);
});

async function seedInvoice(
  id: string,
  overrides: Partial<typeof schema.salesInvoices.$inferInsert> = {},
) {
  await db.insert(schema.salesInvoices).values({
    id,
    partnerId: "P-1",
    invoiceDate: now,
    status: "APPROVED",
    documentType: "SALE",
    totalAmount: 11000,
    taxAmount: 1000,
    billingStatus: "UNBILLED",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
    ...overrides,
  });
}

describe("BillingCrudService.createBilling: モード別バリデーション", () => {
  it("PER_TRANSACTIONで対象売上を2件以上指定すると400", async () => {
    await seedInvoice("SI-1");
    await seedInvoice("SI-2");

    await expect(
      withContext((c) =>
        getService(c).createBilling(c, {
          partnerId: "P-1",
          mode: "PER_TRANSACTION",
          billingDate: now.toISOString(),
          periodStart: null,
          periodEnd: null,
          title: null,
          memo: null,
          salesInvoiceIds: ["SI-1", "SI-2"],
        }),
      ),
    ).rejects.toThrow("都度請求(PER_TRANSACTION)では対象の売上・明細を合計1件のみ選択してください");
  });

  it("PERIODICでperiodStart/periodEnd未指定だと400", async () => {
    await seedInvoice("SI-1");

    await expect(
      withContext((c) =>
        getService(c).createBilling(c, {
          partnerId: "P-1",
          mode: "PERIODIC",
          billingDate: now.toISOString(),
          periodStart: null,
          periodEnd: null,
          title: null,
          memo: null,
          salesInvoiceIds: ["SI-1"],
        }),
      ),
    ).rejects.toThrow("締め請求(PERIODIC)では対象期間");
  });

  it("承認済みでない売上を対象にすると400", async () => {
    await seedInvoice("SI-1", { status: "DRAFT" });

    await expect(
      withContext((c) =>
        getService(c).createBilling(c, {
          partnerId: "P-1",
          mode: "PER_TRANSACTION",
          billingDate: now.toISOString(),
          periodStart: null,
          periodEnd: null,
          title: null,
          memo: null,
          salesInvoiceIds: ["SI-1"],
        }),
      ),
    ).rejects.toThrow("承認済み");
  });

  it("既に請求済み(BILLED)の売上を対象にすると400", async () => {
    await seedInvoice("SI-1", { billingStatus: "BILLED" });

    await expect(
      withContext((c) =>
        getService(c).createBilling(c, {
          partnerId: "P-1",
          mode: "PER_TRANSACTION",
          billingDate: now.toISOString(),
          periodStart: null,
          periodEnd: null,
          title: null,
          memo: null,
          salesInvoiceIds: ["SI-1"],
        }),
      ),
    ).rejects.toThrow("既に請求済み");
  });

  it("取引先が請求先と一致しない売上を対象にすると400", async () => {
    await seedInvoice("SI-1", { partnerId: "P-2" });

    await expect(
      withContext((c) =>
        getService(c).createBilling(c, {
          partnerId: "P-1",
          mode: "PER_TRANSACTION",
          billingDate: now.toISOString(),
          periodStart: null,
          periodEnd: null,
          title: null,
          memo: null,
          salesInvoiceIds: ["SI-1"],
        }),
      ),
    ).rejects.toThrow("取引先が指定の請求先と一致しません");
  });

  it("存在しない売上を対象にすると404", async () => {
    await expect(
      withContext((c) =>
        getService(c).createBilling(c, {
          partnerId: "P-1",
          mode: "PER_TRANSACTION",
          billingDate: now.toISOString(),
          periodStart: null,
          periodEnd: null,
          title: null,
          memo: null,
          salesInvoiceIds: ["NOPE"],
        }),
      ),
    ).rejects.toThrow("見つかりません");
  });
});

describe("BillingCrudService.createBilling: 正常系", () => {
  it("PER_TRANSACTIONで請求を作成し、対象売上のbillingStatusがBILLEDに更新される", async () => {
    await seedInvoice("SI-1");

    const result = await withContext((c) =>
      getService(c).createBilling(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        billingDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: "9月分請求",
        memo: null,
        salesInvoiceIds: ["SI-1"],
      }),
    );
    expect(result.success).toBe(true);

    const updatedInvoice = await db
      .select()
      .from(schema.salesInvoices)
      .where(eq(schema.salesInvoices.id, "SI-1"));
    expect(updatedInvoice[0].billingStatus).toBe("BILLED");

    const header = await db
      .select()
      .from(schema.billingHeaders)
      .where(eq(schema.billingHeaders.id, result.id));
    expect(header[0].totalAmount).toBe(11000);
    expect(header[0].taxAmount).toBe(1000);
    expect(header[0].mode).toBe("PER_TRANSACTION");
    expect(header[0].reconciliationStatus).toBe("UNRECONCILED");

    const items = await db
      .select()
      .from(schema.billingItems)
      .where(eq(schema.billingItems.billingHeaderId, result.id));
    expect(items).toHaveLength(1);
    expect(items[0].salesInvoiceId).toBe("SI-1");
  });

  it("PERIODICで複数売上を束ねて請求を作成できる", async () => {
    await seedInvoice("SI-1", { totalAmount: 11000, taxAmount: 1000 });
    await seedInvoice("SI-2", { totalAmount: 22000, taxAmount: 2000 });

    const result = await withContext((c) =>
      getService(c).createBilling(c, {
        partnerId: "P-1",
        mode: "PERIODIC",
        billingDate: now.toISOString(),
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        title: "9月度締め請求",
        memo: null,
        salesInvoiceIds: ["SI-1", "SI-2"],
      }),
    );
    expect(result.success).toBe(true);

    const header = await db
      .select()
      .from(schema.billingHeaders)
      .where(eq(schema.billingHeaders.id, result.id));
    expect(header[0].totalAmount).toBe(33000);
    expect(header[0].taxAmount).toBe(3000);

    const invoices = await db
      .select()
      .from(schema.salesInvoices)
      .where(eq(schema.salesInvoices.partnerId, "P-1"));
    expect(invoices.every((i) => i.billingStatus === "BILLED")).toBe(true);
  });
});

describe("BillingCrudService.createBilling: 二重請求防止", () => {
  const payload = (salesInvoiceIds: string[]) => ({
    partnerId: "P-1",
    mode: "PERIODIC" as const,
    billingDate: now.toISOString(),
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    title: null,
    memo: null,
    salesInvoiceIds,
  });

  it("claimUnbilledInvoices: 未請求の売上だけをBILLEDにして、そのidだけを返す", async () => {
    await seedInvoice("SI-1");
    await seedInvoice("SI-2", { billingStatus: "BILLED" });
    const repo = new SalesInvoiceRepository(env.DB);

    const claimed = await repo.claimUnbilledInvoices(["SI-1", "SI-2"]);

    expect(claimed).toEqual(["SI-1"]);
  });

  it("事前チェック後に別の請求が売上を確保していた場合、請求を作らず確保済み分を未請求に戻して400", async () => {
    await seedInvoice("SI-1");
    await seedInvoice("SI-2");
    // 事前チェックは通るが、確保時点ではSI-2が既に他の請求に取られている状況を再現する
    const original = SalesInvoiceRepository.prototype.claimUnbilledInvoices;
    const spy = vi
      .spyOn(SalesInvoiceRepository.prototype, "claimUnbilledInvoices")
      .mockImplementation(async function (this: SalesInvoiceRepository, ids: string[]) {
        await db
          .update(schema.salesInvoices)
          .set({ billingStatus: "BILLED" })
          .where(eq(schema.salesInvoices.id, "SI-2"));
        return original.call(this, ids);
      });

    try {
      await expect(
        withContext((c) => getService(c).createBilling(c, payload(["SI-1", "SI-2"]))),
      ).rejects.toThrow("既に請求済みになっています");
    } finally {
      spy.mockRestore();
    }

    const invoices = await db.select().from(schema.salesInvoices);
    const byId = Object.fromEntries(invoices.map((i) => [i.id, i.billingStatus]));
    expect(byId["SI-1"]).toBe("UNBILLED");
    expect(byId["SI-2"]).toBe("BILLED");
    expect(await db.select().from(schema.billingHeaders)).toHaveLength(0);
    expect(await db.select().from(schema.billingItems)).toHaveLength(0);
  });

  it("ヘッダ・明細の登録に失敗した場合、売上を未請求に戻し、ヘッダも明細も残らない", async () => {
    await seedInvoice("SI-1");
    // ヘッダ・明細の登録(batch)が失敗する状況を再現する
    const spy = vi
      .spyOn(BillingRepository.prototype, "insertHeaderWithItems")
      .mockRejectedValue(new Error("D1_ERROR: UNIQUE constraint failed"));

    try {
      await expect(
        withContext((c) => getService(c).createBilling(c, payload(["SI-1"]))),
      ).rejects.toThrow("UNIQUE constraint failed");
    } finally {
      spy.mockRestore();
    }

    const invoice = await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, "SI-1"));
    expect(invoice[0].billingStatus).toBe("UNBILLED");
    expect(await db.select().from(schema.billingHeaders)).toHaveLength(0);
  });

  it("insertHeaderWithItems: 明細が1件でも失敗するとヘッダも登録されない(原子性)", async () => {
    const repo = new BillingRepository(env.DB);
    const header = {
      id: "BL-ATOMIC",
      partnerId: "P-1",
      billingDate: now,
      mode: "PERIODIC",
      status: "DRAFT",
      totalAmount: 0,
      taxAmount: 0,
      reconciledAmount: 0,
      reconciliationStatus: "UNRECONCILED",
      createdBy: "EMP001",
      updatedBy: "EMP001",
      createdAt: now,
      updatedAt: now,
    };
    // 同一idの明細を2件渡してbatch内で主キー重複を起こす
    const item = { id: "BI-DUP", billingHeaderId: "BL-ATOMIC", salesInvoiceId: null, amount: 1, taxAmount: 0, sortOrder: 0 };

    await expect(repo.insertHeaderWithItems(header, [item, { ...item, sortOrder: 1 }])).rejects.toThrow();

    expect(await db.select().from(schema.billingHeaders)).toHaveLength(0);
    expect(await db.select().from(schema.billingItems)).toHaveLength(0);
  });
});

describe("BillingCrudService.createBilling: K-4-3 完全手動入力", () => {
  it("manualItemsのみでPER_TRANSACTION請求を作成できる(salesInvoiceIdはnull)", async () => {
    await db.insert(schema.taxCategories).values({
      code: "TAX10",
      name: "標準税率10%",
      taxType: "STANDARD",
      taxRate: 0.1,
    });

    const result = await withContext((c) =>
      getService(c).createBilling(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        billingDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: "手動請求",
        memo: null,
        salesInvoiceIds: [],
        manualItems: [
          { itemName: "コンサルティング費用", quantity: 2, unitPrice: 5000, taxCategoryCode: "TAX10" },
        ],
      }),
    );
    expect(result.success).toBe(true);

    const header = await db
      .select()
      .from(schema.billingHeaders)
      .where(eq(schema.billingHeaders.id, result.id));
    expect(header[0].totalAmount).toBe(11000);
    expect(header[0].taxAmount).toBe(1000);

    const items = await db
      .select()
      .from(schema.billingItems)
      .where(eq(schema.billingItems.billingHeaderId, result.id));
    expect(items).toHaveLength(1);
    expect(items[0].salesInvoiceId).toBeNull();
    expect(items[0].itemName).toBe("コンサルティング費用");
    expect(items[0].amount).toBe(10000);
    expect(items[0].taxAmount).toBe(1000);
  });

  it("salesInvoiceIdsとmanualItemsを併用したPERIODIC請求を作成できる", async () => {
    await seedInvoice("SI-1", { totalAmount: 11000, taxAmount: 1000 });

    const result = await withContext((c) =>
      getService(c).createBilling(c, {
        partnerId: "P-1",
        mode: "PERIODIC",
        billingDate: now.toISOString(),
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        title: null,
        memo: null,
        salesInvoiceIds: ["SI-1"],
        manualItems: [
          { itemName: "追加作業費", quantity: 1, unitPrice: 3000, taxCategoryCode: null },
        ],
      }),
    );
    expect(result.success).toBe(true);

    const items = await db
      .select()
      .from(schema.billingItems)
      .where(eq(schema.billingItems.billingHeaderId, result.id));
    expect(items).toHaveLength(2);

    const header = await db
      .select()
      .from(schema.billingHeaders)
      .where(eq(schema.billingHeaders.id, result.id));
    // SI-1: 11000(税込) + 手動: 3000(税抜) + 300(税、既定10%) = 14300
    expect(header[0].totalAmount).toBe(14300);
    expect(header[0].taxAmount).toBe(1300);
  });

  it("manualItemsが未指定(undefined)でも従来通り動作する", async () => {
    await seedInvoice("SI-1");

    const result = await withContext((c) =>
      getService(c).createBilling(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        billingDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: null,
        memo: null,
        salesInvoiceIds: ["SI-1"],
      } as any),
    );
    expect(result.success).toBe(true);
  });
});

describe("BillingCrudService.getBillingDetail", () => {
  it("存在しないIDはnullを返す", async () => {
    const detail = await withContext((c) => getService(c).getBillingDetail(c, "NOPE"));
    expect(detail).toBeNull();
  });

  it("作成した請求の詳細を明細・入金消込履歴込みで取得できる", async () => {
    await seedInvoice("SI-1");
    const created = await withContext((c) =>
      getService(c).createBilling(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        billingDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: null,
        memo: null,
        salesInvoiceIds: ["SI-1"],
      }),
    );

    const detail = await withContext((c) => getService(c).getBillingDetail(c, created.id));
    expect(detail?.items).toHaveLength(1);
    expect(detail?.items[0].salesInvoice.id).toBe("SI-1");
    expect(detail?.paymentReceipts).toEqual([]);
  });

  it("K-4-2: 対象売上の明細(invoiceItems)まで展開して返す", async () => {
    await seedInvoice("SI-1");
    await db.insert(schema.salesInvoiceItems).values({
      id: "SI-1-ITEM-1",
      salesInvoiceId: "SI-1",
      itemId: "ITEM-1",
      itemName: "品目A",
      quantity: 2,
      unitPrice: 5000,
      amount: 10000,
      sortOrder: 0,
    });
    const created = await withContext((c) =>
      getService(c).createBilling(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        billingDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: null,
        memo: null,
        salesInvoiceIds: ["SI-1"],
      }),
    );

    const detail = await withContext((c) => getService(c).getBillingDetail(c, created.id));
    expect(detail?.items[0].invoiceItems).toHaveLength(1);
    expect(detail?.items[0].invoiceItems[0].itemName).toBe("品目A");
    expect(detail?.items[0].invoiceItems[0].quantity).toBe(2);
  });

  it("K-4-3: 完全手動入力行(salesInvoiceIdがnull)も詳細取得でsalesInvoiceがnullのまま含まれる", async () => {
    const created = await withContext((c) =>
      getService(c).createBilling(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        billingDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: null,
        memo: null,
        salesInvoiceIds: [],
        manualItems: [
          { itemName: "手動明細", quantity: 1, unitPrice: 1000, taxCategoryCode: null },
        ],
      }),
    );

    const detail = await withContext((c) => getService(c).getBillingDetail(c, created.id));
    expect(detail?.items).toHaveLength(1);
    expect(detail?.items[0].salesInvoice).toBeNull();
    expect(detail?.items[0].itemName).toBe("手動明細");
    expect(detail?.items[0].invoiceItems).toEqual([]);
  });
});

describe("BillingReconciliationService.recordPaymentReceipt: 消込ロジック", () => {
  async function createTestBilling(): Promise<string> {
    await seedInvoice("SI-1", { totalAmount: 10000, taxAmount: 1000 });
    const result = await withContext((c) =>
      getService(c).createBilling(c, {
        partnerId: "P-1",
        mode: "PER_TRANSACTION",
        billingDate: now.toISOString(),
        periodStart: null,
        periodEnd: null,
        title: null,
        memo: null,
        salesInvoiceIds: ["SI-1"],
      }),
    );
    return result.id as string;
  }

  it("一部入金の場合、reconciliationStatusはPARTIALLY_RECONCILEDになる", async () => {
    const billingId = await createTestBilling();

    const result = await withContext((c) =>
      getService(c).recordPaymentReceipt(c, billingId, {
        receivedDate: now.toISOString(),
        amount: 5000,
        method: "BANK_TRANSFER",
        memo: null,
      }),
    );

    expect(result.reconciledAmount).toBe(5000);
    expect(result.reconciliationStatus).toBe("PARTIALLY_RECONCILED");

    const header = await db
      .select()
      .from(schema.billingHeaders)
      .where(eq(schema.billingHeaders.id, billingId));
    expect(header[0].reconciledAmount).toBe(5000);
    expect(header[0].reconciliationStatus).toBe("PARTIALLY_RECONCILED");
  });

  it("累計入金額が請求額に達した場合、reconciliationStatusはRECONCILEDになる", async () => {
    const billingId = await createTestBilling();

    await withContext((c) =>
      getService(c).recordPaymentReceipt(c, billingId, {
        receivedDate: now.toISOString(),
        amount: 6000,
        method: "BANK_TRANSFER",
        memo: null,
      }),
    );
    const result = await withContext((c) =>
      getService(c).recordPaymentReceipt(c, billingId, {
        receivedDate: now.toISOString(),
        amount: 5000,
        method: "CASH",
        memo: "残額入金",
      }),
    );

    expect(result.reconciledAmount).toBe(11000);
    expect(result.reconciliationStatus).toBe("RECONCILED");
  });

  it("対象の請求が存在しない場合は404", async () => {
    await expect(
      withContext((c) =>
        getService(c).recordPaymentReceipt(c, "NOPE", {
          receivedDate: now.toISOString(),
          amount: 1000,
          method: "CASH",
          memo: null,
        }),
      ),
    ).rejects.toThrow("見つかりません");
  });
});
