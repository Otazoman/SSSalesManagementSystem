import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import { signSessionToken } from "../auth/session-token";
import { warehousesRouter } from "../../routes/master/warehouses/index";
import { partnersRouter } from "../../routes/master/partners/index";

// REQ-006: 倉庫の取引先(種類 WAREHOUSE、倉庫コードと同じ番号)を、倉庫マスタの登録・更新・停止・削除に合わせる。
// 取引先マスタからは、倉庫の取引先を登録・変更・削除できない。倉庫コードと同じ番号の取引先・取引先と同じ番号の倉庫は登録できない

const db = drizzle(env.DB, { schema });
const now = new Date();

async function call(router: Hono<any>, path: string, method: string, body?: unknown) {
  const token = await signSessionToken(
    { userId: "user-1", employeeNumber: "user-1", name: "テスト", role: "admin", deptName: "部署", companyName: "会社", isAuditEnabled: true },
    await env.SESSION_SECRET.get(),
    3600,
  );
  const ctx = createExecutionContext();
  const res = await router.request(
    path,
    { method, headers: { Cookie: `session_token=${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const partnerOf = async (id: string) => (await db.select().from(schema.partners).where(eq(schema.partners.id, id)))[0];
const warehouseBody = (overrides: Record<string, unknown> = {}) => ({
  id: "WH-9", name: "新しい倉庫", address: "東京都", email: null, warehouseType: "EXTERNAL", status: "active", ...overrides,
});

beforeEach(async () => {
  await db.delete(schema.warehouseAvailableDays);
  await db.delete(schema.warehouseAttachments);
  await db.delete(schema.partnerContacts);
  await db.delete(schema.partners);
  await db.delete(schema.warehouses);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.delete("config");
  await db.insert(schema.users).values({ id: "user-1", employeeNumber: "user-1", email: "u@example.com", name: "u", isActive: true, createdAt: now, updatedAt: now });
});

describe("倉庫マスタに合わせた倉庫の取引先(REQ-006)", () => {
  it("倉庫を登録すると同じ番号の取引先(種類 WAREHOUSE)ができ、更新で名前・住所・状態が合う。削除で消える", async () => {
    const created = await call(warehousesRouter, "/register", "POST", warehouseBody());
    expect(created.status, await created.clone().text()).toBe(200);
    expect(await partnerOf("WH-9")).toMatchObject({ type: "WAREHOUSE", name: "新しい倉庫", address: "東京都" });

    const updated = await call(warehousesRouter, "/WH-9", "PUT", warehouseBody({ name: "名前を変えた倉庫", address: "大阪府" }));
    expect(updated.status, await updated.clone().text()).toBe(200);
    expect(await partnerOf("WH-9")).toMatchObject({ name: "名前を変えた倉庫", address: "大阪府" });

    expect((await call(warehousesRouter, "/WH-9/suspend", "POST")).status).toBe(200);
    expect((await partnerOf("WH-9")).status).toBe((await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, "WH-9")))[0].status);

    expect((await call(warehousesRouter, "/WH-9", "DELETE")).status).toBe(200);
    expect(await partnerOf("WH-9")).toBeUndefined();
  });

  it("倉庫コードと同じ番号の普通の取引先があれば、倉庫を登録しない", async () => {
    await db.insert(schema.partners).values({ id: "WH-9", name: "普通の取引先", type: "CUSTOMER", createdBy: "u", createdAt: now, updatedBy: "u", updatedAt: now });
    expect((await call(warehousesRouter, "/register", "POST", warehouseBody())).status).toBe(400);
    expect(await db.select().from(schema.warehouses)).toHaveLength(0);
  });

  it("取引先マスタからは、倉庫の取引先を変更・停止・削除できず、倉庫コードと同じ番号・種類「倉庫」の取引先も登録できない", async () => {
    await call(warehousesRouter, "/register", "POST", warehouseBody());
    expect((await call(partnersRouter, "/WH-9", "PUT", { name: "変える", type: "CUSTOMER" })).status).toBe(400);
    expect((await call(partnersRouter, "/WH-9/suspend", "POST")).status).toBe(400);
    expect((await call(partnersRouter, "/WH-9/purge", "DELETE")).status).toBe(400);
    expect((await call(partnersRouter, "/register", "POST", { id: "P-NEW", name: "倉庫として", type: "WAREHOUSE" })).status).toBe(400);
    expect((await partnerOf("WH-9")).name).toBe("新しい倉庫");
  });

  it("直送用の倉庫には取引先を作らない", async () => {
    await call(warehousesRouter, "/register", "POST", warehouseBody({ id: "WH-D", warehouseType: "DIRECT" }));
    expect(await partnerOf("WH-D")).toBeUndefined();
  });
});
