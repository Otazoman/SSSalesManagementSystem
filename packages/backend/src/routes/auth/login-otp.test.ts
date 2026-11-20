import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import * as otpSchema from "../../db/otp-schema";
import * as auditSchema from "../../db/audit-schema";
import { hashPassword } from "../../utils/crypto";
import { authRouter } from "./index";

// REQ-004: ログイン時の OTP。パスワードが合った後に OTP を送り、OTP が合ったらセッションを発行する。
// 送信は Slack(fetch を差し替えて、送られた本文からコードを受け取る)で確かめる。実際のメールサーバーには接続しない
const db = drizzle(env.DB, { schema });
const otpDb = drizzle(env.DB_OTP, { schema: otpSchema });
const logDb = drizzle(env.DB_LOG, { schema: auditSchema });

let slackMessages: string[] = [];
let slackOk = true;

beforeEach(async () => {
  await db.delete(schema.userLoginStates);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
  await otpDb.delete(otpSchema.loginOtpChallenges);
  await logDb.delete(auditSchema.mailDeliveryLogs);
  slackMessages = [];
  slackOk = true;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).startsWith("https://slack.com/")) {
      slackMessages.push(JSON.parse(String(init?.body)).text);
      return new Response(JSON.stringify(slackOk ? { ok: true } : { ok: false, error: "user_not_found" }));
    }
    throw new Error(`unexpected fetch: ${String(input)}`);
  });
  await setConfig({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function setConfig(overrides: Record<string, unknown>) {
  await env.COMPANY_SETTINGS.put(
    "config",
    JSON.stringify({ slack_bot_token: "xoxb-test", login_otp_resend_interval_seconds: "0", ...overrides }),
  );
}

async function seedUser(id: string, overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const now = new Date();
  await db.insert(schema.users).values({
    id,
    employeeNumber: `EMP-${id}`,
    email: `${id}@example.com`,
    name: `ユーザー${id}`,
    passwordHash: await hashPassword("correct-password"),
    isActive: true,
    loginOtpEnabled: true,
    notificationChannel: "slack",
    slackUserId: "U123",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

const post = (path: string, body: unknown) =>
  authRouter.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, env);
const login = (employeeNumber: string, password = "correct-password") => post("/login", { employeeNumber, password });
const verify = (challengeId: string, code: string) => post("/login/otp/verify", { challengeId, code });
const resend = (challengeId: string) => post("/login/otp/resend", { challengeId });
const lastCode = () => /\n(\d{4,8})\n/.exec(slackMessages[slackMessages.length - 1])![1];
const wrongCode = (code: string) => (code === "000000" ? "111111" : "000000");

async function startOtp(employeeNumber = "EMP-u1") {
  const res = await login(employeeNumber);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { otpRequired: boolean; challengeId: string; channel: string; digitCount: number };
  expect(body.otpRequired).toBe(true);
  expect(res.headers.get("set-cookie") ?? "").toBe("");
  return body;
}

describe("ログイン時の OTP(REQ-004)", () => {
  it("OTP を使うユーザーは、パスワードが合ってもセッションを発行せず、通知方法(Slack)で OTP を送る", async () => {
    await seedUser("u1");
    const body = await startOtp();
    expect(body.channel).toBe("slack");
    expect(body.digitCount).toBe(6);
    expect(lastCode()).toMatch(/^\d{6}$/);

    // コードは平文で保存しない。送信ログにもコードを残さない
    const [challenge] = await otpDb.select().from(otpSchema.loginOtpChallenges);
    expect(challenge.codeHash).not.toContain(lastCode());
    const logs = await logDb.select().from(auditSchema.mailDeliveryLogs);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ category: "login_otp", type: "slack", status: "SUCCESS" });
    expect(logs[0].body).not.toContain(lastCode());
  });

  it("OTP が合えばセッションを発行する。同じチャレンジはもう使えない", async () => {
    await seedUser("u1");
    const { challengeId } = await startOtp();
    const code = lastCode();

    const ok = await verify(challengeId, code);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toContain("session_token=");

    const again = await verify(challengeId, code);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { restart: boolean }).restart).toBe(true);
  });

  it("OTP を使わないユーザーは、従来どおりパスワードだけでログインできる", async () => {
    await seedUser("u1", { loginOtpEnabled: false });
    const res = await login("EMP-u1");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("session_token=");
    expect(slackMessages).toHaveLength(0);
  });

  it("桁数・試行回数の上限は会社設定に従う。上限に達したら、もう一度ログインからやり直す", async () => {
    await setConfig({ login_otp_digit_count: "4", login_otp_max_attempts: "2", login_max_failed_attempts: "0" });
    await seedUser("u1");
    const { challengeId, digitCount } = await startOtp();
    expect(digitCount).toBe(4);
    const code = lastCode();
    expect(code).toMatch(/^\d{4}$/);
    const wrong = code === "0000" ? "1111" : "0000";

    const first = await verify(challengeId, wrong);
    expect(first.status).toBe(401);
    expect(((await first.json()) as { message: string }).message).toContain("あと1回");

    const second = await verify(challengeId, wrong);
    expect(second.status).toBe(400);
    expect(((await second.json()) as { restart: boolean }).restart).toBe(true);
    // チャレンジは消えるため、正しいコードでも使えない
    expect((await verify(challengeId, code)).status).toBe(400);
  });

  it("OTP の間違いもログインの失敗に数える。パスワードが合っても回数は戻らず、上限でロック(無効化)する", async () => {
    await setConfig({ login_max_failed_attempts: "3" });
    await seedUser("u1");
    // パスワードを1回間違える
    expect((await login("EMP-u1", "wrong-password")).status).toBe(401);
    // パスワードは合うが、OTP を2回間違える(合計3回)
    const { challengeId } = await startOtp();
    const wrong = wrongCode(lastCode());
    expect((await verify(challengeId, wrong)).status).toBe(401);
    const locked = await verify(challengeId, wrong);
    expect(locked.status).toBe(403);

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, "u1"));
    expect(user.isActive).toBe(false);
  });

  it("初期のシステム管理者は、OTP の間違いが上限に達しても無効化せず、一時的にログインを止める", async () => {
    await setConfig({ login_max_failed_attempts: "1" });
    await seedUser("root", { employeeNumber: "admin", email: "root@example.com" });
    const res = await post("/login", { email: "root@example.com", password: "correct-password" });
    const { challengeId } = (await res.json()) as { challengeId: string };
    const locked = await verify(challengeId, wrongCode(lastCode()));
    expect(locked.status).toBe(403);

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, "root"));
    expect(user.isActive).toBe(true);
    const [state] = await db.select().from(schema.userLoginStates).where(eq(schema.userLoginStates.userId, "root"));
    expect(state.lockedUntil).not.toBeNull();
  });

  it("再送は会社設定の間隔より早いと 429。間隔が過ぎれば新しいコードを送り、前のコードは使えなくなる", async () => {
    await setConfig({ login_otp_resend_interval_seconds: "60" });
    await seedUser("u1");
    const { challengeId } = await startOtp();
    const tooEarly = await resend(challengeId);
    expect(tooEarly.status).toBe(429);
    expect(((await tooEarly.json()) as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);

    await setConfig({ login_otp_resend_interval_seconds: "0" });
    const oldCode = lastCode();
    const resent = await resend(challengeId);
    expect(resent.status).toBe(200);
    expect(slackMessages).toHaveLength(2);
    const newCode = lastCode();
    if (newCode !== oldCode) expect((await verify(challengeId, oldCode)).status).toBe(401);
    expect((await verify(challengeId, newCode)).status).toBe(200);
  });

  it("Slack に送れない場合はメールに切り替える。メールも送れない設定なら 503(失敗の回数には数えない)", async () => {
    slackOk = false;
    await seedUser("u1");
    const res = await login("EMP-u1");
    expect(res.status).toBe(503);
    expect(await otpDb.select().from(otpSchema.loginOtpChallenges)).toHaveLength(0);
    const logs = await logDb.select().from(auditSchema.mailDeliveryLogs);
    expect(logs.map((l) => [l.type, l.status])).toEqual([["slack", "FAILED"]]);
    const states = await db.select().from(schema.userLoginStates);
    expect(states.every((s) => s.failedCount === 0)).toBe(true);
  });

  it("存在しないチャレンジ・形式の違うコードは受け付けない", async () => {
    expect((await verify("no-such-challenge", "123456")).status).toBe(400);
    expect((await verify("x", "12ab")).status).toBe(400);
  });
});
