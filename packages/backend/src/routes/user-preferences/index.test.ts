import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { userPreferencesRouter } from "./index";
import { signSessionToken } from "../../platform/auth/session-token";

beforeEach(async () => {
  await env.DB_UI.prepare("DELETE FROM user_preferences").run();
});

async function cookieFor(userId: string) {
  const token = await signSessionToken(
    {
      userId,
      employeeNumber: userId,
      name: "テスト",
      role: "user",
      deptName: "",
      companyName: "",
      isAuditEnabled: false,
    },
    await env.SESSION_SECRET.get(),
    3600,
  );
  return `session_token=${token}`;
}

async function call(path: string, init: RequestInit = {}, userId?: string) {
  const headers = new Headers(init.headers);
  if (userId) headers.set("Cookie", await cookieFor(userId));
  const ctx = createExecutionContext();
  const res = await userPreferencesRouter.request(path, { ...init, headers }, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const put = (body: unknown): RequestInit => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("ユーザーごとの表示設定(専用D1)", () => {
  it("未設定なら既定値(OSに合わせる・indigo)を返す", async () => {
    const res = await call("/", {}, "u1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ themeMode: "system", accentColor: "indigo" });
  });

  it("保存して読み直せる。同じユーザーの再保存は上書き", async () => {
    expect((await call("/", put({ themeMode: "dark", accentColor: "emerald" }), "u1")).status).toBe(200);
    expect(await (await call("/", {}, "u1")).json()).toEqual({ themeMode: "dark", accentColor: "emerald" });
    await call("/", put({ themeMode: "light", accentColor: "rose" }), "u1");
    expect(await (await call("/", {}, "u1")).json()).toEqual({ themeMode: "light", accentColor: "rose" });
    const n = await env.DB_UI.prepare("SELECT COUNT(*) AS n FROM user_preferences").first<any>();
    expect(n.n).toBe(1);
  });

  it("ユーザーごとに別々に保持され、他のユーザーの設定は変わらない", async () => {
    await call("/", put({ themeMode: "dark", accentColor: "violet" }), "u1");
    await call("/", put({ themeMode: "light", accentColor: "amber" }), "u2");
    expect(await (await call("/", {}, "u1")).json()).toEqual({ themeMode: "dark", accentColor: "violet" });
    expect(await (await call("/", {}, "u2")).json()).toEqual({ themeMode: "light", accentColor: "amber" });
    expect(await (await call("/", {}, "u3")).json()).toEqual({ themeMode: "system", accentColor: "indigo" });
  });

  it("ユーザーIDはセッションから取る(リクエスト本文でIDを指定しても他人の設定は書き換えられない)", async () => {
    await call("/", put({ themeMode: "dark", accentColor: "blue", userId: "u2" }), "u1");
    expect(await (await call("/", {}, "u2")).json()).toEqual({ themeMode: "system", accentColor: "indigo" });
    expect(await (await call("/", {}, "u1")).json()).toEqual({ themeMode: "dark", accentColor: "blue" });
  });

  it("未ログインは401。許可されていない値は400", async () => {
    expect((await call("/")).status).toBe(401);
    expect((await call("/", put({ themeMode: "dark", accentColor: "indigo" }))).status).toBe(401);
    expect((await call("/", put({ themeMode: "neon", accentColor: "indigo" }), "u1")).status).toBe(400);
    expect((await call("/", put({ themeMode: "dark", accentColor: "#ff0000" }), "u1")).status).toBe(400);
    expect((await call("/", put({ themeMode: "dark" }), "u1")).status).toBe(400);
  });
});
