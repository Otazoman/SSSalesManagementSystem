import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import { hashPassword, verifyPassword } from "../../utils/crypto";
import { legacyHash } from "../../../test/support/legacy-password-hash";
import { signSessionToken } from "../../platform/auth/session-token";
import { authRouter } from "./index";

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.userLoginStates);
  await db.delete(schema.userRoles);
  await db.delete(schema.departments);
  await db.delete(schema.roles);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.delete("config");
});

async function seedUser(
  id: string,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  const now = new Date();
  await db.insert(schema.users).values({
    id,
    employeeNumber: `EMP-${id}`,
    email: `${id}@example.com`,
    name: overrides.name ?? `ユーザー${id}`,
    passwordHash: await hashPassword("correct-password"),
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

function getSetCookieHeader(res: Response): string {
  return res.headers.get("set-cookie") || "";
}

async function login(employeeNumber: string, password: string) {
  return authRouter.request(
    "/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeNumber, password }),
    },
    env,
  );
}

describe("POST /login のパスワード照合(BUG-021)", () => {
  it("保存されているハッシュ値そのものをパスワードに入れてもログインできない", async () => {
    await seedUser("user-1");
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, "user-1"));
    const res = await login("EMP-user-1", user.passwordHash!);
    expect(res.status).toBe(401);
    expect(getSetCookieHeader(res)).toBe("");
  });

  it("以前の形(固定ソルト)で保存されたユーザーもログインでき、ログイン後はユーザーごとのソルトの形に書き換わる", async () => {
    await seedUser("user-1", { passwordHash: await legacyHash("old-password") });
    const res = await login("EMP-user-1", "old-password");
    expect(res.status).toBe(200);

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, "user-1"));
    expect(user.passwordHash).toMatch(/^pbkdf2-sha256\$/);
    expect(await verifyPassword("old-password", user.passwordHash)).toEqual({ ok: true, needsRehash: false });
    // 書き換えた後も同じパスワードでログインできる
    expect((await login("EMP-user-1", "old-password")).status).toBe(200);
  });

  it("以前の形のユーザーでも、ハッシュ値そのものではログインできない", async () => {
    const legacy = await legacyHash("old-password");
    await seedUser("user-1", { passwordHash: legacy });
    expect((await login("EMP-user-1", legacy)).status).toBe(401);
  });
});

async function loginByEmail(email: string, password: string) {
  return authRouter.request(
    "/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    env,
  );
}

async function findUser(id: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return user;
}

async function setMaxFailedAttempts(value: string) {
  await env.COMPANY_SETTINGS.put("config", JSON.stringify({ login_max_failed_attempts: value }));
}

describe("POST /login の失敗回数の制限(BUG-022)", () => {
  it("上限(既定5回)に達するまでは401。5回続けて失敗するとロック(無効化)され、正しいパスワードでもログインできない", async () => {
    await seedUser("user-1");
    for (let i = 0; i < 4; i++) {
      expect((await login("EMP-user-1", "wrong")).status).toBe(401);
    }
    expect((await findUser("user-1")).isActive).toBe(true);

    const locked = await login("EMP-user-1", "wrong");
    expect(locked.status).toBe(403);
    expect(((await locked.json()) as { message: string }).message).toContain("ロックしました");
    expect((await findUser("user-1")).isActive).toBe(false);

    const afterLock = await login("EMP-user-1", "correct-password");
    expect(afterLock.status).toBe(403);
    expect(getSetCookieHeader(afterLock)).toBe("");
  });

  it("ログインに成功すると、失敗の回数は0に戻る", async () => {
    await seedUser("user-1");
    for (let i = 0; i < 4; i++) await login("EMP-user-1", "wrong");
    expect((await login("EMP-user-1", "correct-password")).status).toBe(200);
    for (let i = 0; i < 4; i++) {
      expect((await login("EMP-user-1", "wrong")).status).toBe(401);
    }
    expect((await findUser("user-1")).isActive).toBe(true);
  });

  it("最後の失敗から24時間以上たっていれば、数え直す", async () => {
    await seedUser("user-1");
    await db.insert(schema.userLoginStates).values({
      userId: "user-1",
      failedCount: 4,
      lastFailedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    expect((await login("EMP-user-1", "wrong")).status).toBe(401);
    expect((await findUser("user-1")).isActive).toBe(true);
  });

  it("上限は会社設定で変えられる(3回)。0なら制限しない", async () => {
    await seedUser("user-1");
    await setMaxFailedAttempts("3");
    await login("EMP-user-1", "wrong");
    await login("EMP-user-1", "wrong");
    expect((await login("EMP-user-1", "wrong")).status).toBe(403);
    expect((await findUser("user-1")).isActive).toBe(false);

    await seedUser("user-2");
    await setMaxFailedAttempts("0");
    for (let i = 0; i < 10; i++) {
      expect((await login("EMP-user-2", "wrong")).status).toBe(401);
    }
    expect((await findUser("user-2")).isActive).toBe(true);
  });

  it("無効化されたアカウントは、パスワードが違えば他と同じ401(存在を知らせない)。合っている時だけ無効化を伝える", async () => {
    await seedUser("user-1", { isActive: false });
    const wrong = await login("EMP-user-1", "wrong");
    expect(wrong.status).toBe(401);
    const correct = await login("EMP-user-1", "correct-password");
    expect(correct.status).toBe(403);
  });

  it("初期のシステム管理者は、従業員番号ではログインできない(メールアドレスならできる)", async () => {
    await seedUser("root", { employeeNumber: "admin", email: "root@example.com" });
    expect((await login("admin", "correct-password")).status).toBe(401);
    expect((await loginByEmail("root@example.com", "correct-password")).status).toBe(200);
  });

  it("初期のシステム管理者は、上限に達しても無効化せず、15分間ログインを止める", async () => {
    await seedUser("root", { employeeNumber: "admin", email: "root@example.com" });
    for (let i = 0; i < 4; i++) await loginByEmail("root@example.com", "wrong");
    const locked = await loginByEmail("root@example.com", "wrong");
    expect(locked.status).toBe(403);
    expect(((await locked.json()) as { message: string }).message).toContain("一時的に");
    expect((await findUser("root")).isActive).toBe(true);
    expect((await loginByEmail("root@example.com", "correct-password")).status).toBe(403);

    // 期限が過ぎればログインできる
    await db
      .update(schema.userLoginStates)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(schema.userLoginStates.userId, "root"));
    expect((await loginByEmail("root@example.com", "correct-password")).status).toBe(200);
  });

  it("従業員番号 admin での失敗は数えない(従業員番号からロックさせられない)", async () => {
    await seedUser("root", { employeeNumber: "admin", email: "root@example.com" });
    for (let i = 0; i < 6; i++) await login("admin", "wrong");
    expect((await loginByEmail("root@example.com", "correct-password")).status).toBe(200);
  });
});

describe("POST /login", () => {
  it("正しいメールアドレス・パスワードでログインすると、200かつhttpOnly署名付きcookieが発行される", async () => {
    await seedUser("user-1");

    const res = await authRouter.request(
      "/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "user-1@example.com",
          password: "correct-password",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.user.id).toBe("user-1");

    const setCookie = getSetCookieHeader(res);
    expect(setCookie).toContain("session_token=");
    expect(setCookie.toLowerCase()).toContain("httponly");

    // 従来の6cookie方式ではなくなっていることを確認
    expect(setCookie).not.toContain("login_user_id=");
    expect(setCookie).not.toContain("login_user_role=");
  });

  it("パスワードが間違っている場合、401かつcookieは発行されない", async () => {
    await seedUser("user-1");

    const res = await authRouter.request(
      "/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "user-1@example.com",
          password: "wrong-password",
        }),
      },
      env,
    );

    expect(res.status).toBe(401);
    expect(getSetCookieHeader(res)).toBe("");
  });

  it("正しい従業員番号・パスワードでログインすると、200かつhttpOnly署名付きcookieが発行される", async () => {
    await seedUser("user-1");

    const res = await authRouter.request(
      "/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeNumber: "EMP-user-1",
          password: "correct-password",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.user.id).toBe("user-1");

    const setCookie = getSetCookieHeader(res);
    expect(setCookie).toContain("session_token=");
    expect(setCookie.toLowerCase()).toContain("httponly");
  });

  it("存在しない従業員番号の場合、401を返す", async () => {
    await seedUser("user-1");

    const res = await authRouter.request(
      "/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeNumber: "EMP-not-exist",
          password: "correct-password",
        }),
      },
      env,
    );

    expect(res.status).toBe(401);
    expect(getSetCookieHeader(res)).toBe("");
  });

  it("メールアドレス・従業員番号を両方指定した場合、400を返す", async () => {
    await seedUser("user-1");

    const res = await authRouter.request(
      "/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "user-1@example.com",
          employeeNumber: "EMP-user-1",
          password: "correct-password",
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it("メールアドレス・従業員番号のどちらも指定しなかった場合、400を返す", async () => {
    const res = await authRouter.request(
      "/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "correct-password" }),
      },
      env,
    );

    expect(res.status).toBe(400);
  });
});

describe("GET /profile", () => {
  it("有効な署名付きcookieがあれば、200でユーザー情報を返す", async () => {
    await seedUser("user-1", { name: "山田太郎" });

    const token = await signSessionToken(
      {
        userId: "user-1",
        employeeNumber: "EMP001",
        name: "山田太郎",
        role: "admin",
        deptName: "全社共通",
        companyName: "サンプル会社",
        isAuditEnabled: true,
      },
      await env.SESSION_SECRET.get(),
      3600,
    );

    const res = await authRouter.request(
      "/profile",
      { headers: { Cookie: `session_token=${token}` } },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("user-1");
    expect(body.name).toBe("山田太郎");
    expect(body.roleId).toBe("admin");
    expect(body.companyName).toBe("サンプル会社");
  });

  it("cookieが無い場合、401を返す", async () => {
    const res = await authRouter.request("/profile", {}, env);
    expect(res.status).toBe(401);
  });

  it("署名が改ざんされたcookieの場合、401を返す", async () => {
    const tamperedToken = await signSessionToken(
      {
        userId: "user-1",
        employeeNumber: "EMP001",
        name: "山田太郎",
        role: "admin", // 改ざん: 一般ユーザーからadminへ昇格を試みる
        deptName: "未配属",
        companyName: "サンプル会社",
        isAuditEnabled: true,
      },
      "wrong-secret", // 正規の署名鍵を持たないため、検証に失敗するはず
      3600,
    );

    const res = await authRouter.request(
      "/profile",
      { headers: { Cookie: `session_token=${tamperedToken}` } },
      env,
    );

    expect(res.status).toBe(401);
  });

  it("有効期限切れのcookieの場合、401を返す", async () => {
    const expiredToken = await signSessionToken(
      {
        userId: "user-1",
        employeeNumber: "EMP001",
        name: "山田太郎",
        role: "general_user",
        deptName: "未配属",
        companyName: "サンプル会社",
        isAuditEnabled: true,
      },
      await env.SESSION_SECRET.get(),
      -10,
    );

    const res = await authRouter.request(
      "/profile",
      { headers: { Cookie: `session_token=${expiredToken}` } },
      env,
    );

    expect(res.status).toBe(401);
  });

  it("追加要望F: 複数部署に所属するユーザーは、departmentsに重複除去した所属部署一覧を返す", async () => {
    const now = new Date();
    await seedUser("user-1", { name: "兼務太郎" });
    await db.insert(schema.roles).values({
      id: "general_user",
      name: "一般ユーザー",
      createdAt: now,
    });
    await db.insert(schema.departments).values([
      {
        surrogateId: "dept-a",
        id: "D001",
        name: "営業統括部",
        validFrom: now,
        createdBy: "system",
        createdAt: now,
        updatedBy: "system",
        updatedAt: now,
      },
      {
        surrogateId: "dept-b",
        id: "D002",
        name: "人事総務部",
        validFrom: now,
        createdBy: "system",
        createdAt: now,
        updatedBy: "system",
        updatedAt: now,
      },
    ]);
    await db.insert(schema.userRoles).values([
      { userId: "user-1", roleId: "general_user", departmentSurrogateId: "dept-a" },
      { userId: "user-1", roleId: "general_user", departmentSurrogateId: "dept-b" },
    ]);

    const token = await signSessionToken(
      {
        userId: "user-1",
        employeeNumber: "EMP-user-1",
        name: "兼務太郎",
        role: "general_user",
        deptName: "営業統括部",
        companyName: "サンプル会社",
        isAuditEnabled: true,
      },
      await env.SESSION_SECRET.get(),
      3600,
    );

    const res = await authRouter.request(
      "/profile",
      { headers: { Cookie: `session_token=${token}` } },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      departments: Array<{ surrogateId: string; id: string; name: string }>;
    };
    expect(body.departments).toHaveLength(2);
    expect(body.departments).toEqual(
      expect.arrayContaining([
        { surrogateId: "dept-a", id: "D001", name: "営業統括部" },
        { surrogateId: "dept-b", id: "D002", name: "人事総務部" },
      ]),
    );
  });
});

// PERF-04: 承認ワークフローのスイッチ(26個)は、会社設定(KV の "config")を1回だけ読んで返す
// 応答の項目名 → 会社設定のキー
const WORKFLOW_FLAG_CONFIG_KEYS: Record<string, string> = {
  isPartnerWfEnabled: "is_partner_approval_enabled",
  isQuoteWfEnabled: "is_quote_approval_enabled",
  isPartnerContactWfEnabled: "is_partner_contact_approval_enabled",
  isUnitWfEnabled: "is_unit_approval_enabled",
  isLocationWfEnabled: "is_location_approval_enabled",
  isProductPriceWfEnabled: "is_product_price_approval_enabled",
  isProductWfEnabled: "is_product_approval_enabled",
  isAccountWfEnabled: "is_account_approval_enabled",
  isWarehouseWfEnabled: "is_warehouse_approval_enabled",
  isBusinessLocationWfEnabled: "is_business_location_approval_enabled",
  isItemStructureWfEnabled: "is_item_structure_approval_enabled",
  isReceivingWfEnabled: "is_receiving_approval_enabled",
  isShippingWfEnabled: "is_shipping_approval_enabled",
  isInventoryWfEnabled: "is_inventory_approval_enabled",
  isDamageWfEnabled: "is_damage_approval_enabled",
  isDisposalWfEnabled: "is_disposal_approval_enabled",
  isReturnWfEnabled: "is_return_approval_enabled",
  isShippingInstructionWfEnabled: "is_shipping_instruction_approval_enabled",
  isShippingResultWfEnabled: "is_shipping_result_approval_enabled",
  isReceivingInstructionWfEnabled: "is_receiving_instruction_approval_enabled",
  isReceivingResultWfEnabled: "is_receiving_result_approval_enabled",
  isSalesOrderWfEnabled: "is_sales_order_approval_enabled",
  isPurchaseRequisitionWfEnabled: "is_purchase_requisition_approval_enabled",
  isPurchaseOrderWfEnabled: "is_purchase_order_approval_enabled",
  isSalesInvoiceWfEnabled: "is_sales_approval_enabled",
  isPurchaseRecognitionWfEnabled: "is_purchase_approval_enabled",
};

// COMPANY_SETTINGS の get("config") の回数を数える env を作る
function envCountingConfigReads() {
  const counter = { configReads: 0 };
  const kv = env.COMPANY_SETTINGS;
  const countingKv = new Proxy(kv, {
    get(target, prop) {
      if (prop === "get") {
        return (key: string, ...rest: unknown[]) => {
          if (key === "config") counter.configReads += 1;
          return (target.get as (...a: unknown[]) => unknown).call(target, key, ...rest);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { testEnv: { ...env, COMPANY_SETTINGS: countingKv }, counter };
}

async function profileToken() {
  return signSessionToken(
    {
      userId: "user-1",
      employeeNumber: "EMP-user-1",
      name: "山田太郎",
      role: "admin",
      deptName: "全社共通",
      companyName: "サンプル会社",
      isAuditEnabled: false,
    },
    await env.SESSION_SECRET.get(),
    3600,
  );
}

describe("GET /profile の承認ワークフローのスイッチ(PERF-04)", () => {
  it("26個のスイッチを会社設定の値どおりに返し、会社設定は1回だけ読む", async () => {
    await seedUser("user-1", { name: "山田太郎" });
    const responseKeys = Object.keys(WORKFLOW_FLAG_CONFIG_KEYS);
    // 1つおきに ON(true と "true" を交互)、残りは OFF(false・"false"・未設定)
    const config: Record<string, unknown> = { company_name: "サンプル会社" };
    const expected: Record<string, boolean> = {};
    responseKeys.forEach((responseKey, i) => {
      const configKey = WORKFLOW_FLAG_CONFIG_KEYS[responseKey];
      if (i % 2 === 0) {
        config[configKey] = i % 4 === 0 ? true : "true";
        expected[responseKey] = true;
      } else {
        if (i % 3 === 0) config[configKey] = "false";
        else if (i % 3 === 1) config[configKey] = false;
        expected[responseKey] = false;
      }
    });
    await env.COMPANY_SETTINGS.put("config", JSON.stringify(config));

    const { testEnv, counter } = envCountingConfigReads();
    const res = await authRouter.request(
      "/profile",
      { headers: { Cookie: `session_token=${await profileToken()}` } },
      testEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    for (const responseKey of responseKeys) {
      expect({ [responseKey]: body[responseKey] }).toEqual({ [responseKey]: expected[responseKey] });
    }
    expect(counter.configReads).toBe(1);
  });

  it("会社設定が無い時は、26個とも false を返す", async () => {
    await seedUser("user-1", { name: "山田太郎" });

    const res = await authRouter.request(
      "/profile",
      { headers: { Cookie: `session_token=${await profileToken()}` } },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    for (const responseKey of Object.keys(WORKFLOW_FLAG_CONFIG_KEYS)) {
      expect({ [responseKey]: body[responseKey] }).toEqual({ [responseKey]: false });
    }
  });

  it("会社設定が JSON として壊れている時も、200 で 26個とも false を返す", async () => {
    await seedUser("user-1", { name: "山田太郎" });
    await env.COMPANY_SETTINGS.put("config", "{broken");

    const res = await authRouter.request(
      "/profile",
      { headers: { Cookie: `session_token=${await profileToken()}` } },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    for (const responseKey of Object.keys(WORKFLOW_FLAG_CONFIG_KEYS)) {
      expect({ [responseKey]: body[responseKey] }).toEqual({ [responseKey]: false });
    }
  });
});

describe("POST /logout", () => {
  it("200を返し、session_token cookieを失効させるSet-Cookieを返す", async () => {
    const res = await authRouter.request(
      "/logout",
      { method: "POST" },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const setCookie = getSetCookieHeader(res);
    expect(setCookie).toContain("session_token=");
    expect(setCookie).toMatch(/Max-Age=0/i);
  });
});
