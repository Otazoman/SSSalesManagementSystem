import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { productPricesRouter } from "./index";

/**
 * 2-2(エラー処理統一)前の現状挙動を固定するキャラクタリゼーションテスト。
 */

const db = drizzle(env.DB, { schema });

async function seedItem(id: string, status = "active") {
  const now = new Date();
  await db.insert(schema.items).values({
    id,
    name: `品目${id}`,
    baseUnitCode: "PCS",
    status,
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
}

beforeEach(async () => {
  // items を参照する他テーブル(他テストファイルの残留データを含む)を先に削除する
  await db.delete(schema.itemPrices);
  await db.delete(schema.itemStructures);
  await db.delete(schema.itemAttachments);
  await db.delete(schema.items);
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
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
});

async function postJson(path: string, body: unknown) {
    const ctx = createExecutionContext();
  const _res = await productPricesRouter.request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

describe("POST /register", () => {
  it("存在しない品目コードは400・固定メッセージを返す", async () => {
    const res = await postJson("/register", {
      itemId: "NOPE",
      priceType: "SALES",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "品目コード [NOPE] は存在しません",
    });
  });

  it("取引停止中の品目は400・品名入りメッセージを返す", async () => {
    await seedItem("ITEM-A", "temporary");
    const res = await postJson("/register", {
      itemId: "ITEM-A",
      priceType: "SALES",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "品目「品目ITEM-A」は取引停止または審査中です",
    });
  });

  it("partnerId未指定の新規登録は200・標準単価メッセージを返す(即active)", async () => {
    await seedItem("ITEM-A");
    const res = await postJson("/register", {
      itemId: "ITEM-A",
      priceType: "SALES",
      unitPrice: 100,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      id: expect.any(String),
      message: "標準単価設定を新規登録しました",
    });
  });

  // 💡 以前はpartnerId指定の有無だけで初期status(temporary/active)を決めていたが、
  // 承認機能展開(残り6マスタ)により他マスタと同じ「会社設定のワークフロー有効フラグに従う」
  // 方式に統一した。COMPANY_SETTINGSが未設定(このテスト環境の既定)の間はOFF相当として扱われ、
  // partnerId指定の有無に関わらずactiveで新規登録される。
  it("partnerId指定の新規登録も、ワークフロー未設定環境ではactiveで新規登録される", async () => {
    await seedItem("ITEM-A");
    const now = new Date();
    await db.insert(schema.partners).values({
      id: "P-1",
      name: "取引先1",
      createdBy: "user-001",
      createdAt: now,
      updatedBy: "user-001",
      updatedAt: now,
    });
    const res = await postJson("/register", {
      itemId: "ITEM-A",
      priceType: "SALES",
      partnerId: "P-1",
      unitPrice: 200,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      id: expect.any(String),
      message: "標準単価設定を新規登録しました",
    });

        const ctx = createExecutionContext();
    const listRes = await productPricesRouter.request(
      "/?itemId=ITEM-A&partnerId=P-1",
      {},
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    const list = (await listRes.json()) as Array<{ status: string }>;
    expect(list[0].status).toBe("active");
  });

  it("既存レコードへの再登録は200・更新メッセージを返す", async () => {
    await seedItem("ITEM-A");
    await postJson("/register", {
      itemId: "ITEM-A",
      priceType: "SALES",
      unitPrice: 100,
    });
    const res = await postJson("/register", {
      itemId: "ITEM-A",
      priceType: "SALES",
      unitPrice: 150,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      id: expect.any(String),
      message: "標準単価設定を更新しました",
    });
  });
});

describe("DELETE /:id", () => {
  it("suspended状態でない単価設定は削除拒否(400)される", async () => {
    await seedItem("ITEM-A");
    await postJson("/register", {
      itemId: "ITEM-A",
      priceType: "SALES",
      unitPrice: 100,
    });
        const ctx = createExecutionContext();
    const listRes = await productPricesRouter.request(
      "/?itemId=ITEM-A",
      {},
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    const list = (await listRes.json()) as Array<{ id: string }>;
    const targetId = list[0].id;

        const ctx2 = createExecutionContext();
    const res = await productPricesRouter.request(
      `/${targetId}`,
      { method: "DELETE" },
      env, ctx2
    );
    await waitOnExecutionContext(ctx2);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "削除拒否: 無効化状態の単価設定のみ物理削除できます",
    });
  });

  it("suspended状態にしてから削除すると200・固定メッセージを返す", async () => {
    await seedItem("ITEM-A");
    await postJson("/register", {
      itemId: "ITEM-A",
      priceType: "SALES",
      unitPrice: 100,
    });
        const ctx = createExecutionContext();
    const listRes = await productPricesRouter.request(
      "/?itemId=ITEM-A",
      {},
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    const list = (await listRes.json()) as Array<{ id: string }>;
    const targetId = list[0].id;

    await postJson("/register", {
      id: targetId,
      itemId: "ITEM-A",
      priceType: "SALES",
      unitPrice: 100,
      status: "suspended",
    });

        const ctx2 = createExecutionContext();
    const res = await productPricesRouter.request(
      `/${targetId}`,
      { method: "DELETE" },
      env, ctx2
    );
    await waitOnExecutionContext(ctx2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: "単価設定を削除しました" });
  });

  it("存在しないIDの削除は404を返す", async () => {
        const ctx = createExecutionContext();
    const res = await productPricesRouter.request(
      "/NOPE",
      { method: "DELETE" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});

describe("GET / (マスタ管理モード)", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await seedItem("ITEM-A");
    await postJson("/register", { itemId: "ITEM-A", priceType: "SALES", unitPrice: 100 });
        const ctx = createExecutionContext();
    const res = await productPricesRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ itemId: string }>;
    expect(body.some((p) => p.itemId === "ITEM-A")).toBe(true);
  });

  it("quantity指定(計算モード)時はpage/limitがあっても配列のまま返す", async () => {
    await seedItem("ITEM-A");
    await postJson("/register", { itemId: "ITEM-A", priceType: "SALES", unitPrice: 100 });
        const ctx = createExecutionContext();
    const res = await productPricesRouter.request(
      "/?quantity=1&page=1&limit=1",
      {},
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("page/limit指定時は既存の検索条件を維持したまま{data,pagination}形式で返す", async () => {
    await seedItem("ITEM-A");
    await postJson("/register", {
      itemId: "ITEM-A",
      priceType: "SALES",
      minQuantity: 0,
      unitPrice: 100,
    });
    await postJson("/register", {
      itemId: "ITEM-A",
      priceType: "SALES",
      minQuantity: 10,
      unitPrice: 90,
    });
        const ctx = createExecutionContext();
    const res = await productPricesRouter.request(
      "/?itemId=ITEM-A&page=1&limit=1",
      {},
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ itemId: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });
});
