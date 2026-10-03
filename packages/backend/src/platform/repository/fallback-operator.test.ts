import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { Env } from "../../types/env";
import { getFallbackOperatorId, resolveOperatorEmployeeNumber } from "./fallback-operator";
import { signSessionToken } from "../auth/session-token";

const db = drizzle(env.DB, { schema });

// resolveOperatorEmployeeNumber()はHonoのContextを要求するため、
// 直接呼び出せるようテスト専用の最小Honoアプリ経由で実行する。
const testApp = new Hono<{ Bindings: Env }>();
testApp.get("/resolve", async (c) => {
  const result = await resolveOperatorEmployeeNumber(c, db);
  return c.json({ result });
});

beforeEach(async () => {
  // 各テストの前にusersテーブルを空にしておく(D1はテストごとにロールバックされないため明示的にクリア)
  await db.delete(schema.users);
});

describe("getFallbackOperatorId", () => {
  it("usersテーブルが空の場合はデフォルトのフォールバック文字列(NO_USER_FOUND)を返す", async () => {
    const result = await getFallbackOperatorId(db);
    expect(result).toBe("NO_USER_FOUND");
  });

  it("fallbackを明示的に指定した場合はその値を返す(warehousesのSYSTEM_USER相当)", async () => {
    const result = await getFallbackOperatorId(db, "SYSTEM_USER");
    expect(result).toBe("SYSTEM_USER");
  });

  it("usersテーブルに1件でも存在すればその先頭ユーザーのidを返す", async () => {
    const now = new Date();
    await db.insert(schema.users).values({
      id: "user-001",
      employeeNumber: "EMP001",
      email: "test@example.com",
      name: "テストユーザー",
      createdAt: now,
      updatedAt: now,
    });

    const result = await getFallbackOperatorId(db);
    expect(result).toBe("user-001");
  });
});

describe("resolveOperatorEmployeeNumber", () => {
  it("有効なセッションがあれば、DBに問い合わせずセッションのemployeeNumberを返す", async () => {
    // usersテーブルは空のまま(DBフォールバック経路が使われていないことの確認を兼ねる)
    const token = await signSessionToken(
      {
        userId: "user-1",
        employeeNumber: "EMP-SESSION-001",
        name: "セッションユーザー",
        role: "user",
        deptName: "営業部",
        companyName: "サンプル会社",
        isAuditEnabled: true,
      },
      await env.SESSION_SECRET.get(),
      3600,
    );

    const res = await testApp.request(
      "/resolve",
      { headers: { Cookie: `session_token=${token}` } },
      env,
    );

    const body = await res.json();
    expect(body.result).toBe("EMP-SESSION-001");
  });

  it("セッションが無い場合、従来のgetFallbackOperatorId()(DBの先頭ユーザー)にフォールバックする", async () => {
    const now = new Date();
    await db.insert(schema.users).values({
      id: "user-002",
      employeeNumber: "EMP002",
      email: "fallback@example.com",
      name: "フォールバックユーザー",
      createdAt: now,
      updatedAt: now,
    });

    const res = await testApp.request("/resolve", {}, env);

    const body = await res.json();
    expect(body.result).toBe("user-002");
  });
});
