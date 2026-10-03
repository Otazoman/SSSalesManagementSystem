import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { warehousesRouter } from "./index";

/**
 * 2-4(ページネーション適用)のキャラクタリゼーションテスト。
 * GET / のpage/limit未指定時・指定時の挙動のみを固定する。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.warehouseAttachments);
  await db.delete(schema.warehouseAvailableDays);
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
});

async function registerWarehouse(id: string, name: string) {
  return warehousesRouter.request(
    "/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, email: null }),
    },
    env,
  );
}

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await registerWarehouse("WH1", "倉庫1");
    const res = await warehousesRouter.request("/", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((w) => w.id === "WH1")).toBe(true);
  });

  it("page/limit指定時は{data,pagination}形式で返す", async () => {
    await registerWarehouse("WH1", "倉庫1");
    await registerWarehouse("WH2", "倉庫2");
    const res = await warehousesRouter.request("/?page=1&limit=1", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; availableDays: unknown[]; attachments: unknown[] }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toHaveProperty("availableDays");
    expect(body.data[0]).toHaveProperty("attachments");
    expect(body.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });

  it("id/name/statusフィルタとpage/limitを併用できる", async () => {
    await registerWarehouse("WH1", "東京倉庫");
    await registerWarehouse("WH2", "大阪倉庫");
    const res = await warehousesRouter.request(
      "/?name=%E6%9D%B1%E4%BA%AC&page=1&limit=10",
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      pagination: { total: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("WH1");
    expect(body.pagination.total).toBe(1);
  });
});

describe("POST /register", () => {
  it("コード未入力の場合、master_code_formatsの設定(既定WH+4桁)に基づき自動採番される", async () => {
    const res = await warehousesRouter.request(
      "/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "自動採番倉庫", email: null }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^WH-\d{4}$/);
  });
});

describe("POST /:id/suspend", () => {
  it("存在するIDの無効化は200・固定メッセージを返す", async () => {
    await registerWarehouse("WH1", "東京倉庫");
    const res = await warehousesRouter.request(
      "/WH1/suspend",
      { method: "POST" },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "該当倉庫を無効化しました",
    });

    const getRes = await warehousesRouter.request("/", {}, env);
    const list = (await getRes.json()) as Array<{ id: string; status: string }>;
    expect(list.find((w) => w.id === "WH1")?.status).toBe("suspended");
  });

  it("存在しないIDの無効化は404・固定メッセージを返す", async () => {
    const res = await warehousesRouter.request(
      "/NOPE/suspend",
      { method: "POST" },
      env,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "対象の倉庫が見つかりません",
    });
  });
});

describe("DELETE /:id", () => {
  it("suspended状態でない倉庫は削除拒否(400)される", async () => {
    await registerWarehouse("WH1", "東京倉庫");
    const res = await warehousesRouter.request(
      "/WH1",
      { method: "DELETE" },
      env,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "削除拒否: 無効化状態の倉庫のみ物理削除できます",
    });
  });

  it("存在しないIDの削除は404・固定メッセージを返す", async () => {
    const res = await warehousesRouter.request(
      "/NOPE",
      { method: "DELETE" },
      env,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "対象の倉庫が見つかりません",
    });
  });

  it("suspended状態の倉庫は削除できる", async () => {
    await registerWarehouse("WH1", "東京倉庫");
    await warehousesRouter.request(
      "/WH1/suspend",
      { method: "POST" },
      env,
    );
    const res = await warehousesRouter.request(
      "/WH1",
      { method: "DELETE" },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: "倉庫を削除しました" });
  });
});
