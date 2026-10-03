import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import * as logSchema from "../db/audit-schema";
import { sendWorkflowMail } from "./notifier";

/**
 * 追加要望C(承認通知のSlack/Mail重複送信バグ)の回帰テスト。
 * notification_channel='slack'かつslack_user_id設定済みのユーザーには
 * メールとSlackの両方が届いてはいけない(Slackのみ)。
 */

const db = drizzle(env.DB, { schema });
const logDb = drizzle(env.DB_LOG, { schema: logSchema });
const now = new Date();

function makeContext() {
  return { env, executionCtx: createExecutionContext() } as unknown as import("hono").Context;
}

async function seedUser(opts: {
  id: string;
  email: string;
  notificationChannel: "email" | "slack";
  slackUserId?: string | null;
}) {
  await db.insert(schema.users).values({
    id: opts.id,
    employeeNumber: `EMP-${opts.id}`,
    email: opts.email,
    name: opts.id,
    isActive: true,
    notificationChannel: opts.notificationChannel,
    slackUserId: opts.slackUserId ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

beforeEach(async () => {
  await db.delete(schema.users);
  await logDb.delete(logSchema.mailDeliveryLogs);
});

describe("追加要望C: sendWorkflowMail Slack/Mail重複送信バグ修正", () => {
  it("notification_channel='slack'かつslack_user_id設定済みのユーザーにはメールを送らずSlackのみ送る", async () => {
    await seedUser({
      id: "u-slack",
      email: "slack-user@example.com",
      notificationChannel: "slack",
      slackUserId: "U12345",
    });

    await sendWorkflowMail({
      c: makeContext(),
      category: "workflow_request",
      documentId: "doc-1",
      to: "slack-user@example.com",
      subject: "件名",
      text: "本文",
      performedById: "SYSTEM",
    });

    const logs = await logDb.select().from(logSchema.mailDeliveryLogs);
    expect(logs).toHaveLength(1);
    expect(logs[0].type).toBe("slack");
    expect(logs[0].recipientTo).toBe("U12345");
  });

  it("notification_channel='email'のユーザーにはメールのみ送る(Slackは送らない)", async () => {
    await seedUser({
      id: "u-mail",
      email: "mail-user@example.com",
      notificationChannel: "email",
    });

    await sendWorkflowMail({
      c: makeContext(),
      category: "workflow_request",
      documentId: "doc-2",
      to: "mail-user@example.com",
      subject: "件名",
      text: "本文",
      performedById: "SYSTEM",
    });

    const logs = await logDb.select().from(logSchema.mailDeliveryLogs);
    expect(logs).toHaveLength(1);
    expect(logs[0].type).toBe("email");
    expect(logs[0].recipientTo).toBe("mail-user@example.com");
  });

  it("notification_channel='slack'だがslack_user_id未設定のユーザーはメールへフォールバックする", async () => {
    await seedUser({
      id: "u-fallback",
      email: "fallback-user@example.com",
      notificationChannel: "slack",
      slackUserId: null,
    });

    await sendWorkflowMail({
      c: makeContext(),
      category: "workflow_request",
      documentId: "doc-3",
      to: "fallback-user@example.com",
      subject: "件名",
      text: "本文",
      performedById: "SYSTEM",
    });

    const logs = await logDb.select().from(logSchema.mailDeliveryLogs);
    expect(logs).toHaveLength(1);
    expect(logs[0].type).toBe("email");
    expect(logs[0].recipientTo).toBe("fallback-user@example.com");
  });

  it("Slack宛先とメール宛先が混在する場合、それぞれ正しく振り分けて登録する(重複なし)", async () => {
    await seedUser({
      id: "u-slack2",
      email: "slack2@example.com",
      notificationChannel: "slack",
      slackUserId: "U67890",
    });
    await seedUser({
      id: "u-mail2",
      email: "mail2@example.com",
      notificationChannel: "email",
    });

    await sendWorkflowMail({
      c: makeContext(),
      category: "workflow_result",
      documentId: "doc-4",
      to: "slack2@example.com, mail2@example.com",
      subject: "件名",
      text: "本文",
      performedById: "SYSTEM",
    });

    const logs = await logDb.select().from(logSchema.mailDeliveryLogs);
    expect(logs).toHaveLength(2);
    const mailLog = logs.find((l) => l.type === "email");
    const slackLog = logs.find((l) => l.type === "slack");
    expect(mailLog?.recipientTo).toBe("mail2@example.com");
    expect(slackLog?.recipientTo).toBe("U67890");
  });
});
