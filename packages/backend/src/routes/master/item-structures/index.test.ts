import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { itemStructuresRouter } from "./index";

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
  await db.delete(schema.itemStructures);
  await db.delete(schema.itemPrices);
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
  const _res = await itemStructuresRouter.request(
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
  it("親子が同一IDは400・固定メッセージを返す", async () => {
    await seedItem("ITEM-A");
    const res = await postJson("/register", {
      parentItemId: "ITEM-A",
      childItemId: "ITEM-A",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message:
        "統制エラー: 自分自身を構成部品(子品目)として登録することはできません",
    });
  });

  it("子品目が存在しない場合は400・固定メッセージを返す", async () => {
    await seedItem("ITEM-A");
    const res = await postJson("/register", {
      parentItemId: "ITEM-A",
      childItemId: "NOPE",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "指定された子部品が存在しません",
    });
  });

  it("子品目が停止中の場合は400・品名入りメッセージを返す", async () => {
    await seedItem("ITEM-A");
    await seedItem("ITEM-B", "suspended");
    const res = await postJson("/register", {
      parentItemId: "ITEM-A",
      childItemId: "ITEM-B",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message:
        "統制エラー: 子部品「品目ITEM-B」は取引停止状態のため構成に採用できません",
    });
  });

  it("新規登録は200・リビジョン入りメッセージを返す", async () => {
    await seedItem("ITEM-A");
    await seedItem("ITEM-B");
    const res = await postJson("/register", {
      parentItemId: "ITEM-A",
      childItemId: "ITEM-B",
      revision: "2.0",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      id: expect.any(String),
      message: "リビジョン [2.0] の親子構成を新規定義しました",
    });
  });

  it("既存の親子リビジョンへの再登録は200・更新メッセージを返す", async () => {
    await seedItem("ITEM-A");
    await seedItem("ITEM-B");
    await postJson("/register", {
      parentItemId: "ITEM-A",
      childItemId: "ITEM-B",
      revision: "1.0",
      quantityRequired: 1,
    });
    const res = await postJson("/register", {
      parentItemId: "ITEM-A",
      childItemId: "ITEM-B",
      revision: "1.0",
      quantityRequired: 5,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      id: expect.any(String),
      message: "リビジョン [1.0] の構成数量を更新しました",
    });
  });
});

describe("DELETE /:id", () => {
  it("存在しないIDの削除は404・固定メッセージを返す", async () => {
        const ctx = createExecutionContext();
    const res = await itemStructuresRouter.request(
      "/NOPE",
      { method: "DELETE" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "該当構成レコードが見つかりません",
    });
  });

  it("active状態の構成削除は400・無効化を先に要求する固定メッセージを返す", async () => {
    await seedItem("ITEM-A");
    await seedItem("ITEM-B");
    await postJson("/register", {
      parentItemId: "ITEM-A",
      childItemId: "ITEM-B",
      revision: "1.0",
    });
        const ctx = createExecutionContext();
    const listRes = await itemStructuresRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const list = (await listRes.json()) as Array<{ id: string }>;
    const targetId = list[0].id;

        const ctx2 = createExecutionContext();
    const res = await itemStructuresRouter.request(
      `/${targetId}`,
      { method: "DELETE" },
      env, ctx2
    );
    await waitOnExecutionContext(ctx2);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "削除拒否: 無効化状態の構成定義のみ物理削除できます",
    });
  });

  it("無効化(suspend)済みIDの削除は200・固定メッセージを返す", async () => {
    await seedItem("ITEM-A");
    await seedItem("ITEM-B");
    await postJson("/register", {
      parentItemId: "ITEM-A",
      childItemId: "ITEM-B",
      revision: "1.0",
    });
        const ctx = createExecutionContext();
    const listRes = await itemStructuresRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const list = (await listRes.json()) as Array<{ id: string }>;
    const targetId = list[0].id;

    const suspendCtx = createExecutionContext();
    await itemStructuresRouter.request(
      `/${targetId}/suspend`,
      { method: "POST" },
      env,
      suspendCtx,
    );
    await waitOnExecutionContext(suspendCtx);

        const ctx2 = createExecutionContext();
    const res = await itemStructuresRouter.request(
      `/${targetId}`,
      { method: "DELETE" },
      env, ctx2
    );
    await waitOnExecutionContext(ctx2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "品目構成の定義を削除しました",
    });
  });
});

describe("POST /bulk-register", () => {
  it("PK重複によるinsert失敗は400・行番号入りメッセージを返す", async () => {
    await seedItem("ITEM-A");
    await seedItem("ITEM-B");
    await seedItem("ITEM-C");
    // 既存の構成を1件作り、そのidを別の親子組で再利用してPK衝突を起こす
    await postJson("/register", {
      parentItemId: "ITEM-A",
      childItemId: "ITEM-B",
      revision: "1.0",
    });
        const ctx = createExecutionContext();
    const listRes = await itemStructuresRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const list = (await listRes.json()) as Array<{ id: string }>;
    const existingId = list[0].id;

    const csv = [
      "id,parentItemId,childItemId,quantityRequired,revision,validFrom,validTo,memo",
      `${existingId},ITEM-A,ITEM-C,1,2.0,,,`,
    ].join("\n");

    const formData = new FormData();
    formData.set("file", new File([csv], "bom.csv", { type: "text/csv" }));
        const ctx2 = createExecutionContext();
    const res = await itemStructuresRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env, ctx2
    );
    await waitOnExecutionContext(ctx2);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(false);
    expect(body.message).toContain("CSV解析エラー");
    expect(body.message).toContain("親: ITEM-A -> 子: ITEM-C");
  });

  it("正常なCSVは200・件数入りメッセージを返す", async () => {
    await seedItem("ITEM-A");
    await seedItem("ITEM-B");
    const csv = [
      "id,parentItemId,childItemId,quantityRequired,revision,validFrom,validTo,memo",
      ",ITEM-A,ITEM-B,1,1.0,,,",
    ].join("\n");
    const formData = new FormData();
    formData.set("file", new File([csv], "bom.csv", { type: "text/csv" }));
        const ctx = createExecutionContext();
    const res = await itemStructuresRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "CSVから 1 件の品目構成(BOM)データを正常に同期しました",
    });
  });
});

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await seedItem("ITEM-A");
    await seedItem("ITEM-B");
    await postJson("/register", { parentItemId: "ITEM-A", childItemId: "ITEM-B" });
        const ctx = createExecutionContext();
    const res = await itemStructuresRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ childItemId: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].childItemId).toBe("ITEM-B");
  });

  it("page/limit指定時は既存の検索条件を維持したまま{data,pagination}形式で返す", async () => {
    await seedItem("ITEM-A");
    await seedItem("ITEM-B");
    await seedItem("ITEM-C");
    await postJson("/register", { parentItemId: "ITEM-A", childItemId: "ITEM-B" });
    await postJson("/register", { parentItemId: "ITEM-A", childItemId: "ITEM-C" });
        const ctx = createExecutionContext();
    const res = await itemStructuresRouter.request(
      "/?parentItemId=ITEM-A&page=1&limit=1",
      {},
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ childItemId: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });
});
