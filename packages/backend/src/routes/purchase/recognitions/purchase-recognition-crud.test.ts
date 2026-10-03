import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as journalSchema from "../../../db/journal-schema";
import { postPurchaseRecognitionJournal } from "../../admin/journal-sources/document-posting";
import { PurchaseRecognitionRepository } from "./purchase-recognition.repository";
import { PurchaseRecognitionService } from "./purchase-recognition.service";
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
    const repo = new PurchaseRecognitionRepository(c.env.DB);
    c.set("service" as never, new PurchaseRecognitionService(repo) as never);
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

function getService(c: any): PurchaseRecognitionService {
  return c.get("service" as never) as PurchaseRecognitionService;
}

beforeEach(async () => {
  await journalDb.delete(journalSchema.journalLines);
  await journalDb.delete(journalSchema.journalBatches);
  await db.delete(schema.journalPostingEvents);
  await db.delete(schema.journalPostingRules);
  await db.delete(schema.purchaseRecognitionAttachments);
  await db.delete(schema.purchaseRecognitionHistoryLogs);
  await db.delete(schema.purchaseRecognitionReceipts);
  await db.delete(schema.purchaseRecognitionItems);
  await db.delete(schema.purchaseRecognitions);
  await db.delete(schema.itemReceiptHeaders);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
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
    name: "仕入先1",
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

async function seedOrder(id: string, itemQuantity = 10, isPaid = false) {
  await db.insert(schema.orders).values({
    id,
    partnerId: "P-1",
    orderDate: now,
    status: "APPROVED",
    totalAmount: itemQuantity * 1000,
    taxAmount: Math.round(itemQuantity * 1000 * 0.1),
    isPaid,
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  const itemId = `${id}-ITEM-1`;
  await db.insert(schema.orderItems).values({
    id: itemId,
    orderId: id,
    itemId: "ITEM-1",
    itemName: "品目A",
    quantity: itemQuantity,
    unitPrice: 1000,
    taxCategoryCode: "TAX_10",
    sortOrder: 0,
  });
  return itemId;
}

describe("PurchaseRecognitionCrudService: 新規登録・承認機能OFF時の直接確定", () => {
  it("承認機能が無効な場合、submitForApprovalで直接APPROVEDになる(自動転記はされず、選択して仕訳を作成できる)", async () => {
    await db.insert(schema.accounts).values([
      { code: "5101", name: "仕入高", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
      { code: "2101", name: "買掛金", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
      { code: "1401", name: "仮払消費税", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    ]);
    await db.insert(schema.journalPostingRules).values({
      eventType: "PURCHASE",
      variableAccountPriority: "ITEM_MASTER_FIRST",
      variableAccountFallbackCode: "5101",
      payableAccountCode: "2101",
      taxAccountCode: "1401",
      enabled: true,
      updatedBy: "EMP001",
      updatedAt: now,
    });

    const formData = new FormData();
    formData.append(
      "recognitionData",
      JSON.stringify({
        title: "テスト仕入",
        partnerId: "P-1",
        recognitionDate: now.toISOString(),
        totalAmount: 11000,
        taxAmount: 1000,
        items: [
          { itemId: "ITEM-1", itemName: "品目A", quantity: 1, unitPrice: 10000, taxCategoryCode: "TAX_10" },
        ],
      }),
    );

    const created = await withContext((c) =>
      getService(c).createRecognition(c, formData, JSON.parse(formData.get("recognitionData") as string)),
    );
    expect(created.success).toBe(true);
    const recognitionId = (created as any).id as string;

    const submitResult = await withContext((c) => getService(c).submitForApproval(c, recognitionId));
    expect(submitResult.success).toBe(true);

    const recognitionRows = await db
      .select()
      .from(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.id, recognitionId));
    expect(recognitionRows[0]?.status).toBe("APPROVED");

    // V-4: 承認(確定)しただけでは自動転記されない。仕訳データ出力画面と同じく、伝票を選んで仕訳にする
    expect(await journalDb.select().from(journalSchema.journalBatches)).toHaveLength(0);
    const posted = await postPurchaseRecognitionJournal({
      db: env.DB,
      dbJournal: env.DB_JOURNAL,
      companySettings: env.COMPANY_SETTINGS,
      sourceRefId: recognitionId,
      performedById: "EMP001",
    });
    expect(posted.ok && posted.result.status).toBe("POSTED");

    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches).toHaveLength(1);
    expect(batches[0].totalDebitAmount).toBe(11000);
  });

  it("K-2-b: 明細の勘定科目が設定されていれば品目マスタの科目より優先して仕訳になる", async () => {
    await db.insert(schema.accounts).values([
      { code: "5101", name: "仕入高(フォールバック)", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
      { code: "5102", name: "仕入高(品目マスタ)", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
      { code: "5103", name: "仕入高(明細指定)", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
      { code: "2101", name: "買掛金", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
      { code: "1401", name: "仮払消費税", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    ]);
    await db.insert(schema.journalPostingRules).values({
      eventType: "PURCHASE",
      variableAccountPriority: "ITEM_MASTER_FIRST",
      variableAccountFallbackCode: "5101",
      payableAccountCode: "2101",
      taxAccountCode: "1401",
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
      accountCode: "5102",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });

    const formData = new FormData();
    formData.append(
      "recognitionData",
      JSON.stringify({
        title: "テスト仕入(明細科目指定)",
        partnerId: "P-1",
        recognitionDate: now.toISOString(),
        totalAmount: 11000,
        taxAmount: 1000,
        items: [
          {
            itemId: "ITEM-1",
            itemName: "品目A",
            quantity: 1,
            unitPrice: 10000,
            taxCategoryCode: "TAX_10",
            accountCode: "5103",
          },
        ],
      }),
    );

    const created = await withContext((c) =>
      getService(c).createRecognition(c, formData, JSON.parse(formData.get("recognitionData") as string)),
    );
    const recognitionId = (created as any).id as string;
    await withContext((c) => getService(c).submitForApproval(c, recognitionId));

    // V-4: 承認(確定)しただけでは自動転記されない。仕訳データ出力画面と同じく、伝票を選んで仕訳にする
    expect(await journalDb.select().from(journalSchema.journalBatches)).toHaveLength(0);
    const posted = await postPurchaseRecognitionJournal({
      db: env.DB,
      dbJournal: env.DB_JOURNAL,
      companySettings: env.COMPANY_SETTINGS,
      sourceRefId: recognitionId,
      performedById: "EMP001",
    });
    expect(posted.ok && posted.result.status).toBe("POSTED");

    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches).toHaveLength(1);
    const lines = await journalDb
      .select()
      .from(journalSchema.journalLines)
      .where(eq(journalSchema.journalLines.batchId, batches[0].id));
    const debitLine = lines.find((l) => l.side === "DEBIT" && l.amount === 10000);
    expect(debitLine?.accountCode).toBe("5103");
  });
});

describe("PurchaseRecognitionCrudService: documentTypeバリデーション", () => {
  it("RETURN指定でoriginalRecognitionId未指定の場合はBadRequestError", async () => {
    const formData = new FormData();
    const body = {
      partnerId: "P-1",
      recognitionDate: now.toISOString(),
      documentType: "RETURN",
      totalAmount: 1000,
      taxAmount: 100,
      items: [],
    };
    formData.append("recognitionData", JSON.stringify(body));

    await expect(
      withContext((c) => getService(c).createRecognition(c, formData, body as any)),
    ).rejects.toThrow(/元仕入伝票/);
  });

  it("追加要望L-2-a: DISCOUNTも元伝票必須だが、赤伝(訂正)=CORRECTIONは元伝票なしの自由入力を起票できる", async () => {
    const base = { partnerId: "P-1", recognitionDate: now.toISOString(), totalAmount: 1000, taxAmount: 100, items: [] };

    const discount = { ...base, documentType: "DISCOUNT" };
    const fd1 = new FormData();
    fd1.append("recognitionData", JSON.stringify(discount));
    await expect(withContext((c) => getService(c).createRecognition(c, fd1, discount as any))).rejects.toThrow(/元仕入伝票/);

    const correction = { ...base, documentType: "CORRECTION" };
    const fd2 = new FormData();
    fd2.append("recognitionData", JSON.stringify(correction));
    const created = await withContext((c) => getService(c).createRecognition(c, fd2, correction as any));
    expect((created as any).id).toBeTruthy();
  });
});

describe("PurchaseRecognitionCrudService: 発注明細単位の残数量検証", () => {
  it("発注数量を超える数量で仕入を起票するとBadRequestError(基準=発注数量)", async () => {
    const orderItemId = await seedOrder("PO-1", 10);
    const formData = new FormData();
    const body = {
      partnerId: "P-1",
      orderId: "PO-1",
      recognitionDate: now.toISOString(),
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
    formData.append("recognitionData", JSON.stringify(body));

    await expect(
      withContext((c) => getService(c).createRecognition(c, formData, body as any)),
    ).rejects.toThrow(/残数量/);
  });

  it("発注数量の範囲内なら仕入を起票でき、2回目の起票は残数量から差し引かれる", async () => {
    const orderItemId = await seedOrder("PO-2", 10);

    const makeBody = (qty: number) => ({
      partnerId: "P-1",
      orderId: "PO-2",
      recognitionDate: now.toISOString(),
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
    formData1.append("recognitionData", JSON.stringify(body1));
    const created1 = await withContext((c) => getService(c).createRecognition(c, formData1, body1 as any));
    const id1 = (created1 as any).id as string;
    // APPROVEDにしないと残数量計算に反映されない(getRecognizedQuantitiesByOrderItemIdsはAPPROVEDのみ集計)
    await withContext((c) => getService(c).submitForApproval(c, id1));

    // 残り4のところへ5を起票しようとするとエラー
    const formData2 = new FormData();
    const body2 = makeBody(5);
    formData2.append("recognitionData", JSON.stringify(body2));
    await expect(
      withContext((c) => getService(c).createRecognition(c, formData2, body2 as any)),
    ).rejects.toThrow(/残数量/);

    // 残り4ちょうどなら成功する
    const formData3 = new FormData();
    const body3 = makeBody(4);
    formData3.append("recognitionData", JSON.stringify(body3));
    const created3 = await withContext((c) => getService(c).createRecognition(c, formData3, body3 as any));
    expect(created3.success).toBe(true);
  });
});

describe("PurchaseRecognitionCrudService: L-1-b 対象検収の紐づけ", () => {
  async function seedReceipt(id: string, partnerId: string | null = "P-1") {
    await db.insert(schema.itemReceiptHeaders).values({
      id,
      partnerId,
      receivedDate: now,
      status: "APPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });
  }

  function payload(extra: Record<string, unknown> = {}) {
    return {
      partnerId: "P-1",
      recognitionDate: now.toISOString(),
      totalAmount: 1000,
      taxAmount: 100,
      items: [],
      ...extra,
    };
  }

  async function create(extra: Record<string, unknown> = {}) {
    const body = payload(extra);
    const created = await withContext((c) =>
      getService(c).createRecognition(c, new FormData(), body as any),
    );
    return (created as any).id as string;
  }

  async function linkedIds(recognitionId: string) {
    const rows = await db
      .select()
      .from(schema.purchaseRecognitionReceipts)
      .where(eq(schema.purchaseRecognitionReceipts.purchaseRecognitionId, recognitionId));
    return rows.map((r) => r.itemReceiptId).sort();
  }

  it("作成時にreceiptIdsを指定すると紐づけが保存され、詳細にreceiptIdsとして返る(重複は1件にまとめる)", async () => {
    await seedReceipt("RCPT-1");
    await seedReceipt("RCPT-2");

    const id = await create({ receiptIds: ["RCPT-1", "RCPT-2", "RCPT-1"] });

    expect(await linkedIds(id)).toEqual(["RCPT-1", "RCPT-2"]);
    const detail = await withContext((c) => getService(c).getRecognitionDetail(c, id));
    expect([...(detail as any).receiptIds].sort()).toEqual(["RCPT-1", "RCPT-2"]);
  });

  it("receiptIds未指定なら紐づけなし。更新でreceiptIds未指定なら既存の紐づけを維持する", async () => {
    await seedReceipt("RCPT-1");
    const id = await create({ receiptIds: ["RCPT-1"] });

    await withContext((c) =>
      getService(c).updateRecognition(c, id, new FormData(), payload({ memo: "更新" }) as any),
    );

    expect(await linkedIds(id)).toEqual(["RCPT-1"]);
    const noLinks = await create();
    expect(await linkedIds(noLinks)).toEqual([]);
  });

  it("更新でreceiptIdsを指定すると置き換わり、空配列なら紐づけ解除される", async () => {
    await seedReceipt("RCPT-1");
    await seedReceipt("RCPT-2");
    const id = await create({ receiptIds: ["RCPT-1"] });

    await withContext((c) =>
      getService(c).updateRecognition(c, id, new FormData(), payload({ receiptIds: ["RCPT-2"] }) as any),
    );
    expect(await linkedIds(id)).toEqual(["RCPT-2"]);

    await withContext((c) =>
      getService(c).updateRecognition(c, id, new FormData(), payload({ receiptIds: [] }) as any),
    );
    expect(await linkedIds(id)).toEqual([]);
  });

  it("存在しない検収を指定するとNotFoundErrorで、仕入自体も作られない", async () => {
    await expect(create({ id: "SR-NOPE", receiptIds: ["NOPE"] })).rejects.toThrow("検収記録の一部が見つかりません");

    const rows = await db.select().from(schema.purchaseRecognitions);
    expect(rows).toHaveLength(0);
  });

  it("取引先が仕入先と異なる検収はBadRequestError", async () => {
    await db.insert(schema.partners).values({
      id: "P-2",
      name: "仕入先2",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await seedReceipt("RCPT-OTHER", "P-2");

    await expect(create({ receiptIds: ["RCPT-OTHER"] })).rejects.toThrow("取引先が仕入の取引先と一致しません");
  });

  it("返品(RETURN)など通常仕入以外には紐づけを保存しない", async () => {
    await seedReceipt("RCPT-1");
    const original = await create();

    const id = await create({
      documentType: "RETURN",
      originalRecognitionId: original,
      receiptIds: ["RCPT-1"],
    });

    expect(await linkedIds(id)).toEqual([]);
  });

  it("仕入を削除すると紐づけも一緒に削除され、検収記録は残る", async () => {
    await seedReceipt("RCPT-1");
    const id = await create({ receiptIds: ["RCPT-1"] });

    await withContext((c) => getService(c).deleteRecognition(c, id));

    expect(await linkedIds(id)).toEqual([]);
    const receipts = await db.select().from(schema.itemReceiptHeaders);
    expect(receipts).toHaveLength(1);
  });
});

describe("PurchaseRecognitionCrudService: 削除", () => {
  it("DRAFT状態の仕入は直接削除できる", async () => {
    const formData = new FormData();
    const body = {
      partnerId: "P-1",
      recognitionDate: now.toISOString(),
      totalAmount: 1000,
      taxAmount: 100,
      items: [],
    };
    formData.append("recognitionData", JSON.stringify(body));
    const created = await withContext((c) => getService(c).createRecognition(c, formData, body as any));
    const id = (created as any).id as string;

    const result = await withContext((c) => getService(c).deleteRecognition(c, id));
    expect(result.success).toBe(true);

    const rows = await db
      .select()
      .from(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.id, id));
    expect(rows).toHaveLength(0);
  });

  it("APPROVED状態の仕入を直接削除しようとするとBadRequestError", async () => {
    const formData = new FormData();
    const body = {
      partnerId: "P-1",
      recognitionDate: now.toISOString(),
      totalAmount: 1000,
      taxAmount: 100,
      items: [],
    };
    formData.append("recognitionData", JSON.stringify(body));
    const created = await withContext((c) => getService(c).createRecognition(c, formData, body as any));
    const id = (created as any).id as string;
    await withContext((c) => getService(c).submitForApproval(c, id));

    await expect(withContext((c) => getService(c).deleteRecognition(c, id))).rejects.toThrow(
      /削除申請/,
    );
  });
});

describe("PurchaseRecognitionCrudService: 発注から選択ピッカー用の残数量取得", () => {
  it("発注数量基準(is_purchase_recognition_requires_receipt未設定)で残数量を返す", async () => {
    const orderItemId = await seedOrder("PO-PROG-1", 10);

    const progress = await withContext((c) => getService(c).getOrderRecognitionProgress(c, "PO-PROG-1"));
    expect(progress).toHaveLength(1);
    expect(progress[0].sourceOrderItemId).toBe(orderItemId);
    expect(progress[0].basis).toBe("ORDERED");
    expect(progress[0].remainingQuantity).toBe(10);

    // 6個仕入計上(APPROVED)すると残数量が4になる
    const formData = new FormData();
    const body = {
      partnerId: "P-1",
      orderId: "PO-PROG-1",
      recognitionDate: now.toISOString(),
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
    formData.append("recognitionData", JSON.stringify(body));
    const created = await withContext((c) => getService(c).createRecognition(c, formData, body as any));
    await withContext((c) => getService(c).submitForApproval(c, (created as any).id));

    const progressAfter = await withContext((c) =>
      getService(c).getOrderRecognitionProgress(c, "PO-PROG-1"),
    );
    expect(progressAfter[0].remainingQuantity).toBe(4);
  });

  it("存在しない発注IDはNotFoundError", async () => {
    await expect(
      withContext((c) => getService(c).getOrderRecognitionProgress(c, "NOPE")),
    ).rejects.toThrow(/発注が見つかりません/);
  });
});
