import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { rolesRouter } from "./index";

/**
 * 2-2(エラー処理統一)前の現状挙動を固定するキャラクタリゼーションテスト。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.userRoles);
  await db.delete(schema.roles);
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
  return rolesRouter.request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    env,
  );
}

describe("POST /", () => {
  it("正常作成は200・固定メッセージを返す", async () => {
    const res = await reqJson("/register", "POST", { id: "manager", name: "マネージャー" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: "役職ロールを新設しました" });
  });
});

describe("PUT /:id", () => {
  it("adminロールの変更は400・固定メッセージを返す", async () => {
    const res = await reqJson("/admin", "PUT", { name: "変更後" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "システム基本ロールの情報を変更することはできません",
    });
  });

  it("存在しないロールの変更は404・固定メッセージを返す", async () => {
    const res = await reqJson("/nope", "PUT", { name: "変更後" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "対象のロールが見つかりません",
    });
  });

  it("存在するロールの変更は200・固定メッセージを返す", async () => {
    await reqJson("/register", "POST", { id: "manager", name: "マネージャー" });
    const res = await reqJson("/manager", "PUT", { name: "改名" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "ロール情報を更新しました",
    });
  });
});

describe("DELETE /:id", () => {
  it("adminロールの削除は400・固定メッセージを返す", async () => {
    const res = await reqJson("/admin", "DELETE");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "システム基本ロールは削除できません",
    });
  });

  it("参照されていないロールの削除は200・固定メッセージを返す", async () => {
    await reqJson("/register", "POST", { id: "manager", name: "マネージャー" });
    const res = await reqJson("/manager", "DELETE");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: "ロールを削除しました" });
  });

  it("ユーザーに割り当て済みのロールの削除は400・固定メッセージを返す(実際のD1 FK違反)", async () => {
    await reqJson("/register", "POST", { id: "manager", name: "マネージャー" });
    await db.insert(schema.userRoles).values({
      userId: "user-001",
      roleId: "manager",
      departmentSurrogateId: null,
    });

    const res = await reqJson("/manager", "DELETE");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message:
        "このロールは、既にユーザーに割り当てられているか、承認フローの定義で使用されているため削除できません。先に該当する設定を変更してください。",
    });
  });
});

describe("POST /csv-import", () => {
  async function postCsv(csv: string) {
    const formData = new FormData();
    formData.set("file", new File([csv], "roles.csv", { type: "text/csv" }));
    return rolesRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env,
    );
  }

  it("データ行が無い場合は400・固定メッセージを返す", async () => {
    const res = await postCsv("id,name,description");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "インポートするデータがありません",
    });
  });

  it("ヘッダーが一致しない場合は400・固定メッセージを返す", async () => {
    const res = await postCsv("foo,bar\n1,2");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "CSVヘッダー(id,name,description)が一致しません",
    });
  });

  it("正常なCSVは200・件数入りメッセージを返す", async () => {
    const res = await postCsv("id,name,description\nmanager,マネージャー,");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "1件のロールをインポート・更新しました",
    });
  });
});

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await reqJson("/register", "POST", { id: "manager", name: "マネージャー" });
    const res = await rolesRouter.request("/", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((r) => r.id === "manager")).toBe(true);
  });

  it("page/limit指定時は{data,pagination}形式で返す", async () => {
    await reqJson("/register", "POST", { id: "manager", name: "マネージャー" });
    await reqJson("/register", "POST", { id: "leader", name: "リーダー" });
    const res = await rolesRouter.request("/?page=1&limit=1", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination.total).toBe(2);
  });

  it("sortBy=id&sortOrder=descの場合はidの降順で返す(page/limit未指定)", async () => {
    await reqJson("/register", "POST", { id: "manager", name: "マネージャー" });
    await reqJson("/register", "POST", { id: "leader", name: "リーダー" });
    const res = await rolesRouter.request("/?sortBy=id&sortOrder=desc", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    const ids = body.map((r) => r.id).filter((id) => id === "manager" || id === "leader");
    expect(ids).toEqual(["manager", "leader"]);
  });

  it("許可されていないsortByは無視され既存の順序のまま返す", async () => {
    await reqJson("/register", "POST", { id: "manager", name: "マネージャー" });
    const res = await rolesRouter.request("/?sortBy=description", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((r) => r.id === "manager")).toBe(true);
  });

  it("sortBy指定時はpage/limit指定と組み合わせても{data,pagination}形式で並び替わる", async () => {
    await reqJson("/register", "POST", { id: "manager", name: "マネージャー" });
    await reqJson("/register", "POST", { id: "leader", name: "リーダー" });
    const res = await rolesRouter.request(
      "/?page=1&limit=10&sortBy=id&sortOrder=asc",
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
    };
    const targetIds = body.data.map((r) => r.id).filter((id) => id === "manager" || id === "leader");
    expect(targetIds).toEqual(["leader", "manager"]);
  });
});
