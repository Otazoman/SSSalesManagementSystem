import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { taxCategoriesRouter } from "./index";

/**
 * 2-2(エラー処理統一)前の現状挙動を固定するキャラクタリゼーションテスト。
 * units/index.test.ts と同じ狙い(docs/target-architecture.md 15章参照)。
 * Phase 5(消費税マスタのadmin移動)時にmaster/tax-categoriesから移設。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.items);
  await db.delete(schema.units);
  await db.delete(schema.taxCategories);
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
});

async function postJson(path: string, method: string, body: unknown) {
    const ctx = createExecutionContext();
  const _res = await taxCategoriesRouter.request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

const validPayload = {
  code: "TAX_TEST",
  name: "テスト税区分",
  taxType: "STANDARD" as const,
  taxRate: 0.1,
};

describe("POST / (新規登録)", () => {
  it("正常登録は200・固定メッセージを返す", async () => {
    const res = await postJson("/register", "POST", validPayload);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "消費税区分を保存しました",
    });
  });
});

describe("PUT / (更新)", () => {
  it("既存コードの更新は200・固定メッセージを返す", async () => {
    await postJson("/register", "POST", validPayload);
    const res = await postJson("/", "PUT", {
      ...validPayload,
      name: "改名後",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "消費税区分を更新しました",
    });
  });
});

describe("DELETE /:code", () => {
  it("存在しないコードの削除は404・固定メッセージを返す", async () => {
        const ctx = createExecutionContext();
    const res = await taxCategoriesRouter.request(
      "/NOPE",
      { method: "DELETE" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "対象の消費税区分が見つかりません",
    });
  });

  it("存在するコードの削除は200・固定メッセージを返す", async () => {
    await postJson("/register", "POST", validPayload);
        const ctx = createExecutionContext();
    const res = await taxCategoriesRouter.request(
      "/TAX_TEST",
      { method: "DELETE" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "消費税区分を削除しました",
    });
  });

  it("品目マスタから参照されているコードの削除は400・使用件数入りメッセージを返す", async () => {
    await postJson("/register", "POST", validPayload);
    const now = new Date();
    await db.insert(schema.units).values({
      code: "pcs",
      name: "個",
      createdBy: "user-001",
      createdAt: now,
      updatedBy: "user-001",
      updatedAt: now,
    });
    await db.insert(schema.items).values({
      id: "ITEM-A",
      name: "品目A",
      baseUnitCode: "pcs",
      taxCategoryCode: "TAX_TEST",
      status: "active",
      createdBy: "user-001",
      createdAt: now,
      updatedBy: "user-001",
      updatedAt: now,
    });

        const ctx = createExecutionContext();
    const res = await taxCategoriesRouter.request(
      "/TAX_TEST",
      { method: "DELETE" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "この消費税区分は品目マスタで1件使用されているため削除できません",
    });
  });
});

describe("GET /", () => {
  it("登録済みデータをJSON配列で返す", async () => {
    await postJson("/register", "POST", validPayload);
        const ctx = createExecutionContext();
    const res = await taxCategoriesRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ code: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ code: "TAX_TEST", name: "テスト税区分" });
  });

  it("page/limit指定時は{data,pagination}形式で返す", async () => {
    await postJson("/register", "POST", validPayload);
    await postJson("/register", "POST", { ...validPayload, code: "TAX_TEST2" });
        const ctx = createExecutionContext();
    const res = await taxCategoriesRouter.request("/?page=1&limit=1", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ code: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });
});

// BUG-039: 他のマスタと同じく、CSVダウンロードとCSVインポートができる
describe("消費税マスタのCSV(BUG-039)", () => {
  async function importCsv(text: string) {
    const form = new FormData();
    form.append("file", new File([text], "tax.csv", { type: "text/csv" }));
    const ctx = createExecutionContext();
    const res = await taxCategoriesRouter.request("/bulk-register", { method: "POST", body: form }, env, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("CSVインポートで登録・更新でき、CSVダウンロードの内容をそのままインポートできる", async () => {
    const res = await importCsv(
      "code,name,taxType,taxRate,validFrom,validTo\nTAX_10,10%標準税率,STANDARD,0.1,2019-10-01,\nTAX_EXEMPT,非課税,EXEMPT,0,,\n",
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { message: string }).message).toContain("2 件");

    const ctx = createExecutionContext();
    const dl = await taxCategoriesRouter.request("/csv-download", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(dl.status).toBe(200);
    const csv = await dl.text();
    expect(csv).toContain('"TAX_10","10%標準税率","STANDARD","0.1","2019-10-01",""');

    // ダウンロードしたCSVをそのままインポートしても、内容は変わらない
    await db.delete(schema.taxCategories);
    expect((await importCsv(csv)).status).toBe(200);
    const rows = await db.select().from(schema.taxCategories);
    expect(rows.map((r) => [r.code, r.taxType, r.taxRate]).sort()).toEqual([
      ["TAX_10", "STANDARD", 0.1],
      ["TAX_EXEMPT", "EXEMPT", 0],
    ]);
  });

  it("不正な行があれば、行番号つきで理由を返し、何も登録しない", async () => {
    const res = await importCsv(
      "code,name,taxType,taxRate\nTAX_10,10%,STANDARD,0.1\nTAX_X,不正,UNKNOWN,0.1\nTAX_Y,不正,STANDARD,abc\n",
    );
    expect(res.status).toBe(400);
    const message = ((await res.json()) as { message: string }).message;
    expect(message).toContain("3行目: taxType");
    expect(message).toContain("4行目: taxRate");
    expect(await db.select().from(schema.taxCategories)).toHaveLength(0);
  });
});
