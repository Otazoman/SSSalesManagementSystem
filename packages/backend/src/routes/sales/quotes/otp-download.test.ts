import { describe, it, expect, beforeAll, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";

// PERF-08: 確認コードのメールを登録の直後に送るため、実際の SMTP の代わりに送信の境界(sendEmail)を差し替える
vi.mock("../../../utils/mailer", () => ({
  sendEmail: vi.fn(async () => {}),
}));
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as otpSchema from "../../../db/otp-schema";
import * as auditSchema from "../../../db/audit-schema";
import { quotesRouter } from "./index";
import { grantAllDocumentTypesToEmailTargets } from "../../../../test/support/contact-document-types";

const PARTNER_ID = "P-OTP-TEST";
const QUOTE_ID = "QT-OTP-TEST";
const ATTACHMENT_ID = "ATT-OTP-TEST";
const R2_PATH = "quotes/QT-OTP-TEST/generated_quote.pdf";
const REGISTERED_EMAIL = "registered@example.com";
const UNREGISTERED_EMAIL = "unregistered@example.com";
const RATE_LIMIT_EMAIL = "rate-limit-target@example.com";
const SEND_NOW_EMAIL = "send-now@example.com";

async function seedQuoteWithAttachment() {
  const db = drizzle(env.DB, { schema });
  const now = new Date();

  await db.insert(schema.partners).values({
    id: PARTNER_ID,
    name: "OTPテスト取引先",
    createdBy: "SYSTEM",
    createdAt: now,
    updatedBy: "SYSTEM",
    updatedAt: now,
  });

  await db.insert(schema.partnerContacts).values({
    id: "PC-OTP-TEST",
    partnerId: PARTNER_ID,
    contactType: "PRIMARY",
    email: REGISTERED_EMAIL,
    isEmailTarget: true,
    status: "active",
    createdBy: "SYSTEM",
    createdAt: now,
    updatedBy: "SYSTEM",
    updatedAt: now,
  });

  await db.insert(schema.partnerContacts).values({
    id: "PC-OTP-RATE-LIMIT",
    partnerId: PARTNER_ID,
    contactType: "SECONDARY",
    email: RATE_LIMIT_EMAIL,
    isEmailTarget: true,
    status: "active",
    createdBy: "SYSTEM",
    createdAt: now,
    updatedBy: "SYSTEM",
    updatedAt: now,
  });
  await db.insert(schema.partnerContacts).values({
    id: "PC-OTP-SEND-NOW",
    partnerId: PARTNER_ID,
    contactType: "SECONDARY",
    email: SEND_NOW_EMAIL,
    isEmailTarget: true,
    status: "active",
    createdBy: "SYSTEM",
    createdAt: now,
    updatedBy: "SYSTEM",
    updatedAt: now,
  });
  await grantAllDocumentTypesToEmailTargets(env.DB);

  await db.insert(schema.quotes).values({
    id: QUOTE_ID,
    partnerId: PARTNER_ID,
    quoteDate: now,
    totalAmount: 1000,
    taxAmount: 100,
    createdBy: "SYSTEM",
    createdAt: now,
    updatedBy: "SYSTEM",
    updatedAt: now,
  });

  await db.insert(schema.quoteAttachments).values({
    id: ATTACHMENT_ID,
    quoteId: QUOTE_ID,
    fileName: "見積書_QT-OTP-TEST.pdf",
    storageType: "R2",
    attachmentR2Path: R2_PATH,
    fileType: "PDF",
    uploadedById: "SYSTEM",
    uploadedAt: now,
  });

  await env.QUATES_BUCKET.put(R2_PATH, "dummy-pdf-content", {
    httpMetadata: { contentType: "application/pdf" },
  });
}

async function postJson(path: string, body: unknown) {
  return quotesRouter.request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function getLatestOtpCode(email: string): Promise<string> {
  const dbOtp = drizzle(env.DB_OTP, { schema: otpSchema });
  const rows = await dbOtp
    .select()
    .from(otpSchema.otpChallenges)
    .where(eq(otpSchema.otpChallenges.email, email));
  const latest = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!latest) throw new Error("OTP challenge not found");
  return latest.otpCode;
}

describe("Item4-c: OTPダウンロード", () => {
  beforeAll(async () => {
    await seedQuoteWithAttachment();
  });

  it("PERF-08: 確認コードのメールは、定期処理を待たずに応答の直後に送られる", async () => {
    const ctx = createExecutionContext();
    const res = await quotesRouter.request(
      `/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: SEND_NOW_EMAIL }),
      },
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    await waitOnExecutionContext(ctx);

    const dbLog = drizzle(env.DB_LOG, { schema: auditSchema });
    const mailRows = await dbLog
      .select()
      .from(auditSchema.mailDeliveryLogs)
      .where(eq(auditSchema.mailDeliveryLogs.recipientTo, SEND_NOW_EMAIL));
    expect(mailRows).toHaveLength(1);
    expect(mailRows[0]).toMatchObject({ category: "quote_download_otp", status: "SUCCESS" });
  });

  it("登録済み連絡先のメールアドレスならOTPが発行・記録される", async () => {
    const res = await postJson(
      `/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`,
      { email: REGISTERED_EMAIL },
    );
    expect(res.status).toBe(200);

    const dbOtp = drizzle(env.DB_OTP, { schema: otpSchema });
    const rows = await dbOtp
      .select()
      .from(otpSchema.otpChallenges)
      .where(eq(otpSchema.otpChallenges.email, REGISTERED_EMAIL));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].otpCode).toMatch(/^\d{4}$/);
  });

  it("未登録のメールアドレスの場合は同じ成功メッセージを返すがOTPは発行されない(デフォルト制限ON)", async () => {
    const res = await postJson(
      `/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`,
      { email: UNREGISTERED_EMAIL },
    );
    expect(res.status).toBe(200);

    const dbOtp = drizzle(env.DB_OTP, { schema: otpSchema });
    const rows = await dbOtp
      .select()
      .from(otpSchema.otpChallenges)
      .where(eq(otpSchema.otpChallenges.email, UNREGISTERED_EMAIL));
    expect(rows.length).toBe(0);

    const dbLog = drizzle(env.DB_LOG, { schema: auditSchema });
    const mailRows = await dbLog
      .select()
      .from(auditSchema.mailDeliveryLogs)
      .where(eq(auditSchema.mailDeliveryLogs.recipientTo, UNREGISTERED_EMAIL));
    expect(mailRows.length).toBe(0);
  });

  it("正しいOTPで検証するとファイルが返る", async () => {
    await postJson(`/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`, {
      email: REGISTERED_EMAIL,
    });
    const otpCode = await getLatestOtpCode(REGISTERED_EMAIL);

    const res = await postJson(
      `/download-verify/${QUOTE_ID}/${ATTACHMENT_ID}`,
      { email: REGISTERED_EMAIL, otp: otpCode },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const text = await res.text();
    expect(text).toBe("dummy-pdf-content");
  });

  it("誤ったOTPを入力すると400・残り試行回数が減る", async () => {
    await postJson(`/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`, {
      email: REGISTERED_EMAIL,
    });

    const res = await postJson(
      `/download-verify/${QUOTE_ID}/${ATTACHMENT_ID}`,
      { email: REGISTERED_EMAIL, otp: "0000" },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("残り試行可能回数");
  });

  it("試行回数の上限を超えると400でロックアウトされる", async () => {
    await postJson(`/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`, {
      email: REGISTERED_EMAIL,
    });

    for (let i = 0; i < 5; i++) {
      await postJson(`/download-verify/${QUOTE_ID}/${ATTACHMENT_ID}`, {
        email: REGISTERED_EMAIL,
        otp: "0000",
      });
    }

    const otpCode = await getLatestOtpCode(REGISTERED_EMAIL);
    const res = await postJson(
      `/download-verify/${QUOTE_ID}/${ATTACHMENT_ID}`,
      { email: REGISTERED_EMAIL, otp: otpCode },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("上限");
  });

  it("OTPを発行していない状態で検証すると400", async () => {
    const res = await postJson(
      `/download-verify/${QUOTE_ID}/${ATTACHMENT_ID}`,
      { email: "never-requested@example.com", otp: "1234" },
    );
    expect(res.status).toBe(400);
  });

  // REQ-007: メールアドレスを入力せず、確認コードだけで照合できる
  it("メールアドレスを送らずに発行・照合でき、PDF を受け取れる", async () => {
    const dbOtp = drizzle(env.DB_OTP, { schema: otpSchema });
    await dbOtp.delete(otpSchema.otpChallenges);
    expect((await postJson(`/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`, {})).status).toBe(200);
    const [row] = await dbOtp.select().from(otpSchema.otpChallenges).where(eq(otpSchema.otpChallenges.documentId, QUOTE_ID));
    const res = await postJson(`/download-verify/${QUOTE_ID}/${ATTACHMENT_ID}`, { otp: row.otpCode });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("dummy-pdf-content");
  });

  // REQ-007: 入力なしで、登録済みの宛先の全員に同じコードを送る。回数制限は帳票の単位(メールアドレスでは数えない)
  it("入力なしで発行でき、登録済みの宛先の全員に同じコードが届く。短時間の連続の発行は帳票の単位で制限される", async () => {
    const dbOtp = drizzle(env.DB_OTP, { schema: otpSchema });
    const rowsOf = () =>
      dbOtp.select().from(otpSchema.otpChallenges).where(eq(otpSchema.otpChallenges.documentId, QUOTE_ID));
    await dbOtp.delete(otpSchema.otpChallenges);

    const first = await postJson(`/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`, {});
    expect(first.status).toBe(200);
    const firstRows = await rowsOf();
    expect(firstRows.length).toBeGreaterThan(0);
    // 1回の発行では、全員に同じコード
    expect(new Set(firstRows.map((r) => r.otpCode)).size).toBe(1);
    expect(firstRows.some((r) => r.email === REGISTERED_EMAIL)).toBe(true);

    for (let i = 0; i < 10; i++) {
      expect((await postJson(`/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`, {})).status).toBe(200);
    }
    const atLimit = (await rowsOf()).length;
    // 上限を超えた分は、成功の文言は返すが新しいコードを発行しない
    expect((await postJson(`/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`, {})).status).toBe(200);
    expect((await rowsOf()).length).toBe(atLimit);
  });
});
