import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as logSchema from "../../db/audit-schema";
import { logAuditEvent } from "./log-audit-event";
import { signSessionToken } from "../auth/session-token";
import type { Env } from "../../types/env";

const logDb = drizzle(env.DB_LOG, { schema: logSchema });

async function buildSessionCookieHeader(userId: string): Promise<string> {
  const token = await signSessionToken(
    {
      userId,
      employeeNumber: userId,
      name: "テストユーザー",
      role: "user",
      deptName: "テスト部署",
      companyName: "テスト会社",
      isAuditEnabled: true,
    },
    await env.SESSION_SECRET.get(),
    3600,
  );
  return `session_token=${token}`;
}

beforeEach(async () => {
  await logDb.delete(logSchema.auditLogs);
  await env.COMPANY_SETTINGS.delete("config");
});

function buildApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/log", async (c) => {
    await logAuditEvent(c, "TEST_ACTION", "test_table", "record-1", null, {
      name: "テスト",
    });
    return c.json({ ok: true });
  });

  return app;
}

describe("logAuditEvent", () => {
  it("会社設定が未設定(デフォルト有効)の場合、監査ログが1件書き込まれる", async () => {
    const app = buildApp();
    await app.request(
      "/log",
      { headers: { Cookie: await buildSessionCookieHeader("user-1") } },
      env,
    );

    const rows = await logDb.select().from(logSchema.auditLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("TEST_ACTION");
    expect(rows[0].tableName).toBe("test_table");
    expect(rows[0].recordId).toBe("record-1");
    expect(rows[0].userId).toBe("user-1");
    expect(rows[0].newValues).toBe(JSON.stringify({ name: "テスト" }));
  });

  it("会社設定でis_audit_log_enabledがfalseの場合、監査ログは書き込まれない", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ is_audit_log_enabled: false }),
    );

    const app = buildApp();
    await app.request(
      "/log",
      { headers: { Cookie: await buildSessionCookieHeader("user-1") } },
      env,
    );

    const rows = await logDb.select().from(logSchema.auditLogs);
    expect(rows).toHaveLength(0);
  });

  it("会社設定でis_audit_log_enabledがtrueの場合、監査ログが書き込まれる", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ is_audit_log_enabled: true }),
    );

    const app = buildApp();
    await app.request(
      "/log",
      { headers: { Cookie: await buildSessionCookieHeader("user-1") } },
      env,
    );

    const rows = await logDb.select().from(logSchema.auditLogs);
    expect(rows).toHaveLength(1);
  });
});
