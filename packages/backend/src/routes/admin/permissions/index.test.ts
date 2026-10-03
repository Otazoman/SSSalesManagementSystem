import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { permissionsRouter } from "./index";

/**
 * 2-4(ページネーション適用)のキャラクタリゼーションテスト。
 * GET / のpage/limit未指定時・指定時の挙動のみを固定する。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.rolePermissions);
  await db.delete(schema.permissions);
});

async function insertPermission(id: string) {
  await db.insert(schema.permissions).values({
    id,
    resource: "master_products",
    action: "read",
    name: id,
  });
}

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await insertPermission("perm-1");
    const res = await permissionsRouter.request("/", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((p) => p.id === "perm-1")).toBe(true);
  });

  it("page/limit指定時は{data,pagination}形式で返す", async () => {
    await insertPermission("perm-1");
    await insertPermission("perm-2");
    const res = await permissionsRouter.request("/?page=1&limit=1", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });
});

describe("POST /csv-import(ロール×権限の取込)", () => {
  async function importCsv(csv: string) {
    const form = new FormData();
    form.append("file", new File([csv], "role_permissions.csv", { type: "text/csv" }));
    const ctx = createExecutionContext();
    const res = await permissionsRouter.request("/bulk-register", { method: "POST", body: form }, env, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  beforeEach(async () => {
    await db.delete(schema.userRoles);
    await db.delete(schema.roles);
    await db.insert(schema.roles).values({ id: "sales", name: "営業", createdAt: new Date() });
  });

  it("標準の権限枠が無い状態(画面・権限マスタを開く前)でも取り込める(BUG-001: 以前は500)", async () => {
    const res = await importCsv(["role_id,permission_id", "sales,master_units:read", "sales,master_units:menu"].join("\n"));
    expect(res.status).toBe(200);
    const permissions = await db.select().from(schema.permissions);
    expect(permissions.length).toBeGreaterThan(2); // 標準の権限枠がまとめて作られている
    const assigned = await db.select().from(schema.rolePermissions);
    expect(assigned.map((r) => r.permissionId).sort()).toEqual(["master_units:menu", "master_units:read"]);
  });

  it("既にある権限枠は変更しない(名前などを上書きしない)", async () => {
    await db.insert(schema.permissions).values({ id: "master_units:read", resource: "master_units", action: "read", name: "独自の名前" });
    const res = await importCsv(["role_id,permission_id", "sales,master_units:read"].join("\n"));
    expect(res.status).toBe(200);
    const [row] = await db.select().from(schema.permissions).where(eq(schema.permissions.id, "master_units:read"));
    expect(row.name).toBe("独自の名前");
  });

  it("存在しない権限を含む場合は、500ではなく400で権限のIDを示す", async () => {
    const res = await importCsv(["role_id,permission_id", "sales,no_such_screen:read"].join("\n"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain("no_such_screen:read");
  });
});
