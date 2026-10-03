import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { locationsRouter } from "./index";

/**
 * 2-4(ページネーション適用)のキャラクタリゼーションテスト。
 * GET / のpage/limit未指定時・指定時の挙動のみを固定する。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.locations);
  await db.delete(schema.warehouses);
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
  await db.insert(schema.warehouses).values({
    id: "WH1",
    name: "倉庫1",
    email: null,
    status: "active",
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
});

async function registerLocation(id: string, name: string) {
    const ctx = createExecutionContext();
  const _res = await locationsRouter.request(
    "/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, warehouseId: "WH1", name }),
    },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await registerLocation("LOC1", "棚A");
        const ctx = createExecutionContext();
    const res = await locationsRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((l) => l.id === "LOC1")).toBe(true);
  });

  it("page/limit指定時は既存の検索条件を維持したまま{data,pagination}形式で返す", async () => {
    await registerLocation("LOC1", "棚A");
    await registerLocation("LOC2", "棚B");
        const ctx = createExecutionContext();
    const res = await locationsRouter.request(
      "/?warehouseId=WH1&page=1&limit=1",
      {},
      env, ctx
    );
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

describe("DELETE /:id", () => {
  it("無効化前のロケーションの削除は400・固定メッセージを返す", async () => {
    await registerLocation("LOC1", "棚A");
        const ctx = createExecutionContext();
    const res = await locationsRouter.request(
      "/LOC1",
      { method: "DELETE" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "削除拒否: 無効化状態のロケーションのみ物理削除できます",
    });
  });

  it("無効化済みのロケーションの削除は200・固定メッセージを返す", async () => {
    await registerLocation("LOC1", "棚A");
    const suspendCtx = createExecutionContext();
    await locationsRouter.request("/LOC1/suspend", { method: "POST" }, env, suspendCtx);
    await waitOnExecutionContext(suspendCtx);
        const ctx = createExecutionContext();
    const res = await locationsRouter.request(
      "/LOC1",
      { method: "DELETE" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: "ロケーションを削除しました" });
  });
});

// D対応: locations CSV一括取込がstatus列を扱わず、常にDB既定値"temporary"のまま
// 登録されてしまい(GET /?status=activeが空になる)一覧・棚卸画面から抽出できなかった不具合の
// 再発防止。warehouses.service.tsのbulkRegisterCsvと同じ「status列は任意、無ければ"active"を補う」
// 方針で実装している
describe("POST /bulk-register (CSV)", () => {
  async function importCsv(csvText: string) {
    const formData = new FormData();
    formData.append("file", new File([csvText], "locations.csv", { type: "text/csv" }));
    const ctx = createExecutionContext();
    const res = await locationsRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("status列を含むCSVは、そのステータスでインポートされる", async () => {
    const csv = `id,warehouseId,name,status,memo\nLOC1,WH1,棚A,active,通常棚`;
    const res = await importCsv(csv);
    expect(res.status).toBe(200);

    const rows = await db.select().from(schema.locations);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("active");
  });

  it("status列が無い旧形式のCSVは、既定値'temporary'ではなく'active'としてインポートされる", async () => {
    // 修正前はstatus列自体を書き込んでおらず、DB既定値'temporary'のまま保存されるため
    // GET /?status=activeで抽出できなかった(棚卸画面のロケーション選択が常に空になるバグ)
    const csv = `id,warehouseId,name,memo\nLOC2,WH1,棚B,通常棚`;
    const res = await importCsv(csv);
    expect(res.status).toBe(200);

    const rows = await db.select().from(schema.locations);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("active");
  });

  it("再インポートで既存行のstatusも上書きされる(CSVでの無効化・再有効化に対応)", async () => {
    await importCsv(`id,warehouseId,name,status,memo\nLOC1,WH1,棚A,active,`);
    const res = await importCsv(`id,warehouseId,name,status,memo\nLOC1,WH1,棚A,suspended,`);
    expect(res.status).toBe(200);

    const rows = await db.select().from(schema.locations);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("suspended");
  });
});
