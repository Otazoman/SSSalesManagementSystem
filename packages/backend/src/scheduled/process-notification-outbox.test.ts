import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as auditSchema from "../db/audit-schema";

// 実際の SMTP には接続できないため、送信の境界(sendEmail)だけを差し替える
vi.mock("../utils/mailer", () => ({
  sendEmail: vi.fn(async () => {}),
}));

import { sendEmail } from "../utils/mailer";
import { processNotificationById, processNotificationOutbox } from "./process-notification-outbox";
import { enqueueNotification } from "../platform/notifications/enqueue-notification";

const mockedSendEmail = vi.mocked(sendEmail);
const dbLog = drizzle(env.DB_LOG, { schema: auditSchema });

async function enqueue(subject = "確認コード") {
  return enqueueNotification({
    dbLog: env.DB_LOG,
    category: "quote_download_otp",
    documentId: "QT-1",
    recipientTo: "to@example.com",
    subject,
    body: "1234",
  });
}

async function rowOf(id: string) {
  const rows = await dbLog
    .select()
    .from(auditSchema.mailDeliveryLogs)
    .where(eq(auditSchema.mailDeliveryLogs.id, id));
  return rows[0];
}

beforeEach(async () => {
  await dbLog.delete(auditSchema.mailDeliveryLogs);
  mockedSendEmail.mockReset();
  mockedSendEmail.mockImplementation(async () => {});
});

// PERF-08: OTP メールは登録の直後に1件だけ送る。再送は今の定期処理に任せる
describe("processNotificationById(PERF-08)", () => {
  it("enqueueNotification は登録した行の id を返し、その行を定期処理を待たずに送る", async () => {
    const id = await enqueue();
    expect(typeof id).toBe("string");

    await processNotificationById(env, id);

    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect((await rowOf(id)).status).toBe("SUCCESS");
  });

  it("同じ行は2回送らない(すぐに送る処理と定期処理が重なっても1回)", async () => {
    const id = await enqueue();

    await Promise.all([processNotificationById(env, id), processNotificationOutbox(env)]);
    await processNotificationById(env, id);
    await processNotificationOutbox(env);

    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect((await rowOf(id)).status).toBe("SUCCESS");
  });

  it("送信に失敗した行は PENDING に戻り、再送の時刻になれば定期処理で送られる", async () => {
    mockedSendEmail.mockRejectedValueOnce(new Error("SMTP の接続に失敗"));
    const id = await enqueue();

    await processNotificationById(env, id);
    const failed = await rowOf(id);
    expect(failed).toMatchObject({ status: "PENDING", retryCount: 1, errorMessage: "SMTP の接続に失敗" });
    expect(failed.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    // 再送の時刻前の定期処理では送らない
    await processNotificationOutbox(env);
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);

    // 再送の時刻を過ぎた後の定期処理で送る
    await dbLog
      .update(auditSchema.mailDeliveryLogs)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(auditSchema.mailDeliveryLogs.id, id));
    await processNotificationOutbox(env);
    expect(mockedSendEmail).toHaveBeenCalledTimes(2);
    expect((await rowOf(id)).status).toBe("SUCCESS");
  });
});

describe("定期処理: 送信の途中で止まった行の救済(PERF-08)", () => {
  async function markProcessing(id: string, minutesAgo: number) {
    await dbLog
      .update(auditSchema.mailDeliveryLogs)
      .set({ status: "PROCESSING", nextAttemptAt: new Date(Date.now() - minutesAgo * 60_000) })
      .where(eq(auditSchema.mailDeliveryLogs.id, id));
  }

  it("PROCESSING のまま5分以上たった行は PENDING に戻して送る(再試行の回数に数える)", async () => {
    const id = await enqueue();
    await markProcessing(id, 6);

    await processNotificationOutbox(env);

    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(await rowOf(id)).toMatchObject({ status: "SUCCESS", retryCount: 1 });
  });

  it("PROCESSING になって5分たっていない行(送信中)は触らない", async () => {
    const id = await enqueue();
    await markProcessing(id, 1);

    await processNotificationOutbox(env);

    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect((await rowOf(id)).status).toBe("PROCESSING");
  });

  it("再試行の回数が上限に達した行は、戻さずに FAILED にする", async () => {
    const id = await enqueue();
    await dbLog
      .update(auditSchema.mailDeliveryLogs)
      .set({ retryCount: 2 })
      .where(eq(auditSchema.mailDeliveryLogs.id, id));
    await markProcessing(id, 6);

    await processNotificationOutbox(env);

    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(await rowOf(id)).toMatchObject({ status: "FAILED", retryCount: 3 });
  });
});
