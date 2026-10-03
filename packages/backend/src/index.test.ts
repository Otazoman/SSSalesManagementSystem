import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "./db/schema";
import app from "./index";
import { signSessionToken } from "./platform/auth/session-token";
import { isAdminOnlyApi } from "./platform/auth/guard-admin-apis";
import { hashPassword } from "./utils/crypto";

/**
 * src/index.ts最上位ミドルウェア(APIキー検証)・Phase E(APIドキュメント)のテスト。
 * 各featureのsub-routerテストはこのミドルウェアを経由しない(sub-routerを直接呼び出す)ため、
 * このファイルで初めてapp全体(APIキー検証を含む)を検証する。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.users);
  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

describe("APIキー検証ミドルウェア", () => {
  it("有効なAPIキーがあれば通常のAPIへ到達できる", async () => {
    const res = await app.request(
      "/api/units",
      { headers: { "X-API-KEY": "test-api-key" } },
      env,
    );
    expect(res.status).toBe(200);
  });

  it("APIキーが無ければ401を返す", async () => {
    const res = await app.request("/api/units", {}, env);
    expect(res.status).toBe(401);
  });

  it("APIキーが不正なら401を返す", async () => {
    const res = await app.request(
      "/api/units",
      { headers: { "X-API-KEY": "wrong-key" } },
      env,
    );
    expect(res.status).toBe(401);
  });
});

// APIドキュメントは ENABLE_API_DOCS="true" の時(開発環境)だけ公開する
const docsEnabledEnv = { ...env, ENABLE_API_DOCS: "true" };

describe("GET /api/openapi.json", () => {
  it("有効なAPIキーがあれば200・OpenAPI仕様を返す", async () => {
    const res = await app.request(
      "/api/openapi.json",
      { headers: { "X-API-KEY": "test-api-key" } },
      docsEnabledEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(body.openapi).toBe("3.1.0");
    // describeRoute()を付与済みのunitsルートが仕様に反映されていることを確認
    expect(body.paths["/api/units/"] ?? body.paths["/api/units"]).toBeTruthy();
  });

  it("APIキーが無ければ401を返す(他のAPIと同じ保護を受ける)", async () => {
    const res = await app.request("/api/openapi.json", {}, docsEnabledEnv);
    expect(res.status).toBe(401);
  });

  it("ENABLE_API_DOCSが未設定(Staging・本番)なら、有効なAPIキーがあっても404を返す", async () => {
    const res = await app.request(
      "/api/openapi.json",
      { headers: { "X-API-KEY": "test-api-key" } },
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/docs", () => {
  it("有効なAPIキーがあれば200・HTMLを返す", async () => {
    const res = await app.request(
      "/api/docs",
      { headers: { "X-API-KEY": "test-api-key" } },
      docsEnabledEnv,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("ENABLE_API_DOCSが未設定(Staging・本番)なら404を返す", async () => {
    const res = await app.request(
      "/api/docs",
      { headers: { "X-API-KEY": "test-api-key" } },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("ENABLE_API_DOCSが\"true\"以外(例: \"false\")なら404を返す", async () => {
    const res = await app.request(
      "/api/docs",
      { headers: { "X-API-KEY": "test-api-key" } },
      { ...env, ENABLE_API_DOCS: "false" },
    );
    expect(res.status).toBe(404);
  });
});

// BUG-020: 管理者だけのAPIは、セッションのユーザーが現在も管理者か(DBのロール)を確かめる
describe("管理者だけのAPIの確認(adminGuard)", () => {
  const API_KEY = { "X-API-KEY": "test-api-key" };

  async function sessionOf(userId: string, role = "admin") {
    const token = await signSessionToken(
      { userId, employeeNumber: userId, name: userId, role, deptName: "", companyName: "", isAuditEnabled: false },
      await env.SESSION_SECRET.get(),
      3600,
    );
    return { ...API_KEY, Cookie: `session_token=${token}` };
  }

  beforeEach(async () => {
    const createdAt = new Date();
    await db
      .insert(schema.roles)
      .values([
        { id: "admin", name: "システム管理者", createdAt },
        { id: "manager", name: "課長", createdAt },
      ])
      .onConflictDoNothing();
    await db.insert(schema.users).values([
      { id: "u-admin", employeeNumber: "ADM01", email: "adm@example.com", name: "管理者", createdAt, updatedAt: createdAt },
      { id: "u-general", employeeNumber: "GEN01", email: "gen@example.com", name: "一般", createdAt, updatedAt: createdAt },
    ]);
    await db.insert(schema.userRoles).values([
      { userId: "u-admin", roleId: "admin", departmentSurrogateId: null },
      { userId: "u-general", roleId: "manager", departmentSurrogateId: null },
    ]);
  });

  afterEach(async () => {
    await db.delete(schema.userRoles);
  });

  it("管理者以外は、ユーザーの更新・D1参照・会社設定の更新が403になる(cookieのロールをadminに偽っても同じ)", async () => {
    const headers = await sessionOf("u-general", "admin");
    const put = await app.request(
      "/api/users/u-general",
      {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "一般", email: "gen@example.com", relations: [{ roleId: "admin" }] }),
      },
      env,
    );
    expect(put.status).toBe(403);
    expect((await app.request("/api/d1-explorer/databases", { headers }, env)).status).toBe(403);
    const settings = await app.request(
      "/api/company-settings",
      { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ site_url: "https://evil.example" }) },
      env,
    );
    expect(settings.status).toBe(403);
    // 権限が付いていないことを確かめる
    const roles = await db.select().from(schema.userRoles);
    expect(roles.filter((r) => r.userId === "u-general").map((r) => r.roleId)).toEqual(["manager"]);
  });

  it("管理者以外でも、業務画面が使う参照(ユーザー一覧)とパスワードを忘れた時の操作は使える", async () => {
    const headers = await sessionOf("u-general", "manager");
    expect((await app.request("/api/users", { headers }, env)).status).toBe(200);
    const forgot = await app.request(
      "/api/users/forgot-password",
      { method: "POST", headers: { ...API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: "nobody@example.com" }) },
      env,
    );
    expect(forgot.status).not.toBe(401);
    expect(forgot.status).not.toBe(403);
  });

  it("管理者は管理者だけのAPIを使える", async () => {
    const headers = await sessionOf("u-admin");
    expect((await app.request("/api/d1-explorer/databases", { headers }, env)).status).toBe(200);
  });

  it("ログインしていなければ401、無効化された管理者も401になる(BUG-024 のセッションの確認で止まる)", async () => {
    expect((await app.request("/api/audit-logs", { headers: API_KEY }, env)).status).toBe(401);
    await db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, "u-admin"));
    const headers = await sessionOf("u-admin");
    expect((await app.request("/api/d1-explorer/databases", { headers }, env)).status).toBe(401);
  });

  it("対象の判定: 全操作が対象のAPI・変更だけが対象のAPI・対象外", () => {
    expect(isAdminOnlyApi("GET", "/api/audit-logs")).toBe(true);
    expect(isAdminOnlyApi("GET", "/api/roles/admin")).toBe(true);
    expect(isAdminOnlyApi("GET", "/api/users")).toBe(false);
    expect(isAdminOnlyApi("POST", "/api/users/register")).toBe(true);
    expect(isAdminOnlyApi("DELETE", "/api/users/u-1/purge")).toBe(true);
    expect(isAdminOnlyApi("POST", "/api/users/change-password")).toBe(false);
    expect(isAdminOnlyApi("PUT", "/api/progress/stage-owners")).toBe(true);
    expect(isAdminOnlyApi("GET", "/api/progress")).toBe(false);
    // 名前が前方一致するだけの別のAPIは対象外
    expect(isAdminOnlyApi("POST", "/api/users-preferences")).toBe(false);
    // 業務の操作(BUG-017)・会計の画面のAPIは対象外
    expect(isAdminOnlyApi("DELETE", "/api/quotes/Q-1")).toBe(false);
    expect(isAdminOnlyApi("POST", "/api/journal-batches")).toBe(false);
  });
});

// BUG-024: 無効化・パスワード変更・ログアウトの後は、それまでのログイン(cookie)を使えない
describe("ログインの取り消し(sessionGuard)", () => {
  const API_KEY = { "X-API-KEY": "test-api-key" };
  const SESSION_MAX_AGE = 60 * 60 * 24;

  // 発行時刻を secondsAgo 秒前にしたcookie(期限から発行時刻を逆算するため、期限を短くして作る)
  async function cookieOf(userId: string, secondsAgo = 10) {
    const token = await signSessionToken(
      { userId, employeeNumber: userId, name: userId, role: "manager", deptName: "", companyName: "", isAuditEnabled: false },
      await env.SESSION_SECRET.get(),
      SESSION_MAX_AGE - secondsAgo,
    );
    return `session_token=${token}`;
  }
  const get = (path: string, cookie: string) => app.request(path, { headers: { ...API_KEY, Cookie: cookie } }, env);

  beforeEach(async () => {
    await db.delete(schema.userLoginStates);
    const createdAt = new Date();
    await db.insert(schema.users).values({
      id: "u-1",
      employeeNumber: "E001",
      email: "u1@example.com",
      name: "利用者",
      passwordHash: await hashPassword("old-password"),
      createdAt,
      updatedAt: createdAt,
    });
  });

  it("有効なアカウントのログインは使える。無効化されると401になり、cookieを消す", async () => {
    const cookie = await cookieOf("u-1");
    expect((await get("/api/units", cookie)).status).toBe(200);

    await db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, "u-1"));
    const res = await get("/api/units", cookie);
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toContain("session_token=;");
  });

  it("ログアウトすると、同じcookieはもう使えない", async () => {
    const cookie = await cookieOf("u-1");
    const logout = await app.request("/api/auth/logout", { method: "POST", headers: { ...API_KEY, Cookie: cookie } }, env);
    expect(logout.status).toBe(200);
    expect((await get("/api/units", cookie)).status).toBe(401);
  });

  it("取り消されたcookieが残っていても、ログイン前に使うAPIはそのまま使える", async () => {
    const cookie = await cookieOf("u-1");
    await db.insert(schema.userLoginStates).values({ userId: "u-1", sessionsValidAfter: new Date() });
    expect((await get("/api/units", cookie)).status).toBe(401);
    const count = await get("/api/users/count", cookie);
    expect(count.status).toBe(200);
  });

  it("パスワードを変更すると、他の端末のログインは使えなくなり、変更した端末は発行し直したcookieで続けて使える", async () => {
    const thisDevice = await cookieOf("u-1");
    const otherDevice = await cookieOf("u-1", 20);
    const res = await app.request(
      "/api/users/change-password",
      {
        method: "POST",
        headers: { ...API_KEY, Cookie: thisDevice, "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password-1" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const renewed = (res.headers.get("set-cookie") ?? "").match(/session_token=([^;]+)/)?.[1];
    expect(renewed).toBeTruthy();

    expect((await get("/api/units", otherDevice)).status).toBe(401);
    expect((await get("/api/units", thisDevice)).status).toBe(401);
    expect((await get("/api/units", `session_token=${renewed}`)).status).toBe(200);
  });
});
