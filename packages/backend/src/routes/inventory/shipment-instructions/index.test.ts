import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { shipmentInstructionsRouter } from "./index";

/**
 * Item6 Phase6-4: 外部倉庫向け出荷指示API。承認機能OFF(COMPANY_SETTINGS未設定時のデフォルト)時の
 * 即時発行パスを中心に検証する(receipts/index.test.tsと同型)。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.itemShipmentInstructionItems);
  await db.delete(schema.itemShipmentInstructions);
  await db.delete(schema.warehouses);
  await db.delete(schema.items);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
  await db.delete(schema.partners);
  await db.delete(schema.users);

  const now = new Date();
  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.units).values({
    code: "PCS",
    name: "個",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.accounts).values({
    code: "ACC1",
    name: "品目",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.items).values({
    id: "ITEM1",
    name: "テスト品目",
    baseUnitCode: "PCS",
    accountCode: "ACC1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.warehouses).values({
    id: "WH1",
    name: "本社倉庫",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.warehouses).values({
    id: "WH2",
    name: "外部倉庫",
    warehouseType: "EXTERNAL",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.partners).values({
    id: "PARTNER1",
    name: "テスト得意先",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
});

async function postInstruction(body: unknown) {
  const ctx = createExecutionContext();
  const res = await shipmentInstructionsRouter.request(
    "/register",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const validBody = {
  partnerId: "PARTNER1",
  warehouseId: "WH2",
  instructedShipDate: "2026-08-25",
  items: [{ itemId: "ITEM1", instructedQuantity: 10 }],
};

describe("POST / (出荷指示作成)", () => {
  it("承認機能OFF時は即座にAPPROVED(発行済み)として作成される", async () => {
    const res = await postInstruction(validBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; headerId: string };
    expect(body.success).toBe(true);

    const header = await db
      .select()
      .from(schema.itemShipmentInstructions)
      .where(eq(schema.itemShipmentInstructions.id, body.headerId));
    expect(header[0].status).toBe("APPROVED");
    expect(header[0].partnerId).toBe("PARTNER1");
    expect(header[0].warehouseId).toBe("WH2");

    const items = await db
      .select()
      .from(schema.itemShipmentInstructionItems)
      .where(eq(schema.itemShipmentInstructionItems.instructionHeaderId, body.headerId));
    expect(items).toHaveLength(1);
    expect(items[0].instructedQuantity).toBe(10);
  });

  // Item7残課題8: 出荷指示/出庫の業務フロー統一により、自社倉庫(INTERNAL)向けの出荷指示も
  // 作成できるようにした(内部倉庫でも指示を起点に消込を行えるようにするため)
  it("自社倉庫(INTERNAL)を指定しても作成できる", async () => {
    const res = await postInstruction({ ...validBody, warehouseId: "WH1" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; headerId: string };
    expect(body.success).toBe(true);

    const header = await db
      .select()
      .from(schema.itemShipmentInstructions)
      .where(eq(schema.itemShipmentInstructions.id, body.headerId));
    expect(header[0].warehouseId).toBe("WH1");
  });

  it("存在しない取引先を指定すると404を返す", async () => {
    const res = await postInstruction({ ...validBody, partnerId: "NOPE" });
    expect(res.status).toBe(404);
  });

  it("存在しない倉庫を指定すると404を返す", async () => {
    const res = await postInstruction({ ...validBody, warehouseId: "NOPE" });
    expect(res.status).toBe(404);
  });

  it("存在しない品目を指定すると404を返す", async () => {
    const res = await postInstruction({
      ...validBody,
      items: [{ itemId: "NOPE", instructedQuantity: 1 }],
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /:id (出荷指示詳細)", () => {
  it("ヘッダー+明細を返す", async () => {
    const createRes = await postInstruction(validBody);
    const { headerId } = (await createRes.json()) as { headerId: string };

    const ctx = createExecutionContext();
    const res = await shipmentInstructionsRouter.request(`/${headerId}`, {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { header: { id: string }; items: unknown[] };
    expect(body.header.id).toBe(headerId);
    expect(body.items).toHaveLength(1);
  });

  it("存在しないIDは404を返す", async () => {
    const ctx = createExecutionContext();
    const res = await shipmentInstructionsRouter.request("/NOPE", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});

describe("GET / (出荷指示一覧) / GET /csv-download", () => {
  it("一覧取得できる", async () => {
    await postInstruction(validBody);
    const ctx = createExecutionContext();
    const res = await shipmentInstructionsRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("CSVを返す", async () => {
    await postInstruction(validBody);
    const ctx = createExecutionContext();
    const res = await shipmentInstructionsRouter.request("/csv-download", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("PARTNER1");
    expect(text).toContain("ITEM1");
  });
});

describe("POST /:id/generate-pdf", () => {
  it("存在しない出荷指示へのPDF生成は404を返す", async () => {
    const ctx = createExecutionContext();
    const res = await shipmentInstructionsRouter.request(
      "/NOPE/generate-pdf",
      { method: "POST" },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});

describe("GET /:id/csv (社内向け、1指示分のみのCSVダウンロード)", () => {
  it("対象指示のCSVを返す", async () => {
    const createRes = await postInstruction(validBody);
    const created = (await createRes.json()) as { headerId: string };

    const ctx = createExecutionContext();
    const res = await shipmentInstructionsRouter.request(
      `/${created.headerId}/csv`,
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("PARTNER1");
    expect(text).toContain("ITEM1");
  });

  it("存在しない出荷指示は404を返す", async () => {
    const ctx = createExecutionContext();
    const res = await shipmentInstructionsRouter.request("/NOPE/csv", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});
