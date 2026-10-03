import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { productsRouter } from "./index";

/**
 * 2-2(エラー処理統一)前の現状挙動を固定するキャラクタリゼーションテスト。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  // items を参照する他テーブル(他テストファイルの残留データを含む)を先に削除する
  await db.delete(schema.stocks);
  await db.delete(schema.itemPrices);
  await db.delete(schema.itemStructures);
  await db.delete(schema.itemAttachments);
  await db.delete(schema.items);
  await db.delete(schema.units);
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
    code: "pcs",
    name: "個",
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
});

async function postJson(path: string, body: unknown, method = "POST") {
    const ctx = createExecutionContext();
  const _res = await productsRouter.request(
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

describe("POST /register", () => {
  it("正常登録は200・品目名入りメッセージを返す", async () => {
    const res = await postJson("/register", { id: "ITEM-A", name: "品目A" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "品目「品目A」を登録しました",
      id: "ITEM-A",
    });
  });

  it("コード未入力の場合、master_code_formatsの設定(既定PRD+4桁)に基づき自動採番される", async () => {
    const res = await postJson("/register", { name: "品目B" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^PRD-\d{4}$/);
  });

  it("重複IDの登録は400・固定メッセージを返す", async () => {
    await postJson("/register", { id: "ITEM-A", name: "品目A" });
    const res = await postJson("/register", { id: "ITEM-A", name: "品目A2" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "品目コード「ITEM-A」は既に登録されています",
    });
  });
});

describe("PUT /:id", () => {
  it("存在しないIDの更新は404・固定メッセージを返す", async () => {
    const res = await postJson(
      "/NOPE",
      { name: "品目A", status: "active" },
      "PUT",
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "対象レコードが見つかりません",
    });
  });

  it("存在するIDの更新は200・固定メッセージを返す", async () => {
    await postJson("/register", { id: "ITEM-A", name: "品目A" });
    const res = await postJson(
      "/ITEM-A",
      { name: "品目A改", status: "active" },
      "PUT",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "品目データを更新しました",
    });
  });
});

describe("POST /:id/suspend", () => {
  it("停止処理は200・固定メッセージを返す", async () => {
    await postJson("/register", { id: "ITEM-A", name: "品目A" });
        const ctx = createExecutionContext();
    const res = await productsRouter.request(
      "/ITEM-A/suspend",
      { method: "POST" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "該当品目を一時停止しました",
    });
  });
});

describe("DELETE /:id", () => {
  it("存在しないIDの削除は404・固定メッセージを返す", async () => {
        const ctx = createExecutionContext();
    const res = await productsRouter.request(
      "/NOPE",
      { method: "DELETE" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "対象の品目が見つかりません",
    });
  });

  it("存在するIDの削除は200・固定メッセージを返す(itemPricesを持たない品目)", async () => {
    // POST /register は必ずitemPricesを自動生成するため、価格レコードを持たない商品を
    // 直接DBへ投入してdeleteProductの本来の成功パスを検証する(削除ガードのためsuspended必須)
    const now = new Date();
    await db.insert(schema.items).values({
      id: "ITEM-A",
      name: "品目A",
      baseUnitCode: "pcs",
      status: "suspended",
      createdBy: "user-001",
      createdAt: now,
      updatedBy: "user-001",
      updatedAt: now,
    });

        const ctx = createExecutionContext();
    const res = await productsRouter.request(
      "/ITEM-A",
      { method: "DELETE" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "品目を完全に削除しました(R2ファイルも自動消去)",
    });
  });

  it("POST /registerで作成した品目(itemPrices自動生成込み)も削除できる", async () => {
    // createProduct()は標準売単価・仕入単価のitemPricesを無条件に2件自動生成する。
    // 以前はdeleteProduct()がitemPricesを削除せずFK制約違反で常に500になるバグがあったが、
    // itemPricesも合わせて削除するよう修正済み。削除ガードのため一度suspendedにしてから削除する。
    await postJson("/register", { id: "ITEM-A", name: "品目A" });
    await postJson("/ITEM-A", { name: "品目A", status: "suspended" }, "PUT");
        const ctx = createExecutionContext();
    const res = await productsRouter.request(
      "/ITEM-A",
      { method: "DELETE" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "品目を完全に削除しました(R2ファイルも自動消去)",
    });
  });

  it("suspended状態でない品目は削除拒否(400)される", async () => {
    await postJson("/register", { id: "ITEM-A", name: "品目A" });
        const ctx = createExecutionContext();
    const res = await productsRouter.request(
      "/ITEM-A",
      { method: "DELETE" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "削除拒否: 無効化状態の品目のみ物理削除できます",
    });
  });
});

describe("POST /bulk-register", () => {
  async function postCsvJson(csvData: string) {
        const ctx = createExecutionContext();
    const _res = await productsRouter.request(
      "/bulk-register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvData }),
      },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    return _res;
  }

  it("空データは400・固定メッセージを返す", async () => {
    const res = await postCsvJson("");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "CSVデータが空か不正です",
    });
  });

  it("データ行が無い場合は400・固定メッセージを返す", async () => {
    const res = await postCsvJson("id,name");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "CSVにデータ行が含まれていません",
    });
  });

  it("必須列(id,name)が無い場合は400・固定メッセージを返す", async () => {
    const res = await postCsvJson("foo,bar\n1,2");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "CSVに必要な列(id, name)がありません",
    });
  });

  it("存在しないbaseUnitCodeを指定した行はFK制約違反で400・マスタ同期エラーの案内文を返す", async () => {
    // 元々は String(err) が Drizzle の .cause を見ないため案内文が出ない不具合があったが、
    // 2-2でisForeignKeyConstraintError()へ統一し修正済み(accountsと同種の修正)。
    const res = await postCsvJson(
      "id,name,baseUnitCode\nITEM-X,品目X,NOPEUNIT",
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message:
        "【マスタ同期エラー】品目コード [ITEM-X] の登録でエラーが発生しました。DBスキーマの同期を確認するか、CSVで指定されている「基本単位(baseUnitCode)」「消費税区分(taxCategoryCode)」「勘定科目(accountCode)」または「仕入先コード(supplierId)」が登録されているか確認してください。",
    });
  });

  it("正常なCSVは200・件数入りメッセージを返す", async () => {
    const res = await postCsvJson("id,name\nITEM-A,品目A");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "CSVから 1 件の品目データを同期(更新)しました",
    });
  });
});

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await postJson("/register", { id: "ITEM-A", name: "品目A" });
        const ctx = createExecutionContext();
    const res = await productsRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; attachments: unknown[] }>;
    expect(body.some((p) => p.id === "ITEM-A")).toBe(true);
    expect(body[0]).toHaveProperty("attachments");
  });

  it("page/limit指定時は既存の検索条件を維持したまま{data,pagination}形式で返す", async () => {
    await postJson("/register", { id: "ITEM-A", name: "品目A" });
    await postJson("/register", { id: "ITEM-B", name: "品目B" });
        const ctx = createExecutionContext();
    const res = await productsRouter.request("/?page=1&limit=1", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });
});
