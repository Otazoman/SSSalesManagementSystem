import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { departmentsRouter } from "./index";

const db = drizzle(env.DB, { schema });

/**
 * 2-2(エラー処理統一)前の現状挙動を固定するキャラクタリゼーションテスト。
 */

async function reqJson(path: string, method: string, body?: unknown) {
  return departmentsRouter.request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    env,
  );
}

beforeEach(async () => {
  await db.delete(schema.userRoles);
  await db.delete(schema.departments);
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

describe("PUT /:idOrSurrogate (組織階層ループ検出)", () => {
  it("親子関係が循環する変更は400・固定メッセージを返す", async () => {
    await reqJson("/register", "POST", { id: "DEPT-2-A", name: "親部署" });
    await reqJson("/register", "POST", {
      id: "DEPT-2-B",
      name: "子部署",
      parentDepartmentId: "DEPT-2-A",
    });

    // 親(DEPT-2-A)の親を、自分の子(DEPT-2-B)に設定しようとする→ループ
    const res = await reqJson("/DEPT-2-A", "PUT", {
      name: "親部署",
      parentDepartmentId: "DEPT-2-B",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "エラー: 組織階層のループが検出されました",
    });
  });

  it("循環しない変更は200・固定メッセージを返す", async () => {
    await reqJson("/register", "POST", { id: "DEPT-2-C", name: "部署C" });
    const res = await reqJson("/DEPT-2-C", "PUT", { name: "部署C改" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: "部署情報を変更しました" });
  });
});

describe("POST /bulk-register", () => {
  it("データ行が無い場合は400・固定メッセージを返す", async () => {
    const formData = new FormData();
    formData.set(
      "file",
      new File(
        ["id,name,parentDepartmentId,memo,validFrom,validTo"],
        "depts.csv",
        { type: "text/csv" },
      ),
    );
    const res = await departmentsRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "インポートするデータがありません",
    });
  });

  it("ヘッダー不正は400・固定メッセージを返す", async () => {
    const formData = new FormData();
    formData.set("file", new File(["a,b\n1,2"], "depts.csv", { type: "text/csv" }));
    const res = await departmentsRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "CSVヘッダー書式が正しくありません",
    });
  });

  it("正常なCSVは200・件数入りメッセージを返す", async () => {
    const csv = [
      "id,name,parentDepartmentId,memo,validFrom,validTo",
      "DEPT-2-D,部署D,,,,",
    ].join("\n");
    const formData = new FormData();
    formData.set("file", new File([csv], "depts.csv", { type: "text/csv" }));
    const res = await departmentsRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "CSVから 1 件の組織マスタ(期間リレーション含む)を完全同期しました",
    });
  });
});

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await reqJson("/register", "POST", { id: "DEPT-3-A", name: "部署A" });
    const res = await departmentsRouter.request("/", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((d) => d.id === "DEPT-3-A")).toBe(true);
  });

  it("page/limit指定時は{data,pagination}形式で返す", async () => {
    await reqJson("/register", "POST", { id: "DEPT-3-A", name: "部署A" });
    await reqJson("/register", "POST", { id: "DEPT-3-B", name: "部署B" });
    const res = await departmentsRouter.request("/?page=1&limit=1", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });
});
