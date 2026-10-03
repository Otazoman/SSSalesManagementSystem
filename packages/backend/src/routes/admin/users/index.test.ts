import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { usersRouter } from "./index";
import { signSessionToken } from "../../../platform/auth/session-token";
import { hashPassword, verifyPassword } from "../../../utils/crypto";

/**
 * 2-2(エラー処理統一)前の現状挙動を固定するキャラクタリゼーションテスト。
 * ユーザーの明示的な指示により admin/users も対象に含める(CLAUDE.mdの認証保護規定に
 * 該当するが、今回はユーザー確認済み)。authそのもの(ログイン処理)は対象外のまま。
 *
 * sendEmail/sendSystemEmail の実送信(実SMTPソケット接続)が絡むパスは
 * テスト環境で再現しないため対象外とする(mail-settingsと同様の方針)。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.userRoles);
  await db.delete(schema.roles);
  await db.delete(schema.users);

  await db.insert(schema.roles).values({
    id: "manager",
    name: "マネージャー",
    createdAt: new Date(),
  });
});

async function seedUser(
  id: string,
  employeeNumber: string,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  const now = new Date();
  await db.insert(schema.users).values({
    id,
    employeeNumber,
    email: `${id}@example.com`,
    name: `ユーザー${id}`,
    passwordHash: "hashed-initial",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

// 操作者は署名付きセッションcookieから決まる(BUG-020。以前はブラウザが送る x-user-id ヘッダーだった)
async function sessionCookieOf(userId: string) {
  const token = await signSessionToken(
    {
      userId,
      employeeNumber: userId,
      name: userId,
      role: "manager",
      deptName: "",
      companyName: "",
      isAuditEnabled: false,
    },
    await env.SESSION_SECRET.get(),
    3600,
  );
  return { Cookie: `session_token=${token}` };
}

async function reqJson(
  path: string,
  method: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  return usersRouter.request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    },
    env,
  );
}

describe("POST /setup-admin", () => {
  it("既に初期化済みの場合は400・固定メッセージを返す", async () => {
    await seedUser("u-existing", "EMP-1");
    const res = await reqJson("/setup-admin", "POST", {
      setupToken: "test-setup-token",
      employeeNumber: "EMP-ADMIN",
      name: "初期管理者",
      email: "admin@example.com",
      password: "password123",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "既に初期化されています",
    });
  });

  it("正しいsetupTokenでの初期登録は200・固定メッセージを返す", async () => {
    const res = await reqJson("/setup-admin", "POST", {
      setupToken: "test-setup-token",
      employeeNumber: "EMP-ADMIN",
      name: "初期管理者",
      email: "admin@example.com",
      password: "password123",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "初期管理者を登録しました",
    });
  });

  it("初期登録で、標準の権限枠(画面 × 5操作)も作られる(BUG-001: 画面・権限マスタを開く前にCSVで権限を取り込めるように)", async () => {
    await db.delete(schema.rolePermissions);
    await db.delete(schema.permissions);
    const res = await reqJson("/setup-admin", "POST", {
      setupToken: "test-setup-token",
      employeeNumber: "EMP-ADMIN",
      name: "初期管理者",
      email: "admin@example.com",
      password: "password123",
    });
    expect(res.status).toBe(200);
    const { SCREEN_MASTER } = await import("../../../constants/screens");
    const permissions = await db.select().from(schema.permissions);
    expect(permissions).toHaveLength(SCREEN_MASTER.length * 5);
    const unitsRead = permissions.find((p) => p.id === "master_units:read");
    expect(unitsRead).toMatchObject({ resource: "master_units", action: "read" });
    expect(unitsRead?.name).toContain("[閲覧 (R)]");
  });

  it("誤ったsetupTokenの場合は403・固定メッセージを返す", async () => {
    const res = await reqJson("/setup-admin", "POST", {
      setupToken: "wrong-token",
      employeeNumber: "EMP-ADMIN",
      name: "初期管理者",
      email: "admin@example.com",
      password: "password123",
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "初期セットアップトークンが正しくありません",
    });
  });

  it("setupTokenが空文字の場合は400・固定メッセージを返す", async () => {
    const res = await reqJson("/setup-admin", "POST", {
      setupToken: "",
      employeeNumber: "EMP-ADMIN",
      name: "初期管理者",
      email: "admin@example.com",
      password: "password123",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      message: "初期セットアップトークンは必須です",
    });
  });
});

describe("POST /register", () => {
  it("正常登録は200・固定メッセージを返す", async () => {
    const res = await reqJson("/register", "POST", {
      employeeNumber: "EMP-2",
      name: "新規ユーザー",
      email: "new-user@example.com",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "ユーザーと所属・権限情報を登録しました",
    });
  });

  it("管理者が入力したパスワードは、会社設定のルールを満たさなくても登録できる(BUG-046)", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ password_min_length: "20", password_require_symbol: true }),
    );
    const res = await reqJson("/register", "POST", {
      employeeNumber: "EMP-P1",
      name: "短いパスワード",
      email: "p1@example.com",
      password: "abc",
    });
    await env.COMPANY_SETTINGS.delete("config");
    expect(res.status).toBe(200);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.employeeNumber, "EMP-P1"));
    expect((await verifyPassword("abc", row.passwordHash)).ok).toBe(true);
  });
});

describe("PUT /:id", () => {
  it("管理者権限のない操作者(セッションcookie)からの更新は403・固定メッセージを返す", async () => {
    await seedUser("u-operator", "EMP-OP");
    await db.insert(schema.userRoles).values({
      userId: "u-operator",
      roleId: "manager",
      departmentSurrogateId: null,
    });
    await seedUser("u-target", "EMP-3");

    const res = await reqJson(
      "/u-target",
      "PUT",
      { name: "改名", email: "u-target@example.com" },
      await sessionCookieOf("u-operator"),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "ユーザーを編集する権限がありません(システム管理者のみ可能です)",
    });
  });

  it("存在しないユーザーの更新は404・固定メッセージを返す(操作者ヘッダー未指定)", async () => {
    const res = await reqJson("/nope", "PUT", {
      name: "改名",
      email: "nope@example.com",
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "ユーザーが見つかりません",
    });
  });

  it("初期システム管理者の無効化は400・固定メッセージを返す", async () => {
    await seedUser("u-admin", "admin");
    const res = await reqJson("/u-admin", "PUT", {
      name: "管理者",
      email: "u-admin@example.com",
      isActive: false,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "初期システム管理者を無効化することはできません",
    });
  });

  it("通常の更新は200・固定メッセージを返す", async () => {
    await seedUser("u-target", "EMP-3");
    const res = await reqJson("/u-target", "PUT", {
      name: "改名後",
      email: "u-target@example.com",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "ユーザー情報を更新しました",
    });
  });
});

describe("POST /:id/suspend (無効化)", () => {
  it("管理者権限のない操作者からの無効化は403・固定メッセージを返す", async () => {
    await seedUser("u-operator", "EMP-OP");
    await db.insert(schema.userRoles).values({
      userId: "u-operator",
      roleId: "manager",
      departmentSurrogateId: null,
    });
    await seedUser("u-target", "EMP-3");

    const res = await reqJson("/u-target/suspend", "POST", undefined, await sessionCookieOf("u-operator"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "ユーザーを無効化する権限がありません(システム管理者のみ可能です)",
    });
  });

  it("存在しないユーザーの無効化は404・固定メッセージを返す", async () => {
    const res = await reqJson("/nope/suspend", "POST");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "ユーザーが見つかりません",
    });
  });

  it("初期システム管理者の無効化は400・固定メッセージを返す", async () => {
    await seedUser("u-admin", "admin");
    const res = await reqJson("/u-admin/suspend", "POST");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "初期システム管理者を無効化することはできません",
    });
  });

  it("通常の無効化は200・固定メッセージを返す", async () => {
    await seedUser("u-target", "EMP-3");
    const res = await reqJson("/u-target/suspend", "POST");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "ユーザーを無効化し、所属・権限を解除しました",
    });
  });
});

describe("DELETE /:id/purge", () => {
  it("管理者権限のない操作者からの物理消去は403・固定メッセージを返す", async () => {
    await seedUser("u-operator", "EMP-OP");
    await db.insert(schema.userRoles).values({
      userId: "u-operator",
      roleId: "manager",
      departmentSurrogateId: null,
    });
    await seedUser("u-target", "EMP-3");

    const res = await reqJson("/u-target/purge", "DELETE", undefined, await sessionCookieOf("u-operator"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "ユーザーを削除する権限がありません(システム管理者のみ可能です)",
    });
  });

  it("存在しないユーザーの物理消去は404・固定メッセージを返す", async () => {
    const res = await reqJson("/nope/purge", "DELETE");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "ユーザーが見つかりません",
    });
  });

  it("初期システム管理者の物理消去は400・固定メッセージを返す", async () => {
    await seedUser("u-admin", "admin");
    const res = await reqJson("/u-admin/purge", "DELETE");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "初期システム管理者は物理削除できません",
    });
  });

  it("所属・権限が残っている場合は400・固定メッセージを返す", async () => {
    await seedUser("u-target", "EMP-3");
    await db.insert(schema.userRoles).values({
      userId: "u-target",
      roleId: "manager",
      departmentSurrogateId: null,
    });
    const res = await reqJson("/u-target/purge", "DELETE");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "まだ所属・権限マトリックスが残っているため削除できません",
    });
  });

  it("通常の物理消去は200・固定メッセージを返す", async () => {
    await seedUser("u-target", "EMP-3");
    const res = await reqJson("/u-target/purge", "DELETE");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "ユーザーアカウントを完全に消去しました",
    });
  });
});

describe("POST /bulk-register", () => {
  it("ヘッダー不正は400・固定メッセージを返す", async () => {
    const formData = new FormData();
    formData.set("file", new File(["a,b\n1,2"], "users.csv", { type: "text/csv" }));
    const res = await usersRouter.request(
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
      "employeeNumber,name,email,departmentId,roleId,passwordRaw",
      "EMP-9,新規CSVユーザー,csv-user@example.com,,,",
    ].join("\n");
    const formData = new FormData();
    formData.set("file", new File([csv], "users.csv", { type: "text/csv" }));
    const res = await usersRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "CSVから 1 行の所属・配属権限データを完全同期しました",
    });
  });
});

describe("POST /change-password", () => {
  it("ログインしていなければ401を返す", async () => {
    const res = await reqJson("/change-password", "POST", {
      userId: "u-target",
      currentPassword: "old12345",
      newPassword: "new12345",
    });
    expect(res.status).toBe(401);
  });

  it("セッションのユーザーが存在しない場合は404・固定メッセージを返す", async () => {
    const res = await reqJson(
      "/change-password",
      "POST",
      { currentPassword: "old12345", newPassword: "new12345" },
      await sessionCookieOf("nope"),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "ユーザーが見つかりません",
    });
  });

  it("現在のパスワードが不一致の場合は400・固定メッセージを返す", async () => {
    await seedUser("u-target", "EMP-3", { passwordHash: await hashPassword("correct-password") });
    const res = await reqJson(
      "/change-password",
      "POST",
      { currentPassword: "wrong-password", newPassword: "new12345" },
      await sessionCookieOf("u-target"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "現在のパスワードが正しくありません",
    });
  });

  it("保存されているハッシュ値そのものを現在のパスワードとして入れても400になる(BUG-021)", async () => {
    const stored = await hashPassword("correct-password");
    await seedUser("u-target", "EMP-3", { passwordHash: stored });
    const res = await reqJson(
      "/change-password",
      "POST",
      { currentPassword: stored, newPassword: "new12345" },
      await sessionCookieOf("u-target"),
    );
    expect(res.status).toBe(400);
  });

  it("正常な変更は200。変更されるのはログイン中の本人で、送られた userId の人は変わらない", async () => {
    await seedUser("u-target", "EMP-3", { passwordHash: await hashPassword("old-password") });
    await seedUser("u-other", "EMP-4", { passwordHash: "other-hash" });
    const res = await reqJson(
      "/change-password",
      "POST",
      { userId: "u-other", currentPassword: "old-password", newPassword: "new12345" },
      await sessionCookieOf("u-target"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: "正常に更新しました" });

    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, "u-target"));
    expect((await verifyPassword("new12345", target.passwordHash)).ok).toBe(true);
    const [other] = await db.select().from(schema.users).where(eq(schema.users.id, "u-other"));
    expect(other.passwordHash).toBe("other-hash");
  });

  it("会社設定のパスワードのルールを満たさない場合は400で、パスワードは変わらない(BUG-046)", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ password_min_length: "10", password_require_digit: true }),
    );
    await seedUser("u-target", "EMP-3", { passwordHash: await hashPassword("old-password") });
    const res = await reqJson(
      "/change-password",
      "POST",
      { currentPassword: "old-password", newPassword: "abcdefghij" },
      await sessionCookieOf("u-target"),
    );
    await env.COMPANY_SETTINGS.delete("config");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      message: "パスワードは10文字以上で、数字を含めてください",
    });
    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, "u-target"));
    expect((await verifyPassword("old-password", target.passwordHash)).ok).toBe(true);
  });
});

describe("POST /forgot-password", () => {
  it("存在しないメールアドレスでも200(競合防止のため一律成功)を返す", async () => {
    const res = await reqJson("/forgot-password", "POST", {
      email: "nonexistent@example.com",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "入力されたメールアドレス宛に再設定の案内の送信を予約しました",
    });
  });
});

describe("POST /reset-password-via-token", () => {
  it("無効・期限切れトークンは400・固定メッセージを返す", async () => {
    const res = await reqJson("/reset-password-via-token", "POST", {
      token: "invalid-token",
      newPassword: "new12345",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "URLの有効期限が切れているか、または既に利用されています",
    });
  });

  it("有効なトークンでの再設定は200・固定メッセージを返す", async () => {
    await seedUser("u-target", "EMP-3");
    await env.COMPANY_SETTINGS.put("reset_token:valid-token", "u-target", {
      expirationTtl: 3600,
    });

    const res = await reqJson("/reset-password-via-token", "POST", {
      token: "valid-token",
      newPassword: "new12345",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message:
        "パスワードを正常に更新しました。新しいパスワードでログインしてください。",
    });
  });

  it("会社設定のパスワードのルールを満たさない場合は400で、トークンは使える状態のまま(BUG-046)", async () => {
    await env.COMPANY_SETTINGS.put("config", JSON.stringify({ password_require_symbol: true }));
    await seedUser("u-target", "EMP-3");
    await env.COMPANY_SETTINGS.put("reset_token:valid-token", "u-target", { expirationTtl: 3600 });

    const res = await reqJson("/reset-password-via-token", "POST", {
      token: "valid-token",
      newPassword: "new12345",
    });
    await env.COMPANY_SETTINGS.delete("config");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      message: "パスワードは8文字以上で、記号を含めてください",
    });
    expect(await env.COMPANY_SETTINGS.get("reset_token:valid-token")).toBe("u-target");
    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, "u-target"));
    expect(target.passwordHash).toBe("hashed-initial");
  });
});

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await seedUser("u-1", "EMP-1");
    const res = await usersRouter.request("/", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((u) => u.id === "u-1")).toBe(true);
  });

  it("page/limit指定時は既存の検索条件を維持したまま{data,pagination}形式で返す(JS側フィルタ適用後の全件をページ分割)", async () => {
    await seedUser("u-1", "EMP-1");
    await seedUser("u-2", "EMP-2");
    const res = await usersRouter.request("/?page=1&limit=1", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });
});

describe("追加要望B: パスワード再設定の送信チャネル(通知方法設定に従う)", () => {
  async function forgot(email: string) {
    const ctx = createExecutionContext();
    const res = await usersRouter.request(
      "/forgot-password",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }

  async function latestLog() {
    return env.DB_LOG.prepare(
      "SELECT type, recipient_to AS recipientTo, body FROM mail_delivery_logs WHERE category = 'password_reset' ORDER BY performed_at DESC LIMIT 1",
    ).first<{ type: string; recipientTo: string; body: string }>();
  }

  beforeEach(async () => {
    await env.DB_LOG.prepare("DELETE FROM mail_delivery_logs").run();
    await env.COMPANY_SETTINGS.put("config", JSON.stringify({ slack_bot_token: "xoxb-test" }));
  });

  it("通知方法が「メール」なら従来どおりメールで送る", async () => {
    await seedUser("u-mail", "EMP-M", { notificationChannel: "email", slackUserId: "U111" });
    expect((await forgot("u-mail@example.com")).status).toBe(200);
    const log = await latestLog();
    expect(log?.type).toBe("email");
    expect(log?.recipientTo).toBe("u-mail@example.com");
  });

  it("通知方法が「Slack」でSlackメンバーIDがあればSlack DMのみで送る", async () => {
    await seedUser("u-slack", "EMP-S", { notificationChannel: "slack", slackUserId: "U222" });
    expect((await forgot("u-slack@example.com")).status).toBe(200);
    const log = await latestLog();
    expect(log?.type).toBe("slack");
    expect(log?.recipientTo).toBe("U222");
    expect(log?.body).toContain("/password-reset?token=");
    const count = await env.DB_LOG.prepare(
      "SELECT COUNT(*) AS n FROM mail_delivery_logs WHERE category = 'password_reset'",
    ).first<{ n: number }>();
    expect(count?.n).toBe(1); // メールとSlackの二重送信をしない
  });

  it("「Slack」でもSlackメンバーID未設定、またはSlack Botトークン未設定ならメールへフォールバックする", async () => {
    await seedUser("u-noid", "EMP-N", { notificationChannel: "slack", slackUserId: null });
    await forgot("u-noid@example.com");
    expect((await latestLog())?.type).toBe("email");

    await env.DB_LOG.prepare("DELETE FROM mail_delivery_logs").run();
    await env.COMPANY_SETTINGS.put("config", JSON.stringify({}));
    await seedUser("u-notoken", "EMP-T", { notificationChannel: "slack", slackUserId: "U333" });
    await forgot("u-notoken@example.com");
    const log = await latestLog();
    expect(log?.type).toBe("email");
    expect(log?.recipientTo).toBe("u-notoken@example.com");
  });
});

describe("追加要望B: 管理者によるSlack通知設定(登録・更新)", () => {
  it("登録時にSlackメンバーID・通知方法を保存でき、一覧にも返る", async () => {
    const res = await reqJson("/register", "POST", {
      employeeNumber: "EMP-R1",
      name: "登録太郎",
      email: "r1@example.com",
      password: "pass12345",
      slackUserId: " U999 ",
      notificationChannel: "slack",
    });
    expect(res.status).toBe(200);
    const row = await db.select().from(schema.users).where(eq(schema.users.employeeNumber, "EMP-R1"));
    expect(row[0].slackUserId).toBe("U999");
    expect(row[0].notificationChannel).toBe("slack");
  });

  it("Slack選択でSlackメンバーIDが空なら400(登録・更新とも)", async () => {
    const reg = await reqJson("/register", "POST", {
      employeeNumber: "EMP-R2",
      name: "登録花子",
      email: "r2@example.com",
      password: "pass12345",
      notificationChannel: "slack",
    });
    expect(reg.status).toBe(400);

    await seedUser("u-upd", "EMP-U");
    const upd = await reqJson("/u-upd", "PUT", {
      name: "更新",
      email: "u-upd@example.com",
      notificationChannel: "slack",
    });
    expect(upd.status).toBe(400);
  });

  it("更新でSlack項目を省略すると既存値は変わらない", async () => {
    await seedUser("u-keep", "EMP-K", { notificationChannel: "slack", slackUserId: "UKEEP" });
    const res = await reqJson("/u-keep", "PUT", { name: "名前だけ更新", email: "u-keep@example.com" });
    expect(res.status).toBe(200);
    const row = await db.select().from(schema.users).where(eq(schema.users.id, "u-keep"));
    expect(row[0].slackUserId).toBe("UKEEP");
    expect(row[0].notificationChannel).toBe("slack");
  });
});

describe("追加要望B: ユーザーCSVのSlack列", () => {
  async function bulk(csv: string) {
    const formData = new FormData();
    formData.set("file", new File([csv], "users.csv", { type: "text/csv" }));
    return usersRouter.request("/bulk-register", { method: "POST", body: formData }, env);
  }
  const H8 = "employeeNumber,name,email,departmentId,roleId,passwordRaw,slackUserId,notificationChannel";

  it("Slack列付きCSVで新規登録・既存更新でき、Slack設定が反映される", async () => {
    await seedUser("u-csv", "EMP-CSV", { notificationChannel: "email", slackUserId: null });
    const res = await bulk([H8, "EMP-CSV,更新名,u-csv@example.com,,,,UCSV1,slack", "EMP-NEW,新規,new-csv@example.com,,,,,"].join("\n"));
    expect(res.status).toBe(200);
    const upd = await db.select().from(schema.users).where(eq(schema.users.employeeNumber, "EMP-CSV"));
    expect(upd[0].slackUserId).toBe("UCSV1");
    expect(upd[0].notificationChannel).toBe("slack");
    const created = await db.select().from(schema.users).where(eq(schema.users.employeeNumber, "EMP-NEW"));
    expect(created[0].notificationChannel).toBe("email"); // 空欄はemail
    expect(created[0].slackUserId).toBeNull();
  });

  it("従来の6列形式では既存のSlack設定を変更しない", async () => {
    await seedUser("u-old", "EMP-OLD", { notificationChannel: "slack", slackUserId: "UOLD" });
    const res = await bulk(["employeeNumber,name,email,departmentId,roleId,passwordRaw", "EMP-OLD,名前変更,u-old@example.com,,,"].join("\n"));
    expect(res.status).toBe(200);
    const row = await db.select().from(schema.users).where(eq(schema.users.employeeNumber, "EMP-OLD"));
    expect(row[0].name).toBe("名前変更");
    expect(row[0].slackUserId).toBe("UOLD");
    expect(row[0].notificationChannel).toBe("slack");
  });

  it("不正な通知方法・slackでID空は、何も書き込まず行番号付きで400", async () => {
    const bad1 = await bulk([H8, "EMP-X1,名前,x1@example.com,,,,,line"].join("\n"));
    expect(bad1.status).toBe(400);
    expect(((await bad1.json()) as any).message).toContain("2行目");

    const bad2 = await bulk([H8, "EMP-OK,名前,ok@example.com,,,,,", "EMP-X2,名前,x2@example.com,,,,,slack"].join("\n"));
    expect(bad2.status).toBe(400);
    expect(((await bad2.json()) as any).message).toContain("3行目");
    const ok = await db.select().from(schema.users).where(eq(schema.users.employeeNumber, "EMP-OK"));
    expect(ok).toHaveLength(0); // 1行目も反映されていない
  });

  it("CSVダウンロードにSlack列が含まれる", async () => {
    await seedUser("u-exp", "EMP-EXP", { notificationChannel: "slack", slackUserId: "UEXP" });
    const res = await usersRouter.request("/csv-download", {}, env, createExecutionContext());
    const text = await res.text();
    expect(text).toContain(",slackUserId,notificationChannel");
    expect(text).toContain('"UEXP","slack"');
  });
});
