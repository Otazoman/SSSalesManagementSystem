import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { projectsRouter } from "./index";

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.orders);
  await db.delete(schema.purchaseRequests);
  await db.delete(schema.projects);
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

async function reqJson(path: string, method: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await projectsRouter.request(
    path,
    {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("projectsRouter", () => {
  it("POST /register で新規登録できる", async () => {
    const res = await reqJson("/register", "POST", {
      id: "PJ-001",
      name: "サンプルプロジェクト",
      memo: "テスト用",
      startDate: "2026-04-01T00:00:00.000Z",
      endDate: null,
    });
    expect(res.status).toBe(200);

    const listRes = await reqJson("/", "GET");
    const list = (await listRes.json()) as Array<{ id: string; name: string; status: string }>;
    const created = list.find((p) => p.id === "PJ-001");
    expect(created).toBeDefined();
    expect(created?.name).toBe("サンプルプロジェクト");
    expect(created?.status).toBe("active");
  });

  it("PJコード重複時は登録できない", async () => {
    await reqJson("/register", "POST", { id: "PJ-001", name: "A" });
    const res = await reqJson("/register", "POST", { id: "PJ-001", name: "B" });
    expect(res.status).not.toBe(200);
  });

  it("コード未入力の場合、master_code_formatsの設定(既定PJ+4桁)に基づき自動採番される", async () => {
    const res = await reqJson("/register", "POST", { name: "自動採番プロジェクト" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^PJ-\d{4}$/);
  });

  it("PUT /:id で名称等を更新できる", async () => {
    await reqJson("/register", "POST", { id: "PJ-001", name: "旧名称" });
    const res = await reqJson("/PJ-001", "PUT", { name: "新名称", memo: "更新済み" });
    expect(res.status).toBe(200);

    const listRes = await reqJson("/", "GET");
    const list = (await listRes.json()) as Array<{ id: string; name: string; memo: string | null }>;
    const updated = list.find((p) => p.id === "PJ-001");
    expect(updated?.name).toBe("新名称");
    expect(updated?.memo).toBe("更新済み");
  });

  it("存在しないIDの更新は失敗する", async () => {
    const res = await reqJson("/nope", "PUT", { name: "x" });
    expect(res.status).not.toBe(200);
  });

  it("POST /:id/suspend で無効化できる(statusがsuspendedになる)", async () => {
    await reqJson("/register", "POST", { id: "PJ-001", name: "A" });
    const res = await reqJson("/PJ-001/suspend", "POST");
    expect(res.status).toBe(200);

    const listRes = await reqJson("/", "GET");
    const list = (await listRes.json()) as Array<{ id: string; status: string }>;
    expect(list.find((p) => p.id === "PJ-001")?.status).toBe("suspended");
  });

  it("active状態のまま削除しようとすると400になる(無効化しないと削除できない)", async () => {
    await reqJson("/register", "POST", { id: "PJ-001", name: "A" });
    const res = await reqJson("/PJ-001", "DELETE");
    expect(res.status).toBe(400);

    const listRes = await reqJson("/", "GET");
    const list = (await listRes.json()) as Array<{ id: string }>;
    expect(list.some((p) => p.id === "PJ-001")).toBe(true);
  });

  it("無効化してから削除すると成功する", async () => {
    await reqJson("/register", "POST", { id: "PJ-001", name: "A" });
    await reqJson("/PJ-001/suspend", "POST");
    const res = await reqJson("/PJ-001", "DELETE");
    expect(res.status).toBe(200);

    const listRes = await reqJson("/", "GET");
    const list = (await listRes.json()) as Array<{ id: string }>;
    expect(list.some((p) => p.id === "PJ-001")).toBe(false);
  });

  it("sortBy=name&sortOrder=descで名称降順に並び替わる", async () => {
    await reqJson("/register", "POST", { id: "PJ-001", name: "Alpha" });
    await reqJson("/register", "POST", { id: "PJ-002", name: "Beta" });
    const res = await projectsRouter.request("/?sortBy=name&sortOrder=desc", {}, env);
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ id: string }>;
    const ids = list.map((p) => p.id).filter((id) => id === "PJ-001" || id === "PJ-002");
    expect(ids).toEqual(["PJ-002", "PJ-001"]);
  });

  it("GET /csv-download でCSVを出力できる", async () => {
    await reqJson("/register", "POST", { id: "PJ-001", name: "サンプル" });
    const res = await reqJson("/csv-download", "GET");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("PJ-001");
  });

  it("POST /bulk-register でCSVから一括登録できる", async () => {
    const csv = "id,name,memo,startDate,endDate\nPJ-100,一括登録PJ,,,\n";
    const formData = new FormData();
    formData.append("file", new Blob([csv], { type: "text/csv" }), "projects.csv");
    const ctx = createExecutionContext();
    const res = await projectsRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);

    const listRes = await reqJson("/", "GET");
    const list = (await listRes.json()) as Array<{ id: string }>;
    expect(list.some((p) => p.id === "PJ-100")).toBe(true);
  });
});
